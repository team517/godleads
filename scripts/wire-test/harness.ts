
// ───────────────────────── WIRE TEST HARNESS (appended to the real send-email code) ─────────────────────────
// Fake SMTP server over implicit TLS on 127.0.0.1:4465 → captures the exact DATA the real
// sendSmtpEmail() puts on the wire, then validates it against the RFC rules Gmail enforces.
const OUT_DIR = Deno.args[0];
const listener = Deno.listenTls({
  hostname: "127.0.0.1", port: 465,
  cert: await Deno.readTextFile(`${OUT_DIR}/wire_cert.pem`),
  key: await Deno.readTextFile(`${OUT_DIR}/wire_key.pem`),
});
const captured: Uint8Array[] = [];
const transcript: string[] = [];
async function handleConn(conn: Deno.Conn) {
  const enc = new TextEncoder();
  const w = (s: string) => conn.write(enc.encode(s));
  await w("220 fake.local ESMTP\r\n");
  let buf = new Uint8Array(0); let inData = false;
  const find = (hay: Uint8Array, needle: number[]) => { outer: for (let i = 0; i + needle.length <= hay.length; i++) { for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer; return i; } return -1; };
  const END = [13, 10, 46, 13, 10], CRLF = [13, 10];
  const chunk = new Uint8Array(1 << 16);
  while (true) {
    let n: number | null;
    try { n = await conn.read(chunk); } catch { break; }
    if (n === null) break;
    const merged = new Uint8Array(buf.length + n); merged.set(buf); merged.set(chunk.subarray(0, n), buf.length); buf = merged;
    while (true) {
      if (inData) {
        const end = find(buf, END);
        if (end < 0) break;
        captured.push(buf.slice(0, end + 2)); buf = buf.slice(end + 5); inData = false;
        await w("250 2.0.0 Ok: queued as FAKE123\r\n");
        continue;
      }
      const idx = find(buf, CRLF);
      if (idx < 0) break;
      const line = new TextDecoder().decode(buf.slice(0, idx)); buf = buf.slice(idx + 2);
      transcript.push(line.startsWith("AUTH") ? "AUTH PLAIN ***" : line);
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) await w("250-fake.local\r\n250-AUTH PLAIN LOGIN\r\n250-SIZE 52428800\r\n250 8BITMIME\r\n");
      else if (cmd.startsWith("AUTH")) await w("235 2.7.0 Authentication successful\r\n");
      else if (cmd.startsWith("MAIL FROM") || cmd.startsWith("RCPT TO")) await w("250 2.1.0 Ok\r\n");
      else if (cmd === "DATA") { await w("354 End data with <CR><LF>.<CR><LF>\r\n"); inData = true; }
      else if (cmd.startsWith("QUIT")) { await w("221 2.0.0 Bye\r\n"); try { conn.close(); } catch { /* */ } return; }
      else await w("250 Ok\r\n");
    }
  }
}
(async () => { for await (const c of listener) handleConn(c).catch(() => {}); })();

function validate(name: string, raw: Uint8Array): string[] {
  const problems: string[] = [];
  const text = new TextDecoder("latin1").decode(raw);
  // 1) CRLF only — a bare LF or bare CR is an RFC 5322 violation some MTAs junk or reject.
  if (/[^\r]\n/.test(text)) problems.push("bare LF present");
  if (/\r[^\n]/.test(text)) problems.push("bare CR present");
  // 2) line length
  const lines = text.split("\r\n");
  const longest = Math.max(...lines.map((l) => l.length));
  if (longest > 998) problems.push(`line of ${longest} chars (>998)`);
  // 3) headers
  const sep = text.indexOf("\r\n\r\n");
  if (sep < 0) { problems.push("no header/body separator"); return problems; }
  const headerBlock = text.slice(0, sep);
  const unfolded = headerBlock.replace(/\r\n[ \t]+/g, " ");
  const hdrs: Record<string, string[]> = {};
  for (const l of unfolded.split("\r\n")) { const m = l.match(/^([A-Za-z0-9-]+):\s?(.*)$/); if (!m) { problems.push(`malformed header line: ${JSON.stringify(l.slice(0, 80))}`); continue; } (hdrs[m[1].toLowerCase()] ||= []).push(m[2]); }
  for (const must of ["from", "to", "subject", "date", "message-id", "mime-version", "content-type"]) {
    if (!hdrs[must]) problems.push(`missing header ${must}`);
    else if (hdrs[must].length > 1) problems.push(`duplicate header ${must} ×${hdrs[must].length}`);
  }
  if (/[^\x00-\x7F]/.test(headerBlock)) problems.push("raw 8-bit bytes in headers");
  const mid = (hdrs["message-id"] || [""])[0];
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(mid)) problems.push(`bad Message-ID: ${mid}`);
  const fromDom = ((hdrs["from"] || [""])[0].match(/@([^>\s]+)>?\s*$/) || [])[1] || "";
  if (fromDom && !mid.toLowerCase().endsWith(`@${fromDom.toLowerCase()}>`)) problems.push(`Message-ID domain ≠ From domain (${mid} vs ${fromDom})`);
  const irt = (hdrs["in-reply-to"] || [""])[0], refs = (hdrs["references"] || [""])[0];
  if (irt) {
    if (!/^<[^<>\s]+>$/.test(irt)) problems.push(`bad In-Reply-To: ${irt}`);
    const ids = refs.split(/\s+/).filter(Boolean);
    if (!ids.length) problems.push("In-Reply-To without References");
    else if (ids[ids.length - 1] !== irt) problems.push("last References id ≠ In-Reply-To");
    if (ids.some((i) => !/^<[^<>\s]+>$/.test(i))) problems.push(`malformed id in References: ${refs.slice(0, 120)}`);
    if (new Set(ids).size !== ids.length) problems.push("duplicate ids in References");
  }
  if (!/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test((hdrs["date"] || [""])[0])) problems.push(`non-RFC Date: ${(hdrs["date"] || [""])[0]}`);
  // 4) MIME structure
  const ct = (hdrs["content-type"] || [""])[0];
  const bm = ct.match(/boundary="?([^";]+)"?/i);
  if (!bm) problems.push("no boundary in Content-Type");
  else {
    const body = text.slice(sep + 4);
    const open = body.split(`--${bm[1]}\r\n`).length - 1;
    const close = body.includes(`--${bm[1]}--`);
    if (open < 2) problems.push(`only ${open} part(s) under the top boundary`);
    if (!close) problems.push("top boundary never closed");
    if (!/Content-Type: text\/plain/i.test(body)) problems.push("no text/plain part");
    if (!/Content-Type: text\/html/i.test(body)) problems.push("no text/html part");
  }
  // 5) quoted-printable line length ≤ 76 inside QP parts
  const qpTooLong = lines.filter((l) => l.length > 76 && /=[0-9A-F]{2}|=$/.test(l)).length;
  if (qpTooLong) problems.push(`${qpTooLong} quoted-printable line(s) > 76 chars`);
  console.log(`\n===== ${name} =====`);
  console.log(headerBlock);
  console.log(`--- body: ${text.length - sep - 4} bytes, ${lines.length} lines, longest ${longest}`);
  return problems;
}

const BODY_TEST = `<p style="margin:0 0 14px">Buenas, perfecto, te paso el enlace de mi calendario para que puedas agendar reunión lo antes posible</p><p style="margin:0 0 14px"><a href="https://calendly.com/onepulso/30min">https://calendly.com/onepulso/30min</a></p><p style="margin:0 0 14px">quedo atento<br>saludos<br>Maria</p>`;
const BODY_TEMPLATE = Array.from({ length: 9 }, (_, i) => `<p style="margin:0 0 14px">Párrafo ${i + 1}: En nuestro caso no trabajamos con una base de datos genérica ni contactamos empresas de forma indiscriminada — hacemos un estudio de vuestro cliente ideal (sector, tamaño, ubicación, cargo) y os compartimos la base antes de empezar. ¿Os encaja?</p>`).join("") + `<p><a href="https://calendly.com/onepulso/30min">https://calendly.com/onepulso/30min</a></p>`;
const SIG = `<table><tr><td><img src="https://onepulso.online/logo.png" width="120" alt="OnePulso"></td><td><b>María López</b><br>OnePulso · Growth<br><a href="https://onepulso.online">onepulso.online</a></td></tr></table>`;

// Reenvío, tal y como lo arma el Unibox: nota + cabecera "Mensaje reenviado" + el original.
const ORIG_HTML = `<div dir="ltr"><p>Buenos días Oliver,</p><p>Gracias por tu mensaje. Os paso las referencias que necesitamos:</p><ul><li>PN LM140K-5.0 — 2 uds</li><li>P/N CD4049UBF — 5 uds</li></ul><p>¿Podéis confirmar plazo y certificados?</p><p>Un saludo,<br>Giovanni Cetrone<br>Procurement</p><table><tr><td>LEAT S.p.A.</td><td>+39 011 248 3711</td></tr></table></div>`;
const FWD_BODY = `<div style="white-space:pre-wrap">Te paso esto, mira a ver.</div><br><div style="border-top:1px solid #d9d9d9;padding-top:12px;margin-top:8px"><div style="font-size:13px;color:#5f6368;margin-bottom:10px">---------- Mensaje reenviado ----------<br><b>De:</b> Giovanni Cetrone &lt;g.cetrone@leat.it&gt;<br><b>Fecha:</b> 17/9/2026, 16:54:00<br><b>Asunto:</b> Request for quote TCX MICRO<br><b>Para:</b> oliver@tcxmicro.com</div><div>${ORIG_HTML}</div></div>`;

const SIG_REAL = await Deno.readTextFile(`${OUT_DIR}/sig_real.html`).catch(() => "");

const cases: Array<{ name: string; subject: string; body: string; opts: Record<string, unknown> }> = [
  { name: "1) respuesta corta de prueba (la tuya de hoy)", subject: "Re: Maria - chipsfinder", body: BODY_TEST,
    opts: { inReplyTo: "<CAJxyz123abc@mail.gmail.com>", references: "<20260915.101010.abcdefghij.klmnop@onnepulssofunnels.org> <CAJxyz123abc@mail.gmail.com>", fromName: "Maria Lopez" } },
  { name: "2) plantilla larga con acentos + firma con logo + hilo de 30 ids duplicados", subject: "RE: ¿Reunión el próximo lunes? — información sobre la campaña de captación de María",
    body: BODY_TEMPLATE,
    opts: { inReplyTo: "AM0PR04MB5793@eurprd04.prod.outlook.com", references: Array.from({ length: 30 }, (_, i) => `<2026091${i % 9}.15363${i}.omteo23r3l.ed0u9l@oncontrolplus.es>`).join(" ") + " <AM0PR04MB5793@eurprd04.prod.outlook.com> <AM0PR04MB5793@eurprd04.prod.outlook.com>", fromName: "Alfons Pons", signatureHtml: SIG } },
  { name: "3) respuesta SIN cabeceras de hilo (el servidor no encontró id)", subject: "Re: idea para PASEK", body: BODY_TEST, opts: { fromName: "Alfons Pons" } },
  { name: "4) respuesta CON el mensaje original citado (nuevo) + firma", subject: "Re: Maria - chipsfinder", body: BODY_TEST,
    opts: { inReplyTo: "<CAKJA_Wtw+0Bk8vUdtHt9PF--PayJs=a6ki-jy_ouOT_VsnMURg@mail.gmail.com>", references: "<20260917.071226.5r5o9y8usr.bxko8m@onnepulssofunnels.org> <CAKJA_Wtw+0Bk8vUdtHt9PF--PayJs=a6ki-jy_ouOT_VsnMURg@mail.gmail.com>",
      fromName: "Maria Lopez", signatureHtml: SIG,
      quoteHeader: "El 17 sept 2026, 9:13, Xavi <xaviecomm@gmail.com> escribió:",
      quoteHtml: `<div dir="ltr">Hola María, sí me interesa, ¿cuándo podemos hablar?<script>alert(1)</script></div><br><div class="gmail_quote"><div class="gmail_attr">El jue, 17 sept 2026 a las 9:12, Maria Lopez escribió:</div><blockquote class="gmail_quote">Buenas Xavi, estuvimos viendo chipsfinder y… ¿te va bien verlo 10 minutos?</blockquote></div>` } },
  { name: "5) REENVÍO desde el Unibox (nota + original completo)", subject: "Fwd: Request for quote TCX MICRO", body: FWD_BODY,
    opts: { fromName: "Oliver Lopez", inReplyTo: "<AM0PR04MB5793@eurprd04.prod.outlook.com>", references: "<20260917.071226.5r5o9y8usr.bxko8m@onnepulssofunnels.org> <AM0PR04MB5793@eurprd04.prod.outlook.com>" } },
  { name: "6) firma REAL de producción (tabla + logo en base64)", subject: "Re: Maria - chipsfinder", body: BODY_TEST,
    opts: { fromName: "John Lopez", signatureHtml: SIG_REAL,
      inReplyTo: "<CAJxyz123abc@mail.gmail.com>", references: "<20260915.101010.abcdefghij.klmnop@onnepulssofunnels.org> <CAJxyz123abc@mail.gmail.com>" } },
];

let failed = 0;
for (const c of cases) {
  const before = captured.length;
  const r = await sendSmtpEmail("localhost", 465, "user@x", "pass", "maria@onnepulssofunnels.org", "xaviecomm@gmail.com", c.subject, c.body, c.opts as never);
  if (!r.ok || captured.length === before) { console.log(`\n===== ${c.name} =====\nSEND FAILED:`, JSON.stringify(r)); failed++; continue; }
  const raw = captured[captured.length - 1];
  await Deno.writeFile(`${OUT_DIR}/wire_${cases.indexOf(c) + 1}.eml`, raw);
  const problems = validate(c.name, raw);
  console.log(problems.length ? `PROBLEMS:\n - ${problems.join("\n - ")}` : "RFC CHECKS: ALL PASSED");
  if (problems.length) failed++;
}
console.log(`\nSMTP transcript (first case): ${transcript.slice(0, 7).join(" | ")}`);
console.log(failed ? `\nRESULT: ${failed} case(s) with problems` : "\nRESULT: every case is RFC-clean on the wire");
Deno.exit(0);

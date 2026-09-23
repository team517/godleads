// ── TEST DE CABLE DEL MOTOR DE CAMPAÑAS (se añade detrás del código real del motor) ──────────
// Levanta un SMTP falso con TLS en 127.0.0.1:465, llama al sendSmtpEmail() REAL del motor y
// valida los bytes exactos que salen al cable: diálogo SMTP, cabeceras, MIME, quoted-printable,
// punto escapado, baja en un clic y señales de spam. No sale nada de esta máquina.
// deno-lint-ignore-file no-explicit-any
const OUT_DIR = Deno.args[0];
const listener = Deno.listenTls({
  hostname: "127.0.0.1", port: 465,
  cert: await Deno.readTextFile(`${OUT_DIR}/wire_cert.pem`),
  key: await Deno.readTextFile(`${OUT_DIR}/wire_key.pem`),
});
const captured: Uint8Array[] = [];
const avisos: string[] = [];
const transcripts: string[][] = [];
async function handleConn(conn: Deno.Conn) {
  const enc = new TextEncoder();
  const transcript: string[] = []; transcripts.push(transcript);
  const w = (s: string) => conn.write(enc.encode(s));
  await w("220 fake.local ESMTP\r\n");
  let buf = new Uint8Array(0); let inData = false; let authStep = 0;
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
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) { transcript.push("EHLO"); await w("250-fake.local\r\n250-AUTH PLAIN LOGIN\r\n250-SIZE 52428800\r\n250 8BITMIME\r\n"); }
      else if (cmd.startsWith("AUTH")) { transcript.push("AUTH"); authStep = 1; await w("334 VXNlcm5hbWU6\r\n"); }
      else if (authStep === 1) { authStep = 2; await w("334 UGFzc3dvcmQ6\r\n"); }
      else if (authStep === 2) { authStep = 3; await w("235 2.7.0 Authentication successful\r\n"); }
      else if (cmd.startsWith("MAIL FROM")) { transcript.push("MAIL"); await w("250 2.1.0 Ok\r\n"); }
      else if (cmd.startsWith("RCPT TO")) { transcript.push("RCPT"); await w("250 2.1.5 Ok\r\n"); }
      else if (cmd === "DATA") { transcript.push("DATA"); await w("354 End data with <CR><LF>.<CR><LF>\r\n"); inData = true; }
      else if (cmd.startsWith("QUIT")) { transcript.push("QUIT"); await w("221 2.0.0 Bye\r\n"); try { conn.close(); } catch { /* */ } return; }
      else await w("250 Ok\r\n");
    }
  }
}
(async () => { for await (const c of listener) handleConn(c).catch(() => {}); })();

type Case = { name: string; subject: string; html: string; opts: Record<string, unknown>; esperar?: (t: string, p: string[]) => void };

function validate(raw: Uint8Array): { problems: string[]; text: string } {
  const problems: string[] = [];
  const text = new TextDecoder("latin1").decode(raw);
  if (/[^\r]\n/.test(text)) problems.push("hay un salto de línea suelto (LF sin CR)");
  if (/\r[^\n]/.test(text)) problems.push("hay un retorno suelto (CR sin LF)");
  const lines = text.split("\r\n");
  const longest = Math.max(...lines.map((l) => l.length));
  if (longest > 998) problems.push(`línea de ${longest} caracteres (máximo 998)`);
  const sep = text.indexOf("\r\n\r\n");
  if (sep < 0) { problems.push("no hay separación entre cabeceras y cuerpo"); return { problems, text }; }
  const headerBlock = text.slice(0, sep);
  const body = text.slice(sep + 4);
  const unfolded = headerBlock.replace(/\r\n[ \t]+/g, " ");
  const hdrs: Record<string, string[]> = {};
  for (const l of unfolded.split("\r\n")) {
    const m = l.match(/^([A-Za-z0-9-]+):\s?(.*)$/);
    if (!m) { problems.push(`cabecera mal formada: ${JSON.stringify(l.slice(0, 80))}`); continue; }
    (hdrs[m[1].toLowerCase()] ||= []).push(m[2]);
  }
  for (const must of ["from", "to", "subject", "date", "message-id", "mime-version", "content-type", "reply-to"]) {
    if (!hdrs[must]) problems.push(`falta la cabecera ${must}`);
    else if (hdrs[must].length > 1) problems.push(`cabecera ${must} repetida x${hdrs[must].length}`);
  }
  if (/[^\x00-\x7F]/.test(headerBlock)) problems.push("bytes de 8 bits sin codificar en las cabeceras");
  const mid = (hdrs["message-id"] || [""])[0];
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(mid)) problems.push(`Message-ID mal formado: ${mid}`);
  const fromDom = ((hdrs["from"] || [""])[0].match(/@([^>\s]+)>?\s*$/) || [])[1] || "";
  if (fromDom && !mid.toLowerCase().endsWith(`@${fromDom.toLowerCase()}>`)) problems.push(`el dominio del Message-ID no es el del remitente (${mid} vs ${fromDom})`);
  if (!/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test((hdrs["date"] || [""])[0])) problems.push(`fecha fuera de norma: ${(hdrs["date"] || [""])[0]}`);
  const irt = (hdrs["in-reply-to"] || [""])[0], refs = (hdrs["references"] || [""])[0];
  if (irt) {
    if (!/^<[^<>\s]+>$/.test(irt)) problems.push(`In-Reply-To mal formado: ${irt}`);
    const ids = (refs || "").split(/\s+/).filter(Boolean);
    if (!ids.length) problems.push("In-Reply-To sin References");
    else if (ids[ids.length - 1] !== irt) problems.push("el último id de References no es el In-Reply-To");
    if (new Set(ids).size !== ids.length) problems.push("ids repetidos en References");
  }
  for (const h of Object.keys(hdrs)) if (h.startsWith("x-")) problems.push(`cabecera ${h} (huella de envío masivo)`);
  if (hdrs["precedence"]) problems.push("cabecera Precedence (marca de correo masivo)");
  if (/<img[^>]+(width|height)=["']?1["']?/i.test(body)) problems.push("pixel de seguimiento de 1x1");
  const ct = (hdrs["content-type"] || [""])[0];
  const bm = ct.match(/boundary="?([^";]+)"?/i);
  if (/multipart/i.test(ct)) {
    if (!bm) problems.push("no hay boundary en el Content-Type");
    else {
      if ((body.split(`--${bm[1]}\r\n`).length - 1) < 2) problems.push("menos de 2 partes bajo el boundary principal");
      if (!body.includes(`--${bm[1]}--`)) problems.push("el boundary principal no se cierra");
    }
    if (!/Content-Type: text\/plain/i.test(body)) problems.push("falta la parte de texto");
  }
  // Quoted-printable: sólo en el CUERPO (una cabecera codificada tiene sus propias reglas).
  const qpLong = body.split("\r\n").filter((l) => l.length > 76 && /=[0-9A-F]{2}|=$/.test(l)).length;
  if (qpLong) problems.push(`${qpLong} linea(s) quoted-printable de mas de 76 caracteres`);
  // Cabeceras: cada línea física <= 78 (RFC 5322) y cada palabra codificada <= 75 (RFC 2047).
  // >78 es sólo la recomendación de estilo del RFC 5322 (el límite real es 998) y Outlook/Gmail
  // mandan igual el Content-Type con boundary largo: se anota como AVISO, no como fallo.
  for (const l of headerBlock.split("\r\n")) if (l.length > 78) avisos.push(`cabecera de ${l.length} caracteres (recomendado 78): ${l.slice(0, 45)}...`);
  for (const wd of headerBlock.match(/=\?[^?]+\?[BQ]\?[^?]*\?=/gi) || []) if (wd.length > 75) problems.push(`palabra codificada de ${wd.length} caracteres (maximo 75)`);
  return { problems, text };
}

const BODY = `<p style="margin:0 0 14px">Hola Javier,</p><p style="margin:0 0 14px">Soy Maria, de OnePulso. Vi el perfil de Acme &amp; Partners y me llamo la atencion el equipo comercial.</p><p style="margin:0 0 14px">La idea es que Acme reciba reuniones cada semana sin tocar nada.</p><p style="margin:0 0 14px">Te encaja una llamada de 10 minutos? <a href="https://calendly.com/onepulso/30min">https://calendly.com/onepulso/30min</a></p><p style="margin:0 0 14px">Un saludo,<br>Maria</p>`;
const SIG = `<table><tr><td><img src="https://onepulso.online/logo.png" width="120" alt="OnePulso"></td><td><b>Maria Lopez</b><br>OnePulso - Growth<br><a href="https://onepulso.online">onepulso.online</a></td></tr></table>`;
const UNSUB = "https://backend-onepulso-platfomr.25kofp.easypanel.host/u/abc123";

const casos: Case[] = [
  {
    name: "1) primer correo de campaña, con baja y firma", subject: "Javier - Acme & Partners", html: BODY,
    opts: { firstName: "María", lastName: "López", signatureHtml: SIG, unsubscribeUrl: UNSUB, unsubscribeHeaderUrl: UNSUB },
    esperar: (t, p) => {
      if (!/List-Unsubscribe: <https:/.test(t)) p.push("falta List-Unsubscribe");
      if (!/List-Unsubscribe-Post: List-Unsubscribe=One-Click/.test(t)) p.push("falta la baja en un clic (RFC 8058)");
      if (!/baja/i.test(t)) p.push("el pie de baja no aparece en el cuerpo");
    },
  },
  {
    name: "2) seguimiento en el mismo hilo (paso 2)", subject: "Viste esto de Acme ?", html: BODY,
    opts: {
      firstName: "María", lastName: "López", inReplyTo: "<20260922.101010.abcdefghij.klmnop@onepulso-lead.es>",
      references: "<20260920.090000.zzzzzzzzzz.yyyyyy@onepulso-lead.es> <20260922.101010.abcdefghij.klmnop@onepulso-lead.es>",
      unsubscribeHeaderUrl: UNSUB,
    },
    esperar: (t, p) => { if (!/In-Reply-To:/.test(t)) p.push("el seguimiento no va en el hilo"); },
  },
  {
    name: "3) asunto con acentos y eñes", subject: "Añadimos más reuniones — ¿te encaja?", html: BODY,
    opts: { firstName: "José", lastName: "Muñoz" },
    esperar: (t, p) => {
      if (!/Subject: =\?UTF-8\?/i.test(t)) p.push("el asunto con acentos no va codificado");
      if (!/From: =\?UTF-8\?/i.test(t)) p.push("el nombre del remitente con acentos no va codificado");
    },
  },
  {
    name: "4) punto al principio de línea y línea larguísima", subject: "Prueba de formato",
    html: `<p>.punto al principio de linea</p><p>${"palabra ".repeat(160)}</p>`, opts: { firstName: "Ana" },
  },
  {
    name: "5) con archivo adjunto", subject: "Presupuesto adjunto", html: BODY,
    opts: { firstName: "María", attachments: [{ filename: "Presupuesto Acme.pdf", mime: "application/pdf", base64: btoa("%PDF-1.4 " + "x".repeat(4000)) }] },
    esperar: (t, p) => {
      if (!/multipart\/mixed/i.test(t)) p.push("con adjunto deberia ser multipart/mixed");
      if (!/Content-Disposition: attachment; filename="/.test(t)) p.push("el adjunto no lleva Content-Disposition");
      const b64 = (t.split("Content-Transfer-Encoding: base64\r\n\r\n")[1] || "").split("\r\n--")[0];
      if (b64.split("\r\n").some((l) => l.length > 76)) p.push("lineas base64 de mas de 76 caracteres");
    },
  },
  {
    // Seguimiento REAL de una campaña "solo texto" (CHIPSFINDER FRANCE, paso 2): tiene que llegar
    // con sus párrafos separados, no como un ladrillo de texto seguido.
    name: "6) seguimiento de campana de solo texto", subject: "Une reference difficile a trouver ?",
    html: "Bonjour Oceane,\n\nJe voulais simplement revenir vers vous au cas ou mon precedent message se serait perdu dans votre boite de reception.\n\nNous travaillons actuellement avec plusieurs entreprises similaires a Bcauto Encheres et nous les aidons a trouver des composants electroniques.\n\nBien cordialement,\nJohn\nChipsFinder",
    opts: { firstName: "John", textOnly: true, inReplyTo: "<20260922.101010.abcdefghij.klmnop@onepulso-lead.es>", references: "<20260922.101010.abcdefghij.klmnop@onepulso-lead.es>" },
    esperar: (t, p) => {
      if (!/Content-Type: text\/plain/i.test(t)) p.push("la campana de solo texto no sale como texto");
      const cuerpo = t.slice(t.indexOf("\r\n\r\n") + 4).replace(/=\r\n/g, "");
      const parrafos = cuerpo.split("\r\n\r\n").filter((x) => x.trim().length > 0).length;
      if (parrafos < 4) p.push(`el seguimiento llega con ${parrafos} parrafo(s): se pierden los saltos`);
      if (cuerpo.indexOf("Bien cordialement,\r\nJohn\r\nChipsFinder") < 0) p.push("la despedida pierde sus saltos de linea");
    },
  },
];

const problemas: string[] = [];
for (const [i, c] of casos.entries()) {
  const before = captured.length;
  const res = await (sendSmtpEmail as any)("127.0.0.1", 465, "maria@onepulso-lead.es", "clave-de-prueba",
    "maria@onepulso-lead.es", "javier@acme-partners.es", c.subject, c.html, c.opts);
  if (!res.ok) { problemas.push(`${c.name}: el motor no pudo enviar -> ${res.error}`); continue; }
  if (captured.length === before) { problemas.push(`${c.name}: el servidor no recibio ningun mensaje`); continue; }
  const { problems, text } = validate(captured[captured.length - 1]);
  if (!c.opts.textOnly) {
    const qpBack = (s: string) => s.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    const plano = qpBack((text.split("Content-Type: text/plain")[1] || "").split("\r\n--")[0]);
    for (const url of [...String(c.html).matchAll(/href="([^"]+)"/g)].map((m) => m[1])) {
      if (!plano.includes(url)) problems.push(`el enlace ${url} esta en el HTML pero no en la parte de texto`);
    }
  }
  // Punto al principio de línea: debe salir escapado como ".." (si no, el mensaje se corta ahí).
  const cuerpo = text.slice(text.indexOf("\r\n\r\n") + 4);
  for (const l of cuerpo.split("\r\n")) if (l === ".") problemas.push(`${c.name}: hay una linea con un punto solo sin escapar`);
  // Un punto al principio de línea tiene que salir duplicado: si no, el servidor corta el correo ahí.
  if (/(^|\n)\./.test(String(c.html).replace(/<[^>]+>/g, "\n")) && !/\r\n\.\./.test(text)) {
    problemas.push(`${c.name}: el punto al principio de linea no va escapado`);
  }
  c.esperar?.(text, problems);
  const t = transcripts[transcripts.length - 1] || [];
  const limpio = t.filter((x, k, a) => x !== a[k - 1]);
  const esperado = ["EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"];
  if (JSON.stringify(limpio) !== JSON.stringify(esperado)) problems.push(`orden SMTP inesperado: ${limpio.join(" > ")}`);
  console.log(`\n===== ${c.name} =====\n${text.slice(0, text.indexOf("\r\n\r\n"))}`);
  console.log(`--- cuerpo ${text.length} bytes · dialogo: ${limpio.join(" > ")} · ${problems.length ? "FALLA" : "correcto"}`);
  for (const p of problems) problemas.push(`${c.name}: ${p}`);
  await Deno.writeTextFile(`${OUT_DIR}/motor_${i + 1}.eml`, text);
}
const nl = String.fromCharCode(10);
console.log(avisos.length ? "AVISOS DE ESTILO (no son fallos):" + nl + "  - " + [...new Set(avisos)].join(nl + "  - ") : "Sin avisos de estilo");
console.log(problemas.length ? `\nFALLA (${problemas.length}):\n  - ${problemas.join("\n  - ")}` : `\nTODO CORRECTO en los ${casos.length} casos`);
Deno.exit(problemas.length ? 1 : 0);

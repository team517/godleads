// Shared SMTP reply sender — extracted from process-auto-replies so the reminder
// cron can reuse the exact same battle-tested send path (465 TLS / 587 STARTTLS).

export function linkifyText(text: string): string {
  return text.replace(
    /(https?:\/\/[^\s<>"')\]]+)/gi,
    '<a href="$1" style="color:#2563eb;text-decoration:underline;" target="_blank">$1</a>'
  );
}

export function textToHtml(text: string): string {
  if (/<(p|div|br)\b/i.test(text)) {
    return linkifyText(text);
  }
  return text
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${linkifyText(p.replace(/\n/g, "<br>"))}</p>`)
    .join("");
}

export async function sendSmtpReply(
  host: string, port: number, username: string, password: string,
  from: string, to: string, subject: string, body: string,
  inReplyTo: string | null, references: string | null,
  fromName: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    let conn: Deno.Conn;
    if (port === 465) {
      conn = await Deno.connectTls({ hostname: host, port });
    } else {
      conn = await Deno.connect({ hostname: host, port });
    }

    const read = async () => {
      const buf = new Uint8Array(4096);
      const n = await conn.read(buf);
      return new TextDecoder().decode(buf.subarray(0, n || 0));
    };

    const send = async (cmd: string) => {
      await conn.write(new TextEncoder().encode(cmd + "\r\n"));
      return await read();
    };

    await read(); // greeting

    const buildMessage = () => {
      const fromHeader = fromName ? `"${fromName}" <${from}>` : from;
      let headers = `From: ${fromHeader}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0`;
      if (inReplyTo) headers += `\r\nIn-Reply-To: <${inReplyTo}>`;
      if (references) headers += `\r\nReferences: <${references}>`;
      return `${headers}\r\n\r\n${body}\r\n.\r\n`;
    };

    if (port === 587) {
      const resp = await send("EHLO mailreach");
      if (resp.includes("STARTTLS")) {
        await conn.write(new TextEncoder().encode("STARTTLS\r\n"));
        await read();
        conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host });

        const sendTls = async (cmd: string) => {
          await conn.write(new TextEncoder().encode(cmd + "\r\n"));
          const buf = new Uint8Array(4096);
          const n = await conn.read(buf);
          return new TextDecoder().decode(buf.subarray(0, n || 0));
        };

        await sendTls("EHLO mailreach");
        const creds = btoa(`\0${username}\0${password}`);
        const authResp = await sendTls(`AUTH PLAIN ${creds}`);
        if (!authResp.startsWith("235")) return { ok: false, error: `Auth failed: ${authResp}` };

        await sendTls(`MAIL FROM:<${from}>`);
        await sendTls(`RCPT TO:<${to}>`);
        await sendTls("DATA");
        const dataResp = await sendTls(buildMessage());
        await sendTls("QUIT");
        conn.close();
        return dataResp.includes("250") ? { ok: true } : { ok: false, error: `Send failed: ${dataResp}` };
      }
    }

    // Standard flow (465 or fallback)
    await send("EHLO mailreach");
    const creds = btoa(`\0${username}\0${password}`);
    const authResp = await send(`AUTH PLAIN ${creds}`);
    if (!authResp.startsWith("235")) return { ok: false, error: `Auth failed: ${authResp}` };

    await send(`MAIL FROM:<${from}>`);
    await send(`RCPT TO:<${to}>`);
    await send("DATA");
    const dataResp = await send(buildMessage());
    await send("QUIT");
    conn.close();
    return dataResp.includes("250") ? { ok: true } : { ok: false, error: `Send failed: ${dataResp}` };
  } catch (e) {
    return { ok: false, error: `SMTP error: ${e.message}` };
  }
}

// ── SMTP sender with attachments (multipart/mixed) ─────────────────────────────
// Ported from send-report's battle-tested sender. `headerFrom` lets the visible
// From: differ from the authenticated/envelope sender (e.g. show
// equipo@onepulso.online while authenticating as support@ on the same domain —
// Gmail honours it when the address is a registered alias of the mailbox).
const b64utf8 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const mimeWord = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`);
function fromHeaderStr(name: string, addr: string): string {
  const clean = (name || "").replace(/[\r\n]/g, "").trim();
  if (!clean) return `<${addr}>`;
  if (/^[\x20-\x7E]*$/.test(clean)) return `"${clean.replace(/([\\"])/g, "\$1")}" <${addr}>`;
  return `${mimeWord(clean)} <${addr}>`;
}

export async function sendSmtpWithAttachments(opts: {
  host: string; port: number; username: string; password: string;
  from: string; fromName: string; to: string; subject: string; body: string;
  attachments: { filename: string; mime: string; base64: string }[];
  headerFrom?: string;
}): Promise<{ ok: boolean; error?: string; transcript?: string[] }> {
  const { host, port, username, password, from, fromName, to, subject, body, attachments } = opts;
  const visibleFrom = opts.headerFrom || from;
  const log: string[] = [];
  // Deadlines: a hung SMTP peer must fail fast, never stall the edge function to its wall limit.
  const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("SMTP timeout (" + what + ")")), ms))]);
  try {
    let conn: Deno.Conn = await withTimeout(
      port === 465 ? Deno.connectTls({ hostname: host, port }) : Deno.connect({ hostname: host, port }),
      15000, "connect");
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const readResponse = async (): Promise<string> => {
      let result = "";
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const b = new Uint8Array(4096);
        const n = await withTimeout(conn.read(b), 20000, "read");
        if (!n) break;
        result += dec.decode(b.subarray(0, n));
        const lines = result.split("\r\n").filter((l) => l.length > 0);
        const last = lines[lines.length - 1] || "";
        if (/^\d{3} /.test(last)) break;
      }
      return result;
    };
    const writeAll = async (data: Uint8Array) => { let off = 0; while (off < data.length) off += await conn.write(data.subarray(off)); }; // TLS write() can be PARTIAL on big buffers (240KB PDF truncated silently)
    const cmd = async (c: string) => { await writeAll(enc.encode(c + "\r\n")); const r = (await readResponse()).trim(); log.push(c.split(" ")[0] + " => " + r.slice(0, 60)); return r; };
    const code2 = (r: string) => /^2\d\d/.test(r);
    log.push("GREET => " + (await readResponse()).trim().slice(0, 60));
    if (port !== 465) {
      const ehlo = await cmd("EHLO onepulso");
      if (/STARTTLS/i.test(ehlo)) { await conn.write(enc.encode("STARTTLS\r\n")); await readResponse(); conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host }); }
      else { try { conn.close(); } catch { /* */ } return { ok: false, error: "SMTP sin STARTTLS" }; }
    }
    await cmd("EHLO onepulso");
    const auth = await cmd(`AUTH PLAIN ${btoa(`\0${username}\0${password}`)}`);
    if (!auth.startsWith("235")) { try { conn.close(); } catch { /* */ } return { ok: false, error: `Auth: ${auth.slice(0, 80)}`, transcript: log }; }
    const mf = await cmd(`MAIL FROM:<${from}>`);
    if (!code2(mf)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `MAIL FROM: ${mf.slice(0, 80)}`, transcript: log }; }
    const rc = await cmd(`RCPT TO:<${to}>`);
    if (!code2(rc)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `RCPT: ${rc.slice(0, 80)}`, transcript: log }; }
    const dt = await cmd("DATA");
    if (!/^3\d\d/.test(dt)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `DATA: ${dt.slice(0, 80)}`, transcript: log }; }

    const boundary = `=_op_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    const b64wrap = (s: string) => (s.replace(/[^A-Za-z0-9+/=]/g, "").match(/.{1,76}/g) || []).join("\r\n");
    const fromDomain = visibleFrom.split("@")[1] || "localhost";
    const messageId = `<${Math.random().toString(36).slice(2)}${Date.now().toString(36)}@${fromDomain}>`;
    const parts: string[] = [
      [
        `From: ${fromHeaderStr(fromName, visibleFrom)}`,
        `To: ${to}`,
        `Subject: ${mimeWord(subject)}`,
        `Reply-To: <${visibleFrom}>`,
        `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
        `Message-ID: ${messageId}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ].join("\r\n"),
      "",
      `--${boundary}`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: 8bit`,
      "",
      // dot-stuffing per RFC 5321 (a line starting with "." would truncate DATA)
      body.replace(/<[^>]+>/g, " ").replace(/[ \t]+\n/g, "\n").replace(/^\./gm, "..").trim(),
    ];
    for (const att of attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${att.mime}; name="${att.filename}"`,
        `Content-Transfer-Encoding: base64`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        "",
        b64wrap(att.base64),
      );
    }
    parts.push(`--${boundary}--`);
    await writeAll(enc.encode(parts.join("\r\n") + "\r\n.\r\n"));
    const fin = (await readResponse()).trim();
    try { await cmd("QUIT"); } catch { /* */ }
    try { conn.close(); } catch { /* */ }
    return code2(fin) ? { ok: true } : { ok: false, error: `Envío: ${fin.slice(0, 80)}`, transcript: log };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e), transcript: log }; }
}

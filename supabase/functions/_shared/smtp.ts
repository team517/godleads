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

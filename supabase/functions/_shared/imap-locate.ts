// Localiza un mensaje en un buzón semilla por IMAP: ¿Bandeja, Promociones (Gmail), Spam o no ha
// llegado? Sólo LEE (EXAMINE): nunca marca, mueve ni borra nada. Módulo aparte para poder
// probarlo contra un servidor IMAP falso (scripts/wire-test/imap-locate.test.ts).
import { findSpamFolder, type PlacementFolder } from "./placement.ts";

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`timeout ${what}`)), ms))]);

export type Seed = { id: string; user_id: string; email: string; imap_host: string; imap_port: number | null; imap_user: string; imap_pass: string };

// ── IMAP: ¿en qué carpeta está el mensaje? Por Message-ID (o, en pruebas antiguas, por el
//    código que llevaba el asunto). ──
export async function imapLocate(seed: Seed, find: { messageId?: string; subjectToken?: string; gmail?: boolean }): Promise<PlacementFolder> {
  let conn: Deno.Conn | null = null;
  try {
    const port = seed.imap_port || 993;
    conn = port === 993
      ? await withTimeout(Deno.connectTls({ hostname: seed.imap_host, port }), 12000, "imap connect")
      : await withTimeout(Deno.connect({ hostname: seed.imap_host, port }), 12000, "imap connect");
    const c = conn;
    const dec = new TextDecoder("utf-8", { fatal: false });
    const enc = new TextEncoder();
    const readAll = async (tag: string) => {
      let out = "";
      for (let i = 0; i < 80; i++) {
        const b = new Uint8Array(65536);
        const n = await withTimeout(c.read(b), 12000, "imap read");
        if (!n) break;
        out += dec.decode(b.subarray(0, n));
        if (new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)`).test(out)) break;
      }
      return out;
    };
    let seq = 0;
    const send = async (cmd: string) => { const tag = `p${++seq}`; await c.write(enc.encode(`${tag} ${cmd}\r\n`)); const out = await readAll(tag); return { out, ok: new RegExp(`(^|\\r\\n)${tag} OK`).test(out) }; };
    const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

    { const b = new Uint8Array(4096); await withTimeout(c.read(b), 12000, "imap greeting"); }
    const login = await send(`LOGIN ${q(seed.imap_user)} ${q(seed.imap_pass)}`);
    if (!login.ok) return "error";

    const list = await send(`LIST "" "*"`);
    const spamFolder = findSpamFolder(list.out);
    const criteria = find.messageId ? `HEADER Message-ID ${q(find.messageId)}` : `SUBJECT ${q(find.subjectToken || "")}`;
    const hit = (out: string) => /\d/.test((out.match(/\* SEARCH([^\r\n]*)/i)?.[1] || ""));
    const has = async (folder: string, crit: string) => {
      const sel = await send(`EXAMINE ${q(folder)}`);
      if (!sel.ok) return false;
      const res = await send(`SEARCH ${crit}`);
      return res.ok && hit(res.out);
    };

    let where: PlacementFolder = "missing";
    if (await has("INBOX", criteria)) {
      where = "inbox";
      // Gmail: la pestaña Promociones vive dentro de INBOX; sólo X-GM-RAW la distingue.
      if ((find.gmail ?? /gmail\.com$/i.test(seed.imap_host)) && find.messageId) {
        const promo = await send(`SEARCH X-GM-RAW ${q(`rfc822msgid:${find.messageId.replace(/^<|>$/g, "")} category:promotions`)}`);
        if (promo.ok && hit(promo.out)) where = "promotions";
      }
    } else if (spamFolder && await has(spamFolder, criteria)) {
      where = "spam";
    }
    try { await send("LOGOUT"); } catch { /* */ }
    return where;
  } catch {
    return "error";
  } finally {
    try { conn?.close(); } catch { /* */ }
  }
}

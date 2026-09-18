// Traerse UN mensaje ENTERO de un buzón por IMAP, buscándolo por su Message-ID.
//
// La sincronización sólo baja los primeros 256 KB de cada correo (por velocidad), así que los
// adjuntos grandes no llegan. Esto lo usa la función `inbox-attachments` para ir a buscar ese
// correo concreto cuando el usuario quiere sus archivos.
//
// SÓLO LEE: usa EXAMINE (nunca SELECT) y BODY.PEEK, así que no marca como leído ni mueve nada.

export interface Mailbox {
  host: string;
  port: number | null;
  user: string;
  pass: string;
}

export interface RawHit {
  ok: true;
  raw: string;
  folder: string;
  uid: number;
  bytes: number;
  truncated: boolean;
}
export interface RawMiss {
  ok: false;
  reason: "login" | "not_found" | "error" | "timeout";
  detail?: string;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`timeout ${what}`)), ms))]);

/** Carpetas donde miramos, en orden. La respuesta suele estar en la bandeja de entrada. */
const DEFAULT_FOLDERS = ["INBOX"];

export async function imapFetchRawByMessageId(
  box: Mailbox,
  messageId: string,
  opts?: { folders?: string[]; maxBytes?: number; searchAllFolders?: boolean },
): Promise<RawHit | RawMiss> {
  const maxBytes = opts?.maxBytes ?? 20 * 1024 * 1024;
  const clean = String(messageId || "").trim().replace(/^<|>$/g, "");
  if (!clean) return { ok: false, reason: "not_found", detail: "sin Message-ID" };

  let conn: Deno.Conn | null = null;
  try {
    const port = box.port || 993;
    conn = port === 993
      ? await withTimeout(Deno.connectTls({ hostname: box.host, port }), 15000, "conectar")
      : await withTimeout(Deno.connect({ hostname: box.host, port }), 15000, "conectar");
    const c = conn;
    const dec = new TextDecoder("utf-8", { fatal: false });
    const enc = new TextEncoder();

    /** Lee hasta ver la respuesta etiquetada, o hasta el tope de bytes. */
    const readAll = async (tag: string, cap: number) => {
      let out = "";
      let total = 0;
      const started = Date.now();
      while (total < cap && Date.now() - started < 60000) {
        const b = new Uint8Array(262144);
        const n = await withTimeout(c.read(b), 20000, "leer");
        if (!n) break;
        total += n;
        out += dec.decode(b.subarray(0, n), { stream: true });
        if (new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)`).test(out)) break;
      }
      return { out, total };
    };

    let seq = 0;
    const send = async (cmd: string, cap = 262144) => {
      const tag = `a${++seq}`;
      await c.write(enc.encode(`${tag} ${cmd}\r\n`));
      const { out, total } = await readAll(tag, cap);
      return { out, total, ok: new RegExp(`(^|\\r\\n)${tag} OK`).test(out) };
    };
    const q = (s: string) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

    { const b = new Uint8Array(4096); await withTimeout(c.read(b), 15000, "saludo"); }
    const login = await send(`LOGIN ${q(box.user)} ${q(box.pass)}`);
    if (!login.ok) return { ok: false, reason: "login" };

    let folders = opts?.folders ?? DEFAULT_FOLDERS;
    if (opts?.searchAllFolders) {
      const list = await send(`LIST "" "*"`);
      const found = [...list.out.matchAll(/^\* LIST \([^)]*\) "[^"]*" (?:"([^"]+)"|(\S+))\s*$/gim)]
        .map((m) => (m[1] || m[2] || "").trim())
        .filter((f) => f && !/\\Noselect/i.test(f));
      folders = ["INBOX", ...found.filter((f) => f.toUpperCase() !== "INBOX")];
    }

    for (const folder of folders.slice(0, 12)) {
      const sel = await send(`EXAMINE ${q(folder)}`);
      if (!sel.ok) continue;
      const search = await send(`SEARCH HEADER Message-ID ${q(`<${clean}>`)}`);
      const nums = (search.out.match(/\* SEARCH([^\r\n]*)/i)?.[1] || "").trim().split(/\s+/).filter(Boolean);
      if (!search.ok || nums.length === 0) continue;
      const seqNum = nums[nums.length - 1];

      // El mensaje entero, sin marcarlo como leído.
      const fetched = await send(`FETCH ${seqNum} (UID BODY.PEEK[])`, maxBytes);
      const uid = parseInt(fetched.out.match(/UID (\d+)/)?.[1] || "0", 10);
      // La respuesta llega como: * 12 FETCH (UID 34 BODY[] {84213}\r\n<…mensaje…>\r\n)
      const litM = fetched.out.match(/BODY\[\][^{]*\{(\d+)\}\r?\n/);
      if (!litM) continue;
      const start = (litM.index || 0) + litM[0].length;
      const declared = parseInt(litM[1], 10);
      const raw = fetched.out.slice(start, start + declared);
      return { ok: true, raw, folder, uid, bytes: raw.length, truncated: raw.length < declared };
    }
    return { ok: false, reason: "not_found" };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return { ok: false, reason: /timeout/i.test(msg) ? "timeout" : "error", detail: msg.slice(0, 200) };
  } finally {
    try { conn?.close(); } catch { /* ya cerrada */ }
  }
}

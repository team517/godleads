import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// INBOX PLACEMENT (spam) TEST. Sends a test email from a chosen account to every
// "seed" mailbox (email_accounts tagged 'seed', across Gmail/Outlook/Zoho/…),
// then checks by IMAP which folder each landed in (Inbox vs Spam/Junk). Reuses
// the IMAP/SMTP creds already stored on the accounts. Two actions: run, check.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function rand(n: number) { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
function providerOf(email: string): string {
  const d = (email.split("@")[1] || "").toLowerCase();
  if (/gmail|googlemail/.test(d)) return "Gmail";
  if (/outlook|hotmail|live|msn/.test(d)) return "Outlook";
  if (/yahoo|ymail/.test(d)) return "Yahoo";
  if (/zoho/.test(d)) return "Zoho";
  if (/ionos|1and1/.test(d)) return "IONOS";
  return d || "otro";
}
const withTimeout = <T,>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`timeout ${what}`)), ms))]);

// ── SMTP send (implicit TLS 465 or STARTTLS 587), AUTH LOGIN/PLAIN ──
async function sendSmtp(host: string, port: number, user: string, pass: string, from: string, to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  try {
    let conn: Deno.Conn = port === 465 ? await withTimeout(Deno.connectTls({ hostname: host, port }), 12000, "connect") : await withTimeout(Deno.connect({ hostname: host, port }), 12000, "connect");
    const read = async () => { const b = new Uint8Array(4096); const n = await withTimeout(conn.read(b), 12000, "read"); return new TextDecoder().decode(b.subarray(0, n || 0)); };
    const cmd = async (c: string) => { await conn.write(new TextEncoder().encode(c + "\r\n")); return await read(); };
    await read();
    if (port !== 465) {
      const e = await cmd("EHLO placement");
      if (/STARTTLS/i.test(e)) { await conn.write(new TextEncoder().encode("STARTTLS\r\n")); await read(); conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host }); }
    }
    await cmd("EHLO placement");
    const auth = await cmd(`AUTH PLAIN ${btoa(`\0${user}\0${pass}`)}`);
    if (!auth.startsWith("235")) { try { conn.close(); } catch {} return { ok: false, error: `auth ${auth.trim().slice(0, 60)}` }; }
    await cmd(`MAIL FROM:<${from}>`);
    const rcpt = await cmd(`RCPT TO:<${to}>`);
    if (!/^250|^251/.test(rcpt.trim())) { try { conn.close(); } catch {} return { ok: false, error: `rcpt ${rcpt.trim().slice(0, 60)}` }; }
    await cmd("DATA");
    const msg = `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/html; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${html}\r\n.\r\n`;
    const resp = await cmd(msg);
    try { await cmd("QUIT"); } catch {}
    try { conn.close(); } catch {}
    return resp.includes("250") ? { ok: true } : { ok: false, error: `send ${resp.trim().slice(0, 60)}` };
  } catch (e) { return { ok: false, error: String((e as any)?.message || e) }; }
}

// ── IMAP: which folder holds the message with `token` in the subject? ──
async function imapFindFolder(host: string, port: number, user: string, pass: string, token: string): Promise<"inbox" | "spam" | "missing" | "error"> {
  try {
    let conn: Deno.Conn = port === 993 ? await withTimeout(Deno.connectTls({ hostname: host, port }), 12000, "c") : await withTimeout(Deno.connect({ hostname: host, port }), 12000, "c");
    const dec = new TextDecoder("utf-8", { fatal: false });
    const enc = new TextEncoder();
    const readAll = async (tag: string) => {
      let out = "";
      for (let i = 0; i < 60; i++) {
        const b = new Uint8Array(65536);
        const n = await withTimeout(conn.read(b), 12000, "r");
        out += dec.decode(b.subarray(0, n || 0));
        if (out.includes(`${tag} OK`) || out.includes(`${tag} NO`) || out.includes(`${tag} BAD`)) break;
      }
      return out;
    };
    const send = async (tag: string, c: string) => { await conn.write(enc.encode(`${tag} ${c}\r\n`)); return await readAll(tag); };
    // greeting
    { const b = new Uint8Array(4096); await withTimeout(conn.read(b), 12000, "g"); }
    const login = await send("a1", `LOGIN "${user}" "${pass}"`);
    if (!login.includes("a1 OK")) { try { conn.close(); } catch {} return "error"; }
    // discover spam folder
    const list = await send("a2", `LIST "" "*"`);
    const names: string[] = [];
    for (const m of list.matchAll(/\* LIST \([^)]*\)\s+(?:"[^"]*"|\S+)\s+(?:"([^"]+)"|(\S+))\r?\n/gi)) names.push((m[1] || m[2] || "").trim());
    const spamFolder = names.find((f) => /(^|[./])spam$|junk|deseado|unwanted|bulk|no\s?deseado/i.test(f)) || null;
    const hasToken = async (folder: string): Promise<boolean> => {
      const sel = await send("s" + rand(2), `SELECT "${folder}"`);
      if (!/OK/i.test(sel)) return false;
      const t = "x" + rand(3);
      const res = await send(t, `SEARCH SUBJECT "${token}"`);
      const line = (res.match(/\* SEARCH([^\r\n]*)/i)?.[1] || "").trim();
      return line.length > 0 && /\d/.test(line);
    };
    let where: "inbox" | "spam" | "missing" = "missing";
    if (await hasToken("INBOX")) where = "inbox";
    else if (spamFolder && await hasToken(spamFolder)) where = "spam";
    try { await send("q1", "LOGOUT"); } catch {}
    try { conn.close(); } catch {}
    return where;
  } catch { return "error"; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "No autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = (body as any).action;

    // Seeds live in a SEPARATE table (placement_seeds) with their OWN IMAP creds —
    // NOT in email_accounts, so fetch-inbox never syncs them and they NEVER appear in
    // the campaign Unibox. Fully parallel monitoring.
    const { data: seeds } = await userClient.from("placement_seeds").select("*");
    if (!seeds || seeds.length === 0) return json({ error: "No hay buzones semilla. Añádelos en Entregabilidad (Gmail/Outlook/Zoho… con su IMAP)." }, 400);

    if (action === "run") {
      const { account_id, subject, html } = body as any;
      const { data: acc } = await userClient.from("email_accounts").select("*").eq("id", account_id).maybeSingle();
      if (!acc || !acc.smtp_host) return json({ error: "Cuenta de envío no válida." }, 400);
      const token = "IPT-" + rand(10);
      const subj = `${(subject || "Prueba de entregabilidad").trim()} ${token}`;
      const bodyHtml = html || `<p>Hola,</p><p>Este es un correo de prueba para ver dónde aterriza. Puedes ignorarlo.</p><p>Un saludo.</p>`;
      let sentOk = 0;
      const errors: string[] = [];
      for (const s of seeds) {
        const r = await sendSmtp(acc.smtp_host, acc.smtp_port || 465, acc.smtp_username, acc.smtp_password, acc.email, s.email, subj, bodyHtml);
        if (r.ok) sentOk++; else errors.push(`${s.email}: ${r.error}`);
      }
      const { data: test } = await userClient.from("placement_tests").insert({
        user_id: u.user.id, from_account_id: acc.id, from_email: acc.email, subject: subj, token, seeds: seeds.length, status: "sent",
      }).select().single();
      return json({ ok: true, test_id: test?.id, token, seeds: seeds.length, sent: sentOk, errors: errors.length ? errors : undefined });
    }

    if (action === "check") {
      const { test_id } = body as any;
      const { data: test } = await userClient.from("placement_tests").select("*").eq("id", test_id).maybeSingle();
      if (!test) return json({ error: "Prueba no encontrada." }, 404);
      let inbox = 0, spam = 0, missing = 0;
      const results: any[] = [];
      for (const s of seeds) {
        const folder = await imapFindFolder(s.imap_host, s.imap_port || 993, s.imap_user, s.imap_pass, test.token);
        if (folder === "inbox") inbox++; else if (folder === "spam") spam++; else missing++;
        results.push({ email: s.email, provider: providerOf(s.email), folder });
      }
      await userClient.from("placement_tests").update({ inbox, spam, missing, results, status: "done" }).eq("id", test_id);
      const pct = seeds.length ? Math.round((inbox / seeds.length) * 100) : 0;
      return json({ ok: true, inbox, spam, missing, inbox_pct: pct, results });
    }

    return json({ error: "action debe ser 'run' o 'check'" }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});

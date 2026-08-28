// imap-conversations — LIVE IMAP search + per-thread import for Seguimiento (godleads).
// Reads the mailbox directly (team@ by default) so it detects ALL the different conversations
// (threads) with a person and imports ONLY the selected thread. Uses imapflow via npm:.
//   action "search"  { query }                     -> [{subject, participants, count, last_date, contact_email}]
//   action "import"  { contactEmail, subject? }     -> { messages:[...] }  (subject = solo ese hilo)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.164";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const TEAM_ACCOUNT = "a638362a-dff1-4d44-9d27-f2e7390d15fc"; // team@onepulso.online
const esc = (s: any) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as any)[c]);
const prettyName = (email: string) => { const lp = String(email || "").split("@")[0].replace(/[._-]+/g, " "); return lp.replace(/\b\w/g, (c) => c.toUpperCase()).trim() || String(email || ""); };
const normSubj = (s: string) => String(s || "").replace(/^(\s*(re|fwd|fw|rv)\s*:\s*)+/i, "").trim();

function buildCriteria(q: string): any {
  q = String(q || "").trim();
  const ops: any = {};
  const free = q.replace(/\b(from|to|subject|after|before):(\S+)/gi, (_: any, k: string, v: string) => { ops[k.toLowerCase()] = v; return ""; }).trim();
  const crit: any = {};
  if (ops.from) crit.from = ops.from;
  if (ops.to) crit.to = ops.to;
  if (ops.subject) crit.subject = ops.subject;
  if (ops.after) { const d = new Date(String(ops.after).replace(/\//g, "-")); if (!isNaN(+d)) crit.since = d; }
  if (ops.before) { const d2 = new Date(String(ops.before).replace(/\//g, "-")); if (!isNaN(+d2)) crit.before = d2; }
  if (free) crit.or = [{ from: free }, { to: free }, { subject: free }];
  return Object.keys(crit).length ? crit : null;
}
function connectImap(acc: any) {
  return new ImapFlow({ host: acc.imap_host, port: Number(acc.imap_port) || 993, secure: (Number(acc.imap_port) || 993) === 993, auth: { user: acc.imap_username || acc.email, pass: acc.imap_password }, logger: false, socketTimeout: 20000, greetingTimeout: 8000, connectionTimeout: 10000 });
}
function mailboxes(boxes: any[], kinds: { inbox?: boolean; sent?: boolean; all?: boolean }) {
  return boxes.filter((b) => {
    if (b.flags && b.flags.has && b.flags.has("\\Noselect")) return false;
    const p = (b.path || "").toLowerCase();
    if (kinds.all && (b.specialUse === "\\All" || /all mail|\/todos/i.test(p))) return true;
    if (kinds.inbox && (p === "inbox" || b.specialUse === "\\Inbox")) return true;
    if (kinds.sent && (b.specialUse === "\\Sent" || /(^|[\/.])sent|enviad/i.test(p))) return true;
    return false;
  });
}

async function searchEmails(acc: any, query: string) {
  const criteria = buildCriteria(query);
  if (!criteria) return { results: [] };
  const me = String(acc.email || acc.imap_username).toLowerCase();
  const client = connectImap(acc); await client.connect();
  const map: any = {};
  try {
    const boxes = await client.list();
    const targets = mailboxes(boxes, { inbox: true, sent: true, all: true });
    for (const box of targets) {
      let lock; try { lock = await client.getMailboxLock(box.path); } catch { continue; }
      try {
        let uids: any[] = [];
        try { uids = await client.search(criteria, { uid: true }) as any[]; } catch { uids = []; }
        if (!uids || !uids.length) continue;
        uids = uids.slice(-80);
        for await (const m of client.fetch(uids, { uid: true, envelope: true }, { uid: true } as any)) {
          const env: any = (m as any).envelope; if (!env) continue;
          const fromAddr = (env.from && env.from[0] && env.from[0].address || "").toLowerCase();
          const parts: string[] = [];
          if (env.from) env.from.forEach((a: any) => { if (a.address) parts.push(a.address.toLowerCase()); });
          (env.to || []).forEach((a: any) => { if (a.address) parts.push(a.address.toLowerCase()); });
          (env.cc || []).forEach((a: any) => { if (a.address) parts.push(a.address.toLowerCase()); });
          const key = normSubj(env.subject).toLowerCase() || fromAddr || (box.path + ":" + (m as any).uid);
          const date = env.date ? new Date(env.date).getTime() : Date.now();
          const cur = map[key] || { subject: env.subject || "(sin asunto)", participants: {}, count: 0, last_date: 0 };
          cur.count++; parts.forEach((a) => { if (a) cur.participants[a] = true; });
          if (date >= cur.last_date) { cur.last_date = date; if (env.subject) cur.subject = env.subject; }
          map[key] = cur;
        }
      } finally { try { lock.release(); } catch { /* */ } }
    }
  } finally { try { await client.logout(); } catch { /* */ } }
  const results = Object.keys(map).map((k) => {
    const g = map[k]; const participants = Object.keys(g.participants);
    const contact = participants.filter((a) => a !== me)[0] || participants[0] || "";
    return { subject: g.subject, participants, count: g.count, last_date: g.last_date, contact_email: contact, contact_name: prettyName(contact) };
  }).sort((a, b) => b.last_date - a.last_date).slice(0, 40);
  return { results };
}

// Pick the best TEXT body part (html preferred, else plain) from an IMAP bodyStructure, skipping
// attachments — so we download only the readable body, never multi-MB PDFs. Returns the IMAP part
// id (e.g. "1", "1.2") + its type + transfer encoding.
function findTextPart(node: any): { part: string; type: string; enc: string } | null {
  if (!node) return null;
  if (node.childNodes && node.childNodes.length) {
    let html: any = null, plain: any = null;
    for (const c of node.childNodes) { const r = findTextPart(c); if (r) { if (r.type === "text/html" && !html) html = r; else if (r.type === "text/plain" && !plain) plain = r; } }
    return html || plain;
  }
  const type = String(node.type || "").toLowerCase();
  const disp = String(node.disposition || "").toLowerCase();
  if ((type === "text/html" || type === "text/plain") && disp !== "attachment") return { part: node.part || "1", type, enc: String(node.encoding || "").toLowerCase() };
  return null;
}

async function streamToText(stream: any): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const c of stream) chunks.push(c as Uint8Array);
  let len = 0; for (const c of chunks) len += c.length;
  const all = new Uint8Array(len); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder("utf-8").decode(all);
}

async function importConversation(acc: any, contact: string, threadSubject?: string) {
  contact = String(contact || "").toLowerCase().trim();
  const baseSubject = normSubj(String(threadSubject || "")); // sin Re:/Fwd, para buscar el hilo entero
  const wantSubj = baseSubject ? baseSubject.toLowerCase() : null;
  const me = String(acc.email || acc.imap_username).toLowerCase();
  const client = connectImap(acc); await client.connect();
  const out: any[] = [], seen = new Set<string>();
  try {
    const boxes = await client.list();
    const allMail = boxes.find((b: any) => b.specialUse === "\\All" || /all mail|\/todos/i.test(b.path || ""));
    const targets = allMail ? [allMail] : mailboxes(boxes, { inbox: true, sent: true });
    for (const box of targets) {
      let lock; try { lock = await client.getMailboxLock(box.path); } catch { continue; }
      try {
        let uids: any[] = [];
        // FAST + solo el hilo: busca por ASUNTO base (mucho menos que todos los correos del
        // contacto). Combinado con el contacto. Fallback a contacto solo si no hay asunto.
        // FAST: search scoped by the CONTACT (one person = few emails). We deliberately DO NOT do
        // a subject-only search — "PROPUESTA ONEPULSO" was sent to hundreds of prospects, so that
        // would fetch+parse dozens of unrelated mails and blow the worker time limit (the real
        // cause of "no carga"). Subject is applied as a client-side filter below.
        if (wantSubj) {
          try { uids = await client.search({ subject: baseSubject, or: [{ from: contact }, { to: contact }] }, { uid: true }) as any[]; } catch { uids = []; }
        }
        if (!uids || !uids.length) { try { uids = await client.search({ or: [{ from: contact }, { to: contact }] }, { uid: true }) as any[]; } catch { uids = []; } }
        if (!uids || !uids.length) continue;
        uids = uids.slice(-30); // a real thread fits easily; keeps parse cost bounded
        // 1) LIGHT pass: envelope + bodyStructure only (no body download) → fast, low memory.
        const wanted: any[] = [];
        for await (const msg of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true }, { uid: true } as any)) {
          const env: any = (msg as any).envelope || {};
          const mid = env.messageId || box.path + ":" + (msg as any).uid;
          if (seen.has(mid)) continue; seen.add(mid);
          if (wantSubj) { const ms = normSubj(env.subject || "").toLowerCase(); if (ms !== wantSubj && !ms.includes(wantSubj) && !wantSubj.includes(ms)) continue; }
          const fromAddr = ((env.from && env.from[0] && env.from[0].address) || "").toLowerCase();
          if (contact) {
            const toAddrs = (env.to || []).map((a: any) => (a.address || "").toLowerCase());
            const ccAddrs = (env.cc || []).map((a: any) => (a.address || "").toLowerCase());
            if (fromAddr !== contact && !toAddrs.includes(contact) && !ccAddrs.includes(contact)) continue;
          }
          wanted.push({ uid: (msg as any).uid, env, fromAddr, tp: findTextPart((msg as any).bodyStructure) });
        }
        // 2) For the (few) messages of this thread, download ONLY the text body part — never
        //    attachments — so a thread full of PDF contracts still loads fast.
        for (const w of wanted) {
          let html = "", txt = "";
          if (w.tp) {
            try { const dl: any = await client.download(w.uid, w.tp.part, { uid: true }); const raw = await streamToText(dl.content); if (w.tp.type === "text/html") html = raw; else txt = raw; } catch { /* */ }
          }
          out.push({
            id: w.env.messageId || box.path + ":" + w.uid, direction: w.fromAddr === me ? "outbound" : "inbound",
            from: (w.env.from && w.env.from[0] && (w.env.from[0].name ? `${w.env.from[0].name} <${w.fromAddr}>` : w.fromAddr)) || w.fromAddr,
            from_addr: w.fromAddr, to: (w.env.to || []).map((a: any) => a.address),
            subject: w.env.subject || "", date: w.env.date ? new Date(w.env.date).getTime() : Date.now(),
            body_html: html || (txt ? "<p>" + esc(txt) + "</p>" : ""), body_text: txt || (html ? html.replace(/<[^>]+>/g, " ") : ""),
            message_id: w.env.messageId || "", in_reply_to: w.env.inReplyTo || "", references: w.env.inReplyTo ? [w.env.inReplyTo] : [],
          });
        }
      } finally { try { lock.release(); } catch { /* */ } }
    }
  } finally { try { await client.logout(); } catch { /* */ } }
  out.sort((a, b) => a.date - b.date);
  return out;
}

// Bound the live-IMAP fetch so a stalled mailbox can't hang the request (and the frontend
// spinner) forever — after `ms` we bail and fall back to the DB.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("imap-timeout")), ms))]);
}

// FALLBACK: reconstruct the thread from what's ALREADY synced in the DB (fetch-inbox-team keeps
// team@ fresh) so the conversation ALWAYS loads even if the live IMAP fetch is slow/down.
async function dbThread(admin: any, accountId: string, meEmail: string, contact: string, threadSubject?: string): Promise<any[]> {
  contact = String(contact || "").toLowerCase().trim();
  const me = String(meEmail || "").toLowerCase();
  const base = normSubj(String(threadSubject || "")).toLowerCase();
  const subjOk = (s: string) => { if (!base) return true; const ms = normSubj(s || "").toLowerCase(); return ms === base || ms.includes(base) || base.includes(ms); };
  const out: any[] = [];
  try {
    const { data: inb } = await admin.from("inbox_messages")
      .select("message_id, from_email, from_name, subject, body_text, body_html, received_at, ref_chain")
      .eq("account_id", accountId).ilike("from_email", contact)
      .order("received_at", { ascending: true }).limit(80);
    for (const m of (inb || [])) {
      if (!subjOk(m.subject)) continue;
      out.push({ id: m.message_id || `db-in-${m.received_at}`, direction: "inbound",
        from: m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email, from_addr: (m.from_email || "").toLowerCase(),
        to: [me], subject: m.subject || "", date: new Date(m.received_at).getTime(),
        body_html: m.body_html || ("<p>" + esc(m.body_text || "") + "</p>"), body_text: m.body_text || "",
        message_id: m.message_id || "", in_reply_to: "", references: m.ref_chain ? String(m.ref_chain).split(/\s+/).filter(Boolean) : [] });
    }
  } catch { /* */ }
  try {
    const { data: snt } = await admin.from("sent_emails")
      .select("to_email, subject, body, sent_at, smtp_message_id")
      .eq("account_id", accountId).ilike("to_email", contact)
      .order("sent_at", { ascending: true }).limit(80);
    for (const s of (snt || [])) {
      if (!s.sent_at || !subjOk(s.subject)) continue;
      out.push({ id: s.smtp_message_id || `db-out-${s.sent_at}`, direction: "outbound",
        from: me, from_addr: me, to: [contact], subject: s.subject || "", date: new Date(s.sent_at).getTime(),
        body_html: s.body || "", body_text: String(s.body || "").replace(/<[^>]+>/g, " ").trim(),
        message_id: s.smtp_message_id || "", in_reply_to: "", references: [] });
    }
  } catch { /* */ }
  // Dedupe by message_id + sort chronologically.
  const seen = new Set<string>();
  return out.filter((m) => { const k = m.message_id || m.id; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.date - b.date);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // SECURITY: require a valid Supabase JWT AND verify the caller OWNS the mailbox. Without this,
    // anyone could read the FULL email content of ANY account just by passing its account_id
    // (the service role bypasses RLS). The Seguimiento page always calls with the user's session.
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: aerr } = await userClient.auth.getUser();
    if (aerr || !ud?.user) return new Response(JSON.stringify({ error: "no autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const body = await req.json().catch(() => ({} as any));
    const accountId = body.account_id || TEAM_ACCOUNT;
    const { data: acc } = await admin.from("email_accounts").select("email, imap_host, imap_port, imap_username, imap_password, user_id").eq("id", accountId).maybeSingle();
    if (!acc?.imap_host || !acc?.imap_password) return new Response(JSON.stringify({ error: "cuenta sin IMAP configurado" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (acc.user_id !== ud.user.id) return new Response(JSON.stringify({ error: "no autorizado para esta cuenta" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (body.action === "search") {
      const out = await searchEmails(acc, String(body.query || ""));
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.action === "import") {
      const contactEmail = String(body.contactEmail || "");
      let messages: any[] = [];
      let source = "imap";
      // 1) Try the LIVE IMAP fetch, but bounded to 28s so a stalled mailbox can't hang the request.
      try { messages = await withTimeout(importConversation(acc, contactEmail, body.subject || ""), 40000); }
      catch { messages = []; }
      // 2) If IMAP returned nothing (timeout / error / empty), rebuild from the synced DB so the
      //    conversation ALWAYS loads.
      if (!messages || !messages.length) {
        messages = await dbThread(admin, accountId, String(acc.email || acc.imap_username || ""), contactEmail, body.subject || "");
        source = "db";
      }
      return new Response(JSON.stringify({ contact: contactEmail, subject: body.subject || "", messages, source }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "action inválida (search|import)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

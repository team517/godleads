// imap-conversations — LIVE IMAP search + per-thread import for Seguimiento (godleads).
// Reads the mailbox directly (team@ by default) so it detects ALL the different conversations
// (threads) with a person and imports ONLY the selected thread. Uses imapflow via npm:.
//   action "search"  { query }                     -> [{subject, participants, count, last_date, contact_email}]
//   action "import"  { contactEmail, subject? }     -> { messages:[...] }  (subject = solo ese hilo)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.164";
import { simpleParser } from "npm:mailparser@3.7.1";

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
  return new ImapFlow({ host: acc.imap_host, port: Number(acc.imap_port) || 993, secure: (Number(acc.imap_port) || 993) === 993, auth: { user: acc.imap_username || acc.email, pass: acc.imap_password }, logger: false, socketTimeout: 45000 });
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
        if (wantSubj) {
          try { uids = await client.search({ subject: baseSubject, or: [{ from: contact }, { to: contact }] }, { uid: true }) as any[]; } catch { uids = []; }
          if (!uids || !uids.length) { try { uids = await client.search({ subject: baseSubject }, { uid: true }) as any[]; } catch { uids = []; } }
        }
        if ((!uids || !uids.length)) { try { uids = await client.search({ or: [{ from: contact }, { to: contact }] }, { uid: true }) as any[]; } catch { uids = []; } }
        if (!uids || !uids.length) continue;
        uids = uids.slice(-40); // tope: un hilo real cabe de sobra
        for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true } as any)) {
          try {
            const parsed: any = await simpleParser((msg as any).source);
            const mid = parsed.messageId || box.path + ":" + (msg as any).uid;
            if (seen.has(mid)) continue; seen.add(mid);
            if (wantSubj) { const ms = normSubj(parsed.subject || "").toLowerCase(); if (ms !== wantSubj && !ms.includes(wantSubj) && !wantSubj.includes(ms)) continue; }
            const fromAddr = ((parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || "").toLowerCase();
            out.push({
              id: mid, direction: fromAddr === me ? "outbound" : "inbound",
              from: (parsed.from && parsed.from.text) || "", from_addr: fromAddr,
              to: (parsed.to && parsed.to.value || []).map((a: any) => a.address),
              subject: parsed.subject || "", date: (parsed.date || new Date()).getTime(),
              body_html: parsed.html || parsed.textAsHtml || ("<p>" + esc(parsed.text || "") + "</p>"),
              body_text: parsed.text || "", message_id: parsed.messageId || "",
              in_reply_to: parsed.inReplyTo || "", references: parsed.references ? ([] as string[]).concat(parsed.references) : [],
            });
          } catch { /* ilegible */ }
        }
      } finally { try { lock.release(); } catch { /* */ } }
    }
  } finally { try { await client.logout(); } catch { /* */ } }
  out.sort((a, b) => a.date - b.date);
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({} as any));
    const accountId = body.account_id || TEAM_ACCOUNT;
    const { data: acc } = await admin.from("email_accounts").select("email, imap_host, imap_port, imap_username, imap_password").eq("id", accountId).maybeSingle();
    if (!acc?.imap_host || !acc?.imap_password) return new Response(JSON.stringify({ error: "cuenta sin IMAP configurado" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (body.action === "search") {
      const out = await searchEmails(acc, String(body.query || ""));
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.action === "import") {
      const messages = await importConversation(acc, String(body.contactEmail || ""), body.subject || "");
      return new Response(JSON.stringify({ contact: body.contactEmail, subject: body.subject || "", messages }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "action inválida (search|import)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

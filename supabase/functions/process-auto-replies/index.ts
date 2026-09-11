// Reply Agents — generates (and, only if the operator asked for it, sends) the reply to a
// prospect's answer.
//
// WHAT CHANGED vs the old rule-based auto-reply
//   * One row of auto_reply_rules is now an AGENT: goal, scope, categories, tone, length, style,
//     business context, objection handling, resources, a daily cap and a mode.
//   * MODE 'draft' is the default. The agent writes the reply and parks it in auto_reply_log for
//     a human to send or discard. Sending automatically ('auto') is a deliberate choice — an
//     agent that mails a prospect the moment somebody saves it is how you send a customer
//     something nobody read.
//   * We only act on mail the SERVER has judged: the message must carry the 'IA' marker that
//     push-interested writes next to the category. A label written by whichever browser tab
//     happened to open the Unibox (or no label at all) is not a decision, and this function
//     sends email — it must not act on a guess.
//   * AUTH. The old function had none: anyone who knew the URL could make every active rule fire.
//     Now it takes the cron shared secret or the service role key, like every other cron.
//
// SAFETY ORDER (cheapest and most certain first, all BEFORE we spend a model call):
//   1. robot senders / system subjects        — never answer a machine
//   2. the sender is one of our own mailboxes — never answer ourselves
//   3. a human already replied in this thread — never talk over a person
//   4. this agent already wrote to this address in the last 24 h — never double-tap
//   5. the agent's daily cap                  — bounded blast radius per agent
//   6. the mailbox's daily cap                — never blow a sending account's reputation
// Steps 1-4 also set auto_replied = true, so a message that is not answerable is never
// reconsidered. Steps 5-6 deliberately do NOT mark: they are capacity, not a verdict, and
// tomorrow the same message is still a legitimate candidate.
//
// A failure never retries. A message that failed to generate or to send is marked auto_replied
// and logged 'failed'; the alternative is a retry storm that hammers SMTP with the same message.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { replyTextForClassification, textFromHtml } from "../_shared/reply-text.ts";
import { buildReplyAgentSystemPrompt, buildReplyAgentUserPrompt, REPLY_LENGTH_WORDS } from "../_shared/reply-agent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Marker push-interested writes next to the category it decided. No marker → no action. */
const AI_MARKER = "IA";
const CATEGORY_LABELS = ["Interesado", "Pregunta", "No interesado", "No contactar", "Derivado", "Fuera / Auto"];
/** Never answered, whatever the agent is configured with. An automatic reply has nobody on the
 *  other end; a rejection and a "do not contact" have somebody who asked us to stop. */
const NEVER_REPLY = ["Fuera / Auto", "No contactar", "No interesado"];
/** Stop STARTING work after this. The edge runtime kills the run well past it. */
const RUN_BUDGET_MS = 50_000;
/** Per agent and per invocation. The cron comes back in a few minutes for the rest. */
const MAX_MESSAGES_PER_AGENT = 30;
/** How far back a reply is still worth answering. Older than this and a reply is a conversation,
 *  not a fresh lead — a human should handle it. */
const LOOKBACK_HOURS = 24;

// Automated / notification SENDERS — NEVER let the AI reply to a robot. These are tested
// against the FROM ADDRESS ONLY (not the body): a real prospect writing "book me on
// calendly.com/juan" or "we pay via stripe" must still get a reply.
const senderSkipPatterns = [
  /^notifications?@/i, /^no-?reply/i, /^donotreply/i, /^do-not-reply/i, /^postmaster@/i,
  /^mailer-daemon/i, /^bounces?[@+-]/i, /^alerts?@/i, /^support@.*\.(calendly|hubspot|intercom|zendesk)\./i,
  /@(?:[a-z0-9-]+\.)*(calendly\.com|mailchimp\.com|sendgrid\.net|mailgun\.org|amazonses\.com|sparkpostmail\.com|hubspot\.com|intercom\.io|zendesk\.com|freshdesk\.com|stripe\.com|paypal\.com|docusign\.(?:com|net)|hellosign\.com|typeform\.com|acuityscheduling\.com|cal\.com)$/i,
];
// Automated SUBJECTS (system notifications), tested against the subject line only.
const subjectSkipPatterns = [/^new\s+event:/i, /(verification|confirmation)\s*code/i, /^(your|tu) .*(code|código)/i];
// The old "not interested / unsubscribe / out of office" body patterns are GONE on purpose: the
// server's category already separates those (and they are in NEVER_REPLY), and the model gets a
// final veto with __SKIP__. Matching "no me interesa" inside a body silently buried replies like
// "no me interesa el plan grande, pero sí el pequeño".

function linkifyText(text: string): string {
  // Convert URLs to clickable HTML links
  return text.replace(
    /(https?:\/\/[^\s<>"')\]]+)/gi,
    '<a href="$1" style="color:#2563eb;text-decoration:underline;" target="_blank">$1</a>'
  );
}

function textToHtml(text: string): string {
  if (/<(p|div|br)\b/i.test(text)) {
    // Already HTML, but still linkify plain URLs
    return linkifyText(text);
  }
  return text
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p>${linkifyText(p.replace(/\n/g, '<br>'))}</p>`)
    .join('');
}

/** Message-IDs go on the wire inside angle brackets, exactly once. */
function wrapId(id: string): string {
  const t = (id || "").trim();
  if (!t) return "";
  return t.startsWith("<") ? t : `<${t}>`;
}
/** References is a SPACE-SEPARATED chain; wrapping the whole chain in one pair of brackets (what
 *  the old code did when it was handed more than one id) produces a header Gmail ignores. */
function wrapRefs(refs: string): string {
  return (refs || "").trim().split(/\s+/).filter(Boolean).map(wrapId).join(" ");
}

async function sendSmtpReply(
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
      if (inReplyTo) headers += `\r\nIn-Reply-To: ${wrapId(inReplyTo)}`;
      if (references) headers += `\r\nReferences: ${wrapRefs(references)}`;
      return `${headers}\r\n\r\n${body}\r\n.\r\n`;
    };

    if (port === 587) {
      let resp = await send("EHLO mailreach");
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
    return { ok: false, error: `SMTP error: ${(e as Error).message}` };
  }
}

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

/** One DeepSeek call. Never throws; `transient` says whether a retry could plausibly help. */
async function deepseekOnce(apiKey: string, messages: ChatMsg[], timeoutMs = 20_000): Promise<{ text: string; transient: boolean; error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "deepseek-chat", temperature: 0.4, max_tokens: 500, messages }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 200);
      return { text: "", transient: r.status === 429 || r.status >= 500, error: `AI ${r.status}: ${body}` };
    }
    const j = await r.json();
    const text = String(j?.choices?.[0]?.message?.content || "").trim();
    return { text, transient: false, error: text ? "" : "AI returned empty response" };
  } catch (e) {
    return { text: "", transient: true, error: `AI error: ${(e as Error).message}` };
  } finally {
    clearTimeout(t);
  }
}

/** One call plus a single retry on a transient failure (429 / 5xx / timeout / network). */
async function deepseekChat(apiKey: string, messages: ChatMsg[]): Promise<{ text: string; error: string }> {
  const first = await deepseekOnce(apiKey, messages);
  if (first.text || !first.transient) return { text: first.text, error: first.error };
  await new Promise((r) => setTimeout(r, 800));
  const second = await deepseekOnce(apiKey, messages);
  return { text: second.text, error: second.error };
}

function countWords(s: string): number {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

function replySubjectOf(subject: string | null): string {
  const original = (subject || "").trim();
  if (!original) return "Re:";
  return /^re\s*:/i.test(original) ? original : `Re: ${original}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // ── AUTH: cron shared secret, or the service role for manual runs ──────────────────────────
    const cronSecret = Deno.env.get("REPORTS_CRON_SECRET") || "";
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const authorised = (cronSecret && (body as any)?.secret === cronSecret) || (svc && auth === svc);
    if (!authorised) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dryRun = (body as any)?.dry_run === true;
    const onlyAgentId = String((body as any)?.agent_id || "").trim();

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, svc);
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY") || "";
    if (!DEEPSEEK_API_KEY) {
      return new Response(JSON.stringify({ error: "DEEPSEEK_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let agentsQuery = admin.from("auto_reply_rules").select("*").eq("is_active", true);
    if (onlyAgentId) agentsQuery = agentsQuery.eq("id", onlyAgentId);
    const { data: agents, error: agentsErr } = await agentsQuery;
    if (agentsErr) throw new Error(agentsErr.message);
    if (!agents || agents.length === 0) {
      return new Response(JSON.stringify({ dry_run: dryRun, agents: [], totals: { candidates: 0, drafted: 0, sent: 0 }, message: "No active agents" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyByUser = new Map<string, string>();
    const summaries: Record<string, unknown>[] = [];
    const totals = { candidates: 0, skipped_by_rule: 0, skipped_by_ai: 0, drafted: 0, sent: 0, failed: 0 };
    let outOfTime = false;

    for (const agent of agents as any[]) {
      if (Date.now() - startedAt > RUN_BUDGET_MS) { outOfTime = true; break; }
      const agentStart = Date.now();
      const stat = {
        agent: agent.name || agent.id, agent_id: agent.id, mode: agent.reply_mode || "draft",
        candidates: 0, skipped_by_rule: 0, skipped_by_ai: 0, drafted: 0, sent: 0, failed: 0,
        ms: 0, note: "" as string, preview: [] as Record<string, string>[],
      };

      try {
        // ── b. SCOPE → the mailboxes this agent watches ────────────────────────────────────────
        const scopeType = String(agent.scope_type || "account");
        const campaignIds: string[] = Array.isArray(agent.campaign_ids) ? agent.campaign_ids : [];
        const { data: allAccounts } = await admin
          .from("email_accounts")
          .select("*")
          .eq("user_id", agent.user_id)
          .eq("status", "connected");
        const accounts = (allAccounts || []) as any[];
        const accountById = new Map<string, any>(accounts.map((a) => [a.id, a]));
        /** Our own addresses — an agent must never answer a colleague's mailbox. */
        const ourEmails = new Set(accounts.map((a) => String(a.email || "").toLowerCase()));

        let accountIds: string[] = [];
        if (scopeType === "campaign") {
          // Which mailboxes do the chosen campaigns send from? Campaign→mailbox is by tag overlap
          // (campaigns.account_tags ↔ email_accounts.tags), the same rule the sending engine uses.
          const { data: camps } = await admin
            .from("campaigns").select("id, account_tags")
            .eq("user_id", agent.user_id).in("id", campaignIds.length ? campaignIds : ["00000000-0000-0000-0000-000000000000"]);
          const tags = new Set<string>();
          for (const c of camps || []) for (const t of ((c as any).account_tags || [])) tags.add(t);
          accountIds = accounts.filter((a) => (a.tags || []).some((t: string) => tags.has(t))).map((a) => a.id);
        } else if (scopeType === "tags") {
          // Legacy scope: explicit account_ids plus tag overlap.
          const explicit = new Set<string>((agent.account_ids || []).map(String));
          const ruleTags: string[] = agent.account_tags || [];
          accountIds = accounts
            .filter((a) => explicit.has(a.id) || (a.tags || []).some((t: string) => ruleTags.includes(t)))
            .map((a) => a.id);
        } else {
          accountIds = accounts.map((a) => a.id);
        }

        if (accountIds.length === 0 && !(scopeType === "campaign" && campaignIds.length > 0)) {
          stat.note = "sin buzones en el ámbito";
          stat.ms = Date.now() - agentStart;
          summaries.push(stat);
          continue;
        }

        // ── c. CANDIDATE MESSAGES ─────────────────────────────────────────────────────────────
        // Only server-judged mail ('IA' marker) in a category the agent acts on, never a category
        // in NEVER_REPLY, old enough for the configured delay and young enough to still matter.
        const chosen: string[] = String(agent.category_mode || "specific") === "all"
          ? CATEGORY_LABELS.slice()
          : (Array.isArray(agent.categories) ? agent.categories : []);
        const allowed = chosen.filter((c) => CATEGORY_LABELS.includes(c) && !NEVER_REPLY.includes(c));
        if (allowed.length === 0) {
          stat.note = "el agente no tiene ninguna categoría respondible";
          stat.ms = Date.now() - agentStart;
          summaries.push(stat);
          continue;
        }

        const delayMinutes = Number(agent.delay_minutes) || 0;
        const delayCutoff = new Date(Date.now() - delayMinutes * 60_000).toISOString();
        const lookbackFrom = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();

        let msgQuery = admin
          .from("inbox_messages")
          .select("id, user_id, account_id, campaign_id, from_email, from_name, subject, body_text, body_html, labels, message_id, ref_chain, received_at")
          .eq("user_id", agent.user_id)
          .eq("is_warmup", false)
          .eq("is_archived", false)
          .eq("auto_replied", false)
          .gte("received_at", lookbackFrom)
          .lte("received_at", delayCutoff)
          .contains("labels", [AI_MARKER])
          .overlaps("labels", allowed);

        if (scopeType === "campaign" && campaignIds.length > 0) {
          // A reply LINKED to one of the chosen campaigns counts even if the mailbox drifted out
          // of the tag set; the mailbox match is the fallback.
          const parts = [`campaign_id.in.(${campaignIds.join(",")})`];
          if (accountIds.length > 0) parts.push(`account_id.in.(${accountIds.join(",")})`);
          msgQuery = msgQuery.or(parts.join(","));
        } else {
          msgQuery = msgQuery.in("account_id", accountIds);
        }

        // Oldest first: a reply that has been waiting longest is answered first.
        const { data: msgs, error: msgsErr } = await msgQuery
          .order("received_at", { ascending: true })
          .limit(MAX_MESSAGES_PER_AGENT);
        if (msgsErr) throw new Error(msgsErr.message);
        const messages = (msgs || []) as any[];
        stat.candidates = messages.length;

        // ── d/e/f/g. per message ──────────────────────────────────────────────────────────────
        const markDone = async (id: string) => {
          if (!dryRun) await admin.from("inbox_messages").update({ auto_replied: true }).eq("id", id);
        };

        const mode = String(agent.reply_mode || "draft") === "auto" ? "auto" : "draft";

        // Agent daily cap: how many replies this agent has ALREADY produced today (UTC day).
        // In 'auto' that is what it SENT. In 'draft' nothing is ever sent by this function, so the
        // cap would be meaningless — there we count the drafts, which is what the cap is really
        // for: bounding how much one misconfigured agent can generate in a day.
        const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
        const maxPerDay = Number(agent.max_replies_per_day) || 0;
        const { count: sentTodayCount } = await admin
          .from("auto_reply_log").select("id", { count: "exact", head: true })
          .eq("rule_id", agent.id).in("status", mode === "auto" ? ["sent"] : ["sent", "draft"])
          .gte("created_at", todayStart.toISOString());
        let agentSentToday = Number(sentTodayCount) || 0;

        // Company name for the prompt — one lookup per user across the whole run.
        if (!companyByUser.has(agent.user_id)) {
          const { data: prof } = await admin.from("profiles").select("company_name").eq("user_id", agent.user_id).maybeSingle();
          companyByUser.set(agent.user_id, String((prof as any)?.company_name || "").trim());
        }
        const company = companyByUser.get(agent.user_id) || "";

        const [, maxWords] = REPLY_LENGTH_WORDS[String(agent.length || "medium")] || REPLY_LENGTH_WORDS.medium;

        for (const msg of messages) {
          if (Date.now() - startedAt > RUN_BUDGET_MS) { outOfTime = true; break; }

          try {
            const fromEmail = String(msg.from_email || "").toLowerCase();
            const subject = String(msg.subject || "");

            // 1. robots -------------------------------------------------------------------------
            const robot = senderSkipPatterns.some((p) => p.test(fromEmail)) || subjectSkipPatterns.some((p) => p.test(subject));
            if (robot) { stat.skipped_by_rule++; await markDone(msg.id); continue; }

            // 2. ourselves ----------------------------------------------------------------------
            if (!fromEmail || ourEmails.has(fromEmail)) { stat.skipped_by_rule++; await markDone(msg.id); continue; }

            // 3. a human (or a previous run) already dealt with this thread ----------------------
            const { data: alreadyLogged } = await admin
              .from("auto_reply_log").select("id").eq("inbox_message_id", msg.id).limit(1);
            if (alreadyLogged && alreadyLogged.length > 0) { stat.skipped_by_rule++; await markDone(msg.id); continue; }

            const { data: humanReply } = await admin
              .from("sent_emails").select("id")
              .eq("account_id", msg.account_id).eq("to_email", msg.from_email)
              .gt("sent_at", msg.received_at).limit(1);
            if (humanReply && humanReply.length > 0) { stat.skipped_by_rule++; await markDone(msg.id); continue; }

            // 4. this agent already wrote to this address in the last 24 h -----------------------
            const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
            const { data: recent } = await admin
              .from("auto_reply_log").select("id")
              .eq("rule_id", agent.id).eq("to_email", msg.from_email).eq("status", "sent")
              .gte("created_at", since24h).limit(1);
            if (recent && recent.length > 0) { stat.skipped_by_rule++; await markDone(msg.id); continue; }

            // 5. the agent's daily cap. NOT marked: capacity is not a verdict on the message.
            if (maxPerDay > 0 && agentSentToday >= maxPerDay) {
              stat.skipped_by_rule++;
              stat.note = "tope diario del agente alcanzado";
              break;
            }

            // The mailbox we will answer from (a campaign-linked reply can sit outside the tag set).
            let account = accountById.get(msg.account_id);
            if (!account && msg.account_id) {
              const { data: acc } = await admin.from("email_accounts").select("*").eq("id", msg.account_id).maybeSingle();
              if (acc) { account = acc; accountById.set(msg.account_id, acc); }
            }
            if (!account) { stat.skipped_by_rule++; await markDone(msg.id); continue; }

            // 6. the mailbox's daily cap. Also NOT marked — tomorrow it can still go out.
            if (mode === "auto" && Number(account.daily_limit) > 0 && Number(account.sent_today || 0) >= Number(account.daily_limit)) {
              stat.skipped_by_rule++;
              continue;
            }

            // ── e. the text we judge and answer ───────────────────────────────────────────────
            const replyText = replyTextForClassification(msg.body_text, msg.body_html);
            if (!replyText || replyText.replace(/\s+/g, "").length < 2) { stat.skipped_by_rule++; await markDone(msg.id); continue; }

            // Thread context: the last thing WE sent this address from this mailbox.
            let ourLastEmail = "";
            const { data: lastOut } = await admin
              .from("sent_emails").select("subject, body")
              .eq("account_id", msg.account_id).eq("to_email", msg.from_email)
              .not("sent_at", "is", null)
              .order("sent_at", { ascending: false }).limit(1).maybeSingle();
            if (lastOut) {
              const plain = textFromHtml(String((lastOut as any).body || "")) || String((lastOut as any).body || "");
              ourLastEmail = `${String((lastOut as any).subject || "")}\n${plain}`.trim().slice(0, 1200);
            }

            const senderName = String(agent.signature_name || "").trim()
              || [account.first_name, account.last_name].filter(Boolean).join(" ").trim()
              || String(account.email || "").split("@")[0];

            // ── f. generate ──────────────────────────────────────────────────────────────────
            const systemPrompt = buildReplyAgentSystemPrompt({
              primary_goal: String(agent.primary_goal || "book_meeting"),
              custom_goal: String(agent.custom_goal || ""),
              tone: String(agent.tone || "professional"),
              length: String(agent.length || "medium"),
              style_prompt: String(agent.style_prompt || agent.prompt || ""),
              business_context: String(agent.business_context || agent.company_info || ""),
              objection_handling: String(agent.objection_handling || ""),
              resources: Array.isArray(agent.resources) ? agent.resources : [],
              signature_name: senderName,
              company,
            });
            const userPrompt = buildReplyAgentUserPrompt({
              fromName: msg.from_name, fromEmail: msg.from_email, subject: msg.subject,
              replyText, ourLastEmail, senderName,
            });

            const chat: ChatMsg[] = [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }];
            let { text: aiText, error: aiErr } = await deepseekChat(DEEPSEEK_API_KEY, chat);

            if (!aiText) {
              stat.failed++;
              if (!dryRun) {
                await admin.from("auto_reply_log").insert({
                  user_id: agent.user_id, rule_id: agent.id, inbox_message_id: msg.id,
                  to_email: msg.from_email, subject: subject, draft_subject: "",
                  ai_response: "", status: "failed", mode, error_message: aiErr || "AI failed",
                });
              }
              await markDone(msg.id);
              continue;
            }

            // The model's veto: an automatic reply, a rejection, a bounce.
            if (aiText.includes("__SKIP__")) {
              stat.skipped_by_ai++;
              if (!dryRun) {
                await admin.from("auto_reply_log").insert({
                  user_id: agent.user_id, rule_id: agent.id, inbox_message_id: msg.id,
                  to_email: msg.from_email, subject: subject, draft_subject: "",
                  ai_response: "", status: "skipped", mode, error_message: "skipped_by_ai",
                });
              }
              await markDone(msg.id);
              continue;
            }

            // Loose length enforcement: only when it badly overshoots, and only one extra call.
            if (countWords(aiText) > Math.round(maxWords * 1.6)) {
              const shorter = await deepseekChat(DEEPSEEK_API_KEY, [
                ...chat,
                { role: "assistant", content: aiText },
                { role: "user", content: `Acorta a máximo ${maxWords} palabras. Devuelve solo el cuerpo del correo.` },
              ]);
              if (shorter.text && !shorter.text.includes("__SKIP__")) aiText = shorter.text;
            }

            const replySubject = replySubjectOf(msg.subject);
            const htmlBody = textToHtml(aiText);

            // ── g. draft or send ─────────────────────────────────────────────────────────────
            if (mode === "draft") {
              // Nothing leaves the building. The reply is parked for a human; the message is
              // marked so the next tick does not pay for the same generation twice.
              if (!dryRun) {
                await admin.from("auto_reply_log").insert({
                  user_id: agent.user_id, rule_id: agent.id, inbox_message_id: msg.id,
                  to_email: msg.from_email, subject: subject, draft_subject: replySubject,
                  ai_response: aiText, status: "draft", mode: "draft",
                });
                await markDone(msg.id);
              }
              stat.drafted++;
              agentSentToday++;
              if (stat.preview.length < 5) stat.preview.push({ to: String(msg.from_email), subject: replySubject, body: aiText.slice(0, 300) });
              continue;
            }

            if (dryRun) {
              stat.sent++;   // what it WOULD have sent
              if (stat.preview.length < 5) stat.preview.push({ to: String(msg.from_email), subject: replySubject, body: aiText.slice(0, 300) });
              continue;
            }

            const cleanMsgId = msg.message_id ? String(msg.message_id).replace(/^<|>$/g, "") : null;
            const references = [msg.ref_chain, cleanMsgId].filter(Boolean).join(" ").trim() || cleanMsgId;
            const smtpFromName = [account.first_name, account.last_name].filter(Boolean).join(" ") || null;

            const result = await sendSmtpReply(
              account.smtp_host, account.smtp_port,
              account.smtp_username, account.smtp_password,
              account.email, msg.from_email,
              replySubject, htmlBody,
              cleanMsgId, references,
              smtpFromName
            );

            const now = new Date().toISOString();
            await admin.from("auto_reply_log").insert({
              user_id: agent.user_id, rule_id: agent.id, inbox_message_id: msg.id,
              to_email: msg.from_email, subject: subject, draft_subject: replySubject,
              ai_response: aiText, status: result.ok ? "sent" : "failed", mode: "auto",
              error_message: result.error || null, sent_at: result.ok ? now : null,
            });
            // Marked either way: a send that failed is not retried (retry storms), it is logged.
            await markDone(msg.id);

            if (result.ok) {
              // Mirrored into sent_emails so the thread reads correctly everywhere else — with no
              // campaign_id, because this reply is not a campaign step and must not skew its stats.
              await admin.from("sent_emails").insert({
                user_id: agent.user_id, account_id: msg.account_id,
                to_email: msg.from_email, subject: replySubject, body: htmlBody,
                status: "sent", sent_at: now,
              });
              // Atomic: read-modify-write here could resurrect a stale count across the daily reset.
              const { error: incErr } = await admin.rpc("increment_account_sent", { p_account_id: account.id });
              if (incErr) await admin.from("email_accounts").update({ sent_today: Number(account.sent_today || 0) + 1 }).eq("id", account.id);
              account.sent_today = Number(account.sent_today || 0) + 1;
              agentSentToday++;
              stat.sent++;
            } else {
              stat.failed++;
            }
          } catch (msgError) {
            // Per-message isolation: one bad message never takes the agent (or the run) down.
            stat.failed++;
            console.error(`reply-agent ${agent.id} / message ${msg.id}:`, msgError);
            if (!dryRun) {
              await admin.from("auto_reply_log").insert({
                user_id: agent.user_id, rule_id: agent.id, inbox_message_id: msg.id,
                to_email: msg.from_email, subject: msg.subject || "", draft_subject: "",
                ai_response: "", status: "failed", mode: String(agent.reply_mode || "draft") === "auto" ? "auto" : "draft",
                error_message: msgError instanceof Error ? msgError.message : "Unknown error",
              }).then(() => {}, () => {});
              await markDone(msg.id);
            }
          }
        }
      } catch (agentError) {
        // Per-agent isolation: a broken configuration never stops the other agents.
        stat.note = `error: ${agentError instanceof Error ? agentError.message : "desconocido"}`;
        console.error(`reply-agent ${agent.id}:`, agentError);
      }

      stat.ms = Date.now() - agentStart;
      totals.candidates += stat.candidates;
      totals.skipped_by_rule += stat.skipped_by_rule;
      totals.skipped_by_ai += stat.skipped_by_ai;
      totals.drafted += stat.drafted;
      totals.sent += stat.sent;
      totals.failed += stat.failed;
      summaries.push(stat);
    }

    return new Response(JSON.stringify({
      dry_run: dryRun, agents: summaries, totals, sin_tiempo: outOfTime, ms: Date.now() - startedAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("process-auto-replies error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

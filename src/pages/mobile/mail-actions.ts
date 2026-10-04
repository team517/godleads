import { supabase } from "@/integrations/supabase/client";
import { buildReplyQuoteHtml, cleanBodyHtml, decodeSubject, getMessageDeduplicationKey, isBounceOrNoise } from "@/lib/unibox-text";
import { buildForwardHtml, forwardSubject, plainToForwardHtml } from "@/lib/forward";
import { containsProfanity } from "@/lib/profanity-filter";
import { quoteHeader, replySubject } from "@/lib/mobile-inbox";

/* Lo que hace la app del móvil con el correo: abrir el hilo, responder y reenviar. Es la misma
   lógica que la Unibox del escritorio (mismo hilo, misma cita, misma firma, mismo send-email),
   para que una respuesta desde el móvil salga idéntica a una desde el ordenador. */

// Los tipos generados de la BD están desfasados (faltan columnas): consultas sin tipar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any; functions: typeof supabase.functions };

export interface ThreadMessage {
  id: string;
  _type: "received" | "sent";
  _forward?: boolean;
  _date: string;
  account_id: string;
  from_email?: string | null;
  from_name?: string | null;
  to_email?: string | null;
  to_emails?: string | null;
  cc_emails?: string | null;
  subject?: string | null;
  body?: string | null;
  body_html?: string | null;
  body_text?: string | null;
  message_id?: string | null;
  smtp_message_id?: string | null;
  ref_chain?: string | null;
  received_at?: string | null;
  sent_at?: string | null;
  attachments?: { name: string; mime: string; size: number; path: string; oversized?: boolean }[] | null;
  /** Envío que rebotó después de salir (lo marca la sincronización) y su motivo. */
  bounced_at?: string | null;
  error_message?: string | null;
  lead_id?: string | null;
  campaign_id?: string | null;
  is_warmup?: boolean | null;
  forwarded_from?: string | null;
}

/** El hilo entero con un contacto en un buzón: lo que nos escribió y lo que le enviamos. */
export async function loadThread(userId: string, accountId: string, contact: string, opts: { all?: boolean } = {}): Promise<ThreadMessage[]> {
  const [inboxRes, sentRes] = await Promise.all([
    db.from("inbox_messages").select("*")
      .eq("user_id", userId).eq("account_id", accountId).eq("from_email", contact)
      .order("received_at", { ascending: true }),
    db.from("sent_emails").select("*")
      .eq("user_id", userId).eq("account_id", accountId).eq("to_email", contact).eq("status", "sent")
      .order("sent_at", { ascending: true }),
  ]);
  if (inboxRes.error) throw new Error(inboxRes.error.message);
  const thread: ThreadMessage[] = [];
  const seen = new Set<string>();
  for (const m of (inboxRes.data || []) as ThreadMessage[]) {
    const key = getMessageDeduplicationKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    // Primary: fuera rebotes y warm-up. Others (opts.all): todo, como en la lista.
    if (!opts.all && isBounceOrNoise(m.from_email ?? null)) continue;
    if (!opts.all && m.is_warmup && !m.lead_id && !m.campaign_id) continue;
    thread.push({ ...m, _type: "received", _date: String(m.received_at) });
  }
  const sentIds = new Set<string>();
  for (const s of (sentRes.data || []) as ThreadMessage[]) {
    sentIds.add(s.id);
    thread.push({ ...s, _type: "sent", _date: String(s.sent_at) });
  }
  const inboxIds = ((inboxRes.data || []) as { id: string }[]).map((m) => m.id);
  if (inboxIds.length) {
    const { data: fwd } = await db.from("sent_emails").select("*")
      .eq("user_id", userId).eq("status", "sent").in("forwarded_from", inboxIds)
      .order("sent_at", { ascending: true });
    for (const f of (fwd || []) as ThreadMessage[]) {
      if (sentIds.has(f.id)) continue;
      thread.push({ ...f, _type: "sent", _forward: true, _date: String(f.sent_at) });
    }
  }
  thread.sort((a, b) => new Date(a._date).getTime() - new Date(b._date).getTime());
  return thread;
}

/** Que una respuesta de la IA figure en el hilo como enviada (idempotente; en segundo plano). */
export async function ensureAiSentThread(accountId: string, contact: string): Promise<void> {
  try { await db.functions.invoke("ensure-ai-sent-thread", { body: { contact, account_id: accountId } }); } catch { /* no es grave */ }
}

export interface Outgoing {
  accountId: string;
  to: string;
  cc: string[];
  subject: string;
  /** Texto fuente del editor (editorToSource). */
  body: string;
  attachments: { filename: string; mime: string; base64: string }[];
}

export type LinkFix = { from: string; to: string };

async function callSendEmail(payload: Record<string, unknown>): Promise<{ linkFixes: LinkFix[] }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesión no válida. Vuelve a entrar en la app.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let result: { error?: string; link_fixes?: LinkFix[] } | null = null;
    try { result = await resp.json(); } catch { /* sin cuerpo */ }
    if (!resp.ok || !result || result.error) {
      throw new Error(result?.error || `No se pudo enviar (HTTP ${resp.status}). El correo NO ha salido.`);
    }
    return { linkFixes: Array.isArray(result.link_fixes) ? result.link_fixes : [] };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("El envío tardó demasiado. El correo NO se confirmó: inténtalo de nuevo.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function signatureOf(accountId: string): Promise<string> {
  const { data } = await db.from("email_accounts").select("signature_html").eq("id", accountId).maybeSingle();
  return String((data as { signature_html?: string | null } | null)?.signature_html || "").trim();
}

/** Responder dentro del hilo, igual que el escritorio (In-Reply-To, References, cita y firma). */
export async function sendReply(userId: string, thread: ThreadMessage[], out: Outgoing): Promise<{ linkFixes: LinkFix[] }> {
  if (!out.body.trim() && out.attachments.length === 0) throw new Error("Escribe la respuesta antes de enviarla.");
  if (containsProfanity(out.body)) throw new Error("Tu respuesta contiene lenguaje inapropiado. Cámbiala antes de enviar.");
  const received = thread.filter((m) => m._type === "received" && m.message_id);
  const target = received.length ? received[received.length - 1] : thread.filter((m) => m._type === "received").pop();
  let targetMsgId = target?.message_id || "";
  let targetRefs = target?.ref_chain || "";
  if (!targetMsgId) {
    const { data } = await db.from("inbox_messages").select("message_id, ref_chain")
      .eq("user_id", userId).eq("from_email", out.to).not("message_id", "is", null)
      .order("received_at", { ascending: false }).limit(1).maybeSingle();
    const last = data as { message_id?: string; ref_chain?: string } | null;
    if (last?.message_id) { targetMsgId = last.message_id; if (!targetRefs) targetRefs = last.ref_chain || ""; }
  }
  const signature = await signatureOf(out.accountId);
  const quoteHtml = target ? buildReplyQuoteHtml(target) : "";
  const header = target ? quoteHeader(target) : "";
  return callSendEmail({
    account_id: out.accountId,
    to_email: out.to,
    subject: out.subject || replySubject(target?.subject),
    body: out.body,
    in_reply_to: targetMsgId || undefined,
    references: [targetRefs, targetMsgId].filter(Boolean).join(" ").trim() || undefined,
    signature_html: signature || undefined,
    quote_html: quoteHtml || undefined,
    quote_header: header || undefined,
    attachments: out.attachments,
    cc: out.cc,
  });
}

/** Reenviar el mensaje a otra dirección desde el mismo buzón (queda en esta conversación). */
export async function sendForward(source: ThreadMessage, accountEmail: string, out: Outgoing): Promise<{ linkFixes: LinkFix[] }> {
  if (!out.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.to)) throw new Error("Pon un email de destino válido.");
  const origSubject = decodeSubject(source.subject ?? null) || "";
  const origHtml = (source.body_html && source.body_html.trim().length > 20)
    ? cleanBodyHtml(source.body_html, true)
    : plainToForwardHtml(source.body_text || source.body || "");
  const html = buildForwardHtml({
    fromName: source.from_name ?? null,
    fromEmail: source.from_email ?? "",
    when: new Date(source._date).toLocaleString("es"),
    subject: origSubject,
    toAccountEmail: accountEmail,
    originalHtml: origHtml,
  }, out.body);
  return callSendEmail({
    account_id: out.accountId,
    to_email: out.to,
    subject: out.subject || forwardSubject(origSubject),
    body: html,
    in_reply_to: source.message_id || undefined,
    references: [source.ref_chain, source.message_id].filter(Boolean).join(" ").trim() || undefined,
    kind: "forward",
    forwarded_from: source._type === "received" ? source.id : undefined,
    attachments: out.attachments,
    cc: out.cc,
  });
}

/** Buzones del usuario que coinciden con lo escrito (para el desplegable "De"). */
export async function searchAccounts(userId: string, q: string): Promise<{ id: string; email: string }[]> {
  let query = db.from("email_accounts").select("id, email").eq("user_id", userId).order("email").limit(40);
  const t = q.trim().replace(/[\\%_]/g, (c) => "\\" + c);
  if (t) query = query.ilike("email", `%${t}%`);
  const { data } = await query;
  return (data || []) as { id: string; email: string }[];
}

export interface LeadInfo {
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  website: string | null;
  campaign: string | null;
  mailbox: string | null;
  firstContact: string | null;
  fields: [string, string][];
}

const HIDDEN_FIELDS = new Set(["first_name", "last_name", "company_name", "company", "phone", "website", "email"]);

/** Lo que sabemos del contacto (ficha del lead, campaña, buzón y primer envío). */
export async function loadLeadInfo(userId: string, email: string, leadId: string | null, campaignName: string | null, mailbox: string | null): Promise<LeadInfo> {
  let lead: { email?: string; custom_fields?: Record<string, unknown> | null } | null = null;
  if (leadId) {
    const { data } = await db.from("leads").select("email, custom_fields").eq("id", leadId).maybeSingle();
    lead = data;
  }
  if (!lead) {
    const { data } = await db.from("leads").select("email, custom_fields").eq("user_id", userId).eq("email", email).limit(1).maybeSingle();
    lead = data;
  }
  const cf = (lead?.custom_fields || {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  const name = [str(cf.first_name), str(cf.last_name)].filter(Boolean).join(" ") || null;
  const { data: first } = await db.from("sent_emails").select("sent_at").eq("user_id", userId).eq("to_email", email)
    .eq("status", "sent").order("sent_at", { ascending: true }).limit(1).maybeSingle();
  const fields = Object.entries(cf)
    .filter(([k, v]) => !HIDDEN_FIELDS.has(k) && str(v))
    .slice(0, 12)
    .map(([k, v]) => [k.replace(/_/g, " "), String(str(v))] as [string, string]);
  return {
    email,
    name,
    company: str(cf.company_name) || str(cf.company),
    phone: str(cf.phone),
    website: str(cf.website),
    campaign: campaignName,
    mailbox,
    firstContact: (first as { sent_at?: string } | null)?.sent_at || null,
    fields,
  };
}

/** Enlace temporal a un adjunto guardado. */
export async function attachmentUrl(path: string, download?: string): Promise<string | null> {
  const { data } = await supabase.storage.from("inbox-attachments").createSignedUrl(path, 3600, download ? { download } : undefined);
  return data?.signedUrl || null;
}

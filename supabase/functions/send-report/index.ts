import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { buildReportDoc } from "../_shared/report/buildReportPdf.ts";
import type { ReportData } from "../_shared/report/types.ts";

// ── Scheduled / manual sender of the client PDF reports ──────────────────────
// Modes:
//   { mode:"cron", secret, kind:"48h"|"weekly" }        → all enabled+due clients
//   { mode:"manual", client_user_id, kind, dry_run?, test_to? }  (admin/manager JWT)
// Generates the SAME corporate PDF as the browser preview (shared builder), server-
// side with jsPDF, stores it in the private `client-reports` bucket, logs it, and
// emails it as an attachment from the client's configured sending account.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── base64 of a byte array (chunked so large PDFs don't blow the call stack) ──
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(bin);
}

const b64utf8 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const mimeWord = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`);

// A valid RFC 5322 From header. The display name must be QUOTED when it's ASCII
// (a raw name containing "@"/"."/etc. is an invalid atom — IONOS then reads it as
// the sender address and rejects with "554 Unauthorized sender address"), or an
// encoded-word when it has non-ASCII. Falls back to just the address.
function fromHeader(name: string, addr: string): string {
  const clean = (name || "").replace(/[\r\n]/g, "").trim();
  if (!clean) return `<${addr}>`;
  if (/^[\x20-\x7E]*$/.test(clean)) return `"${clean.replace(/([\\"])/g, "\\$1")}" <${addr}>`;
  return `${mimeWord(clean)} <${addr}>`;
}

function pngSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
  const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
  return { w, h };
}
function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xC0 && m <= 0xC3) { return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }; }
    const len = (b[i + 2] << 8) | b[i + 3];
    i += 2 + len;
  }
  return null;
}

// Fetch the client logo and return a PNG/JPEG data URL + dimensions. jsPDF can only
// embed PNG/JPEG (no canvas server-side), so webp/svg logos are skipped gracefully.
async function fetchLogo(url: string | null | undefined): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = new Uint8Array(await resp.arrayBuffer());
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    let mime = "";
    if (ct.includes("png") || (buf[0] === 0x89 && buf[1] === 0x50)) mime = "image/png";
    else if (ct.includes("jpeg") || ct.includes("jpg") || (buf[0] === 0xFF && buf[1] === 0xD8)) mime = "image/jpeg";
    else return null;
    const dims = mime === "image/png" ? pngSize(buf) : jpegSize(buf);
    return { dataUrl: `data:${mime};base64,${bytesToB64(buf)}`, w: dims?.w || 300, h: dims?.h || 100 };
  } catch { return null; }
}

// ── Minimal SMTP sender with a PDF attachment (implicit TLS 465 / STARTTLS 587) ──
async function sendSmtp(
  host: string, port: number, username: string, password: string,
  from: string, fromName: string, to: string, subject: string, body: string,
  attachments: { filename: string; mime: string; base64: string }[],
): Promise<{ ok: boolean; error?: string; transcript?: string[] }> {
  const log: string[] = [];
  try {
    let conn: Deno.Conn = port === 465
      ? await Deno.connectTls({ hostname: host, port })
      : await Deno.connect({ hostname: host, port });
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    // Robust multi-line SMTP read: keep reading until the final "NNN <text>" line
    // (a space after the code) — a single read() can return partial or multiple
    // responses, which silently desynced the old sender.
    const readResponse = async (): Promise<string> => {
      let result = "";
      while (true) {
        const b = new Uint8Array(4096);
        const n = await conn.read(b);
        if (!n) break;
        result += dec.decode(b.subarray(0, n));
        const lines = result.split("\r\n").filter((l) => l.length > 0);
        const last = lines[lines.length - 1] || "";
        if (/^\d{3} /.test(last)) break;
      }
      return result;
    };
    const cmd = async (c: string, label?: string) => {
      await conn.write(enc.encode(c + "\r\n"));
      const r = await readResponse();
      log.push(`${label || c.split(" ")[0]} => ${r.trim().slice(0, 100)}`);
      return r.trim();
    };
    const code2 = (r: string) => /^2\d\d/.test(r);
    const greet = await readResponse();
    log.push(`GREETING => ${greet.trim().slice(0, 80)}`);
    if (port !== 465) {
      const ehlo = await cmd("EHLO onepulso", "EHLO");
      if (/STARTTLS/i.test(ehlo)) { await conn.write(enc.encode("STARTTLS\r\n")); await readResponse(); conn = await Deno.startTls(conn as Deno.TcpConn, { hostname: host }); log.push("STARTTLS => upgraded"); }
      else { try { conn.close(); } catch { /* */ } return { ok: false, error: "El servidor SMTP no ofrece STARTTLS; no se envían credenciales sin cifrar.", transcript: log }; }
    }
    await cmd("EHLO onepulso", "EHLO2");
    const auth = await cmd(`AUTH PLAIN ${btoa(`\0${username}\0${password}`)}`, "AUTH");
    if (!auth.startsWith("235")) { try { conn.close(); } catch { /* */ } return { ok: false, error: `Auth: ${auth}`, transcript: log }; }
    const mf = await cmd(`MAIL FROM:<${from}>`, "MAIL");
    if (!code2(mf)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `MAIL FROM rechazado: ${mf}`, transcript: log }; }
    const rc = await cmd(`RCPT TO:<${to}>`, "RCPT");
    if (!code2(rc)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `RCPT rechazado: ${rc}`, transcript: log }; }
    const dt = await cmd("DATA", "DATA");
    if (!/^3\d\d/.test(dt)) { try { conn.close(); } catch { /* */ } return { ok: false, error: `DATA rechazado: ${dt}`, transcript: log }; }

    const boundary = `=_op_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    const b64wrap = (s: string) => (s.replace(/[^A-Za-z0-9+/=]/g, "").match(/.{1,76}/g) || []).join("\r\n");
    const fromDomain = from.split("@")[1] || "localhost";
    const dateHeader = new Date().toUTCString().replace("GMT", "+0000");
    const messageId = `<${Math.random().toString(36).slice(2)}${Date.now().toString(36)}@${fromDomain}>`;
    const parts: string[] = [
      [
        `From: ${fromHeader(fromName, from)}`,
        `To: ${to}`,
        `Subject: ${mimeWord(subject)}`,
        `Reply-To: <${from}>`,
        `Date: ${dateHeader}`,
        `Message-ID: ${messageId}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ].join("\r\n"),
      "",
      `--${boundary}`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      b64wrap(b64utf8(body)),
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
    const msg = parts.join("\r\n");
    // Write the DATA payload, then the terminator on its own line, then read the result.
    await conn.write(enc.encode(msg + "\r\n.\r\n"));
    const fin = (await readResponse()).trim();
    log.push(`DATA-END => ${fin.slice(0, 100)}`);
    try { await cmd("QUIT", "QUIT"); } catch { /* */ }
    try { conn.close(); } catch { /* */ }
    if (code2(fin)) return { ok: true, transcript: log };
    return { ok: false, error: `Envío rechazado: ${fin}`, transcript: log };
  } catch (e) { return { ok: false, error: String((e as any)?.message || e), transcript: log }; }
}

function toReportData(kind: "48h" | "weekly", clientName: string, bundle: any): ReportData {
  const campaigns = ((bundle?.campaigns) || []).map((c: any) => ({
    name: c.name, sent: c.sent || 0, contacted: c.contacted || 0, replied: c.replied || 0,
    opened: c.opened || 0, bounced: c.bounced || 0, positive: c.positive || 0, sequences: c.sequences || 0,
    remaining: c.remaining || 0, periodSent: c.period_sent || 0, periodNewContacts: c.period_new_contacts || 0,
    periodReplies: c.period_replies || 0, daily: c.daily || [],
  }));
  const sum = (f: (b: any) => number) => campaigns.reduce((a: number, b: any) => a + f(b), 0);
  const totals = {
    sent: sum((b) => b.sent), contacted: sum((b) => b.contacted), replied: sum((b) => b.replied),
    opened: sum((b) => b.opened), bounced: sum((b) => b.bounced), positive: sum((b) => b.positive),
    remaining: sum((b) => b.remaining), periodSent: sum((b) => b.periodSent),
    periodNewContacts: sum((b) => b.periodNewContacts), periodReplies: sum((b) => b.periodReplies),
  };
  const replyRate = totals.contacted > 0 ? (totals.replied / totals.contacted) * 100 : 0;
  return {
    kind, clientName,
    periodLabel: kind === "weekly" ? "Repaso de la última semana" : "Últimas 48 horas",
    generatedAtLabel: new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }),
    totals, replyRate, campaigns,
    narrative: { summary: "", highlights: [], nextSteps: [], suggestions: [], alert: null },
  };
}

async function fetchNarrative(data: ReportData, threshold: number) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/report-analyze`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: data.kind, clientName: data.clientName, periodLabel: data.periodLabel,
        month: new Date().getMonth() + 1,
        totals: data.totals, replyRate: data.replyRate, lowContacts: data.totals.remaining < threshold,
        campaigns: data.campaigns.map((b) => ({
          name: b.name, contacted: b.contacted, sent: b.sent, replied: b.replied, positive: b.positive,
          remaining: b.remaining, periodNewContacts: b.periodNewContacts, periodReplies: b.periodReplies,
        })),
      }),
    });
    const j = await resp.json();
    if (j?.narrative) return j.narrative;
  } catch { /* fall through */ }
  return { summary: "", highlights: [], nextSteps: [], suggestions: [], alert: null };
}

// A short, human-written email (text/plain) that shares a LINK to the report — no
// attachment. Rotates the wording so it is NOT identical every time.
function buildEmailBody(pdfUrl: string | null, kind: "48h" | "weekly"): string {
  const periodTxt = kind === "weekly" ? "de esta semana" : "de estos días";
  const openers = [
    `Te paso el link para que veas el estudio que hemos hecho de tu campaña ${periodTxt}:`,
    `Aquí tienes el análisis que hemos preparado de tu campaña ${periodTxt}, échale un vistazo:`,
    `Te comparto cómo va tu campaña ${periodTxt} — el estudio completo lo tienes aquí:`,
    `Hemos revisado tu campaña y te dejo el informe con los resultados ${periodTxt}:`,
    `Te paso el análisis actualizado de tu campaña ${periodTxt} para que lo veas:`,
  ];
  const closers = [
    `Dentro tienes el detalle por campaña y las mejoras que vamos a aplicar.`,
    `Ahí verás el detalle completo y los próximos pasos que vamos a dar.`,
    `Encontrarás el desglose por campaña y lo que vamos a optimizar.`,
    `Cualquier duda con el informe, aquí estamos.`,
  ];
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  const lines = [
    `Hola,`,
    ``,
    pick(openers),
    ...(pdfUrl ? ["", pdfUrl] : []),
    ``,
    pick(closers),
    ``,
    `Un saludo,`,
    `OnePulso Team`,
  ];
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

async function logReport(admin: any, userId: string, kind: string, data: ReportData, pdfPath: string | null, sentTo: string | null, ok: boolean, error: string | null, message?: string | null) {
  try {
    await admin.from("client_reports").insert({
      user_id: userId, kind, period_label: data.periodLabel, pdf_path: pdfPath,
      sent_to: sentTo, sent_ok: ok, error, totals: data.totals, message: message || null,
    });
  } catch { /* logging must never break the send */ }
}

interface ClientCtx {
  user_id: string; email: string | null; full_name: string | null; company_name: string | null;
  logo_url: string | null; brand_color: string | null; report_from_account_id: string | null;
  report_low_contacts_threshold: number | null; report_to_email: string | null;
}

async function generateReport(admin: any, client: ClientCtx, kind: "48h" | "weekly", opts: { dryRun?: boolean; testTo?: string; fromAccountId?: string; ownerUserId?: string }) {
  const days = kind === "weekly" ? 7 : 2;
  const chartDays = Math.max(7, days);
  const { data: bundle, error: bErr } = await admin.rpc("report_bundle_admin", { p_user_id: client.user_id, p_days: days, p_chart_days: chartDays });
  if (bErr) return { ok: false, error: `bundle: ${bErr.message}` };

  const clientName = client.company_name || client.full_name || client.email || "Cliente";
  const data = toReportData(kind, clientName, bundle || {});
  if (data.campaigns.length === 0) return { ok: false, error: "El cliente no tiene campañas activas que reportar." };

  // For a REAL send, validate recipient + sending account UP FRONT (before the paid AI
  // call and PDF build), and — when a caller is known (JWT path) — scope the account to
  // that caller so nobody can send from another user's connected account.
  let acct: any = null;
  let to: string | null = null;
  if (!opts.dryRun) {
    to = opts.testTo || client.report_to_email || client.email;
    if (!to) return { ok: false, error: "No hay email de destino configurado (Enviar a)." };
    const accountId = opts.fromAccountId || client.report_from_account_id;
    if (!accountId) return { ok: false, error: "Sin cuenta de envío configurada." };
    let acctQ = admin.from("email_accounts")
      .select("email, smtp_host, smtp_port, smtp_username, smtp_password, status")
      .eq("id", accountId);
    if (opts.ownerUserId) acctQ = acctQ.eq("user_id", opts.ownerUserId);
    const { data: a } = await acctQ.maybeSingle();
    if (!a?.smtp_host) return { ok: false, error: "La cuenta de envío no existe, no es tuya o no tiene SMTP." };
    acct = a;
  }

  data.narrative = await fetchNarrative(data, client.report_low_contacts_threshold ?? 200);
  const logo = await fetchLogo(client.logo_url);
  const branding = { company: clientName, brandColor: client.brand_color || "#6E58F1", logoPngDataUrl: logo?.dataUrl || null, logoW: logo?.w, logoH: logo?.h };

  let pdfBytes: Uint8Array;
  try {
    const doc = buildReportDoc(jsPDF, data, branding);
    pdfBytes = new Uint8Array(doc.output("arraybuffer"));
  } catch (e) {
    return { ok: false, error: `PDF: ${String((e as any)?.message || e)}` };
  }

  const path = `${client.user_id}/${kind}-${Date.now()}.pdf`;
  const up = await admin.storage.from("client-reports").upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  const pdfPath = up.error ? null : path;

  if (opts.dryRun) {
    let dryUrl: string | null = null;
    if (pdfPath) { const s = await admin.storage.from("client-reports").createSignedUrl(pdfPath, 3600); dryUrl = s.data?.signedUrl || null; }
    await logReport(admin, client.user_id, kind, data, pdfPath, null, false, "dry-run");
    return { ok: true, pdfPath, dryUrl, bytes: pdfBytes.length, campaigns: data.campaigns.length };
  }

  // A LINK to the PDF (no attachment — attachments hit spam on cold sending domains).
  const signedUrl = pdfPath
    ? ((await admin.storage.from("client-reports").createSignedUrl(pdfPath, 60 * 60 * 24 * 10)).data?.signedUrl || null)
    : null;
  // The email IS the link — never send a "te paso el link" message with no link.
  if (!signedUrl) { await logReport(admin, client.user_id, kind, data, pdfPath, to, false, "No se pudo generar el enlace del informe"); return { ok: false, error: "No se pudo generar el enlace del informe" }; }

  const subject = kind === "weekly" ? "Análisis semanal de tu campaña" : "Análisis de tu campaña";
  const emailBody = buildEmailBody(signedUrl, kind);
  const r = await sendSmtp(
    acct.smtp_host, acct.smtp_port || 465, acct.smtp_username, acct.smtp_password,
    acct.email, "OnePulso", to!, subject, emailBody,
    [], // solo el link, sin adjunto
  );
  await logReport(admin, client.user_id, kind, data, pdfPath, to, r.ok, r.ok ? null : (r.error || null), emailBody);
  return { ok: r.ok, pdfPath, error: r.error, smtp: r.transcript, from: acct.email, to };
}

const PROFILE_COLS = "user_id, full_name, company_name, logo_url, brand_color, report_enabled, report_from_account_id, report_low_contacts_threshold, report_to_email, report_last_48h_at, report_last_weekly_at";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const mode = body.mode;

    if (mode === "cron") {
      if (!body.secret || body.secret !== Deno.env.get("REPORTS_CRON_SECRET")) return json({ error: "Unauthorized" }, 401);
      const kind: "48h" | "weekly" = body.kind === "weekly" ? "weekly" : "48h";
      const minGapMs = kind === "weekly" ? 6 * 24 * 3600 * 1000 : 40 * 3600 * 1000;
      // Send ONE report per invocation (batch_size overridable). The cron fires every
      // ~3 min in a short morning window, so successive clients go out ~3 MINUTES
      // apart (real minutes, not seconds) with no single invocation ever running long
      // enough to hit the edge wall-clock limit. Once every due client has been sent,
      // the remaining firings in the window are cheap no-ops (all debounced).
      const perRun = Math.max(1, Number(body.batch_size) || 1);
      const stampCol = kind === "weekly" ? "report_last_weekly_at" : "report_last_48h_at";
      const { data: profiles } = await admin.from("profiles")
        .select(PROFILE_COLS).eq("report_enabled", true).order("user_id", { ascending: true });
      const results: any[] = [];
      let handled = 0;
      for (const p of (profiles || []) as any[]) {
        if (handled >= perRun) break;
        if (!p.report_from_account_id) { results.push({ user: p.user_id, skipped: "no account" }); continue; }
        const last = kind === "weekly" ? p.report_last_weekly_at : p.report_last_48h_at;
        if (last && (Date.now() - new Date(last).getTime()) < minGapMs) { results.push({ user: p.user_id, skipped: "not due" }); continue; }
        handled++;
        let r: { ok: boolean; error?: string };
        try {
          const { data: u } = await admin.auth.admin.getUserById(p.user_id);
          const client: ClientCtx = { ...p, email: u?.user?.email || null };
          r = await generateReport(admin, client, kind, {});
        } catch (e: any) {
          r = { ok: false, error: e?.message || String(e) };
        }
        // Stamp on EVERY attempt (success or fail) so a rare failure never wedges the
        // batch — the next 3-min tick moves on to the next client. A failed report
        // retries next cycle; "Enviar ahora" covers one-offs.
        await admin.from("profiles").update({ [stampCol]: new Date().toISOString() }).eq("user_id", p.user_id);
        results.push({ user: p.user_id, ok: r.ok, error: r.error });
      }
      return json({ ok: true, kind, sent: handled, results });
    }

    if (mode === "manual") {
      // Auth: an admin/manager JWT, OR the cron secret (internal/dry-run verification).
      const viaSecret = !!(body.secret && body.secret === Deno.env.get("REPORTS_CRON_SECRET"));
      let callerId: string | null = null;
      let isFullAdmin = false;
      if (!viaSecret) {
        const authHeader = req.headers.get("Authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (token) {
          const { data: ures } = await admin.auth.getUser(token);
          const caller = ures?.user;
          if (caller) {
            const { data: role } = await admin.from("user_roles").select("role").eq("user_id", caller.id).single();
            const { data: cprof } = await admin.from("profiles").select("is_client_manager").eq("user_id", caller.id).single();
            isFullAdmin = role?.role === "admin";
            if (isFullAdmin || cprof?.is_client_manager) callerId = caller.id;
          }
        }
      }
      if (!viaSecret && !callerId) return json({ error: "Forbidden" }, 403);

      const clientUserId = body.client_user_id;
      if (!clientUserId) return json({ error: "client_user_id required" }, 400);
      const kind: "48h" | "weekly" = body.kind === "weekly" ? "weekly" : "48h";
      const { data: p } = await admin.from("profiles").select(PROFILE_COLS + ", allowed_routes").eq("user_id", clientUserId).maybeSingle();
      // A non-admin caller (client-manager) may only generate for real CLIENTS
      // (profiles with allowed_routes) or for themselves — never for an arbitrary user.
      if (callerId && !isFullAdmin) {
        const isClient = Array.isArray((p as any)?.allowed_routes) && (p as any).allowed_routes.length > 0;
        if (!isClient && clientUserId !== callerId) return json({ error: "Forbidden" }, 403);
      }
      const { data: u } = await admin.auth.admin.getUserById(clientUserId);
      if (!u?.user) return json({ error: "Usuario no encontrado" }, 404);
      const client: ClientCtx = { ...((p as any) || {}), user_id: clientUserId, email: u.user.email || null };
      const r = await generateReport(admin, client, kind, { dryRun: !!body.dry_run, testTo: body.test_to, fromAccountId: body.from_account_id, ownerUserId: callerId || undefined });
      return json(r);
    }

    if (mode === "email_pdf") {
      // Upload an ALREADY-GENERATED PDF (the exact one from the browser preview) and
      // email a LINK to it (no attachment) — so the test matches the preview exactly.
      // Admin/manager JWT or secret required.
      const viaSecret = !!(body.secret && body.secret === Deno.env.get("REPORTS_CRON_SECRET"));
      let callerId: string | null = null;
      if (!viaSecret) {
        const authHeader = req.headers.get("Authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (token) {
          const { data: ures } = await admin.auth.getUser(token);
          const caller = ures?.user;
          if (caller) {
            const { data: role } = await admin.from("user_roles").select("role").eq("user_id", caller.id).single();
            const { data: cprof } = await admin.from("profiles").select("is_client_manager").eq("user_id", caller.id).single();
            if (role?.role === "admin" || cprof?.is_client_manager) callerId = caller.id;
          }
        }
      }
      if (!viaSecret && !callerId) return json({ error: "Forbidden" }, 403);

      const { to, from_account_id, pdf_base64, subject } = body;
      if (!to || !from_account_id || !pdf_base64) return json({ error: "Faltan datos (to, from_account_id, pdf_base64)" }, 400);
      // Scope the sending account to the caller (JWT path) so nobody sends from another
      // user's account. The cron/secret path is internal and unscoped.
      let acctQ = admin.from("email_accounts").select("email, smtp_host, smtp_port, smtp_username, smtp_password").eq("id", from_account_id);
      if (callerId) acctQ = acctQ.eq("user_id", callerId);
      const { data: acct } = await acctQ.maybeSingle();
      if (!acct?.smtp_host) return json({ error: "La cuenta de envío no existe, no es tuya o no tiene SMTP" }, 400);

      // Upload the previewed PDF and email a link to it (no attachment).
      let signed: string | null = null;
      try {
        const bytes = Uint8Array.from(atob(pdf_base64), (c) => c.charCodeAt(0));
        const path = `test/${Date.now()}.pdf`;
        const up = await admin.storage.from("client-reports").upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (!up.error) signed = (await admin.storage.from("client-reports").createSignedUrl(path, 60 * 60 * 24 * 10)).data?.signedUrl || null;
      } catch { /* ignore */ }
      if (!signed) return json({ ok: false, error: "No se pudo subir el PDF para generar el link" }, 500);

      const text = buildEmailBody(signed, /semanal/i.test(String(subject || "")) ? "weekly" : "48h");
      const r = await sendSmtp(
        acct.smtp_host, acct.smtp_port || 465, acct.smtp_username, acct.smtp_password,
        acct.email, "OnePulso", to, subject || "Análisis de tu campaña", text,
        [], // solo el link, sin adjunto
      );
      return json({ ok: r.ok, error: r.error, smtp: r.transcript });
    }

    if (mode === "purge_pdfs") {
      // Delete report PDFs older than N days from storage (keeps the platform lean).
      // Secret-gated (called by cron). The client_reports LOG rows stay — only the
      // files are removed.
      if (!body.secret || body.secret !== Deno.env.get("REPORTS_CRON_SECRET")) return json({ error: "Unauthorized" }, 401);
      const days = Number(body.days) || 10;
      const { data: names } = await admin.rpc("list_old_report_pdfs", { p_days: days });
      const paths = (Array.isArray(names) ? names : []).map((n: any) => (typeof n === "string" ? n : (n?.name || n?.list_old_report_pdfs))).filter(Boolean);
      let removed = 0;
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const { error } = await admin.storage.from("client-reports").remove(chunk);
        if (!error) removed += chunk.length;
      }
      return json({ ok: true, removed, checked: paths.length });
    }

    return json({ error: "unknown mode" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
});

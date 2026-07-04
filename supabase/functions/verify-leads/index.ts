import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TEMP_DOMAINS = new Set([
  "tempmail.com","throwaway.email","guerrillamail.com","guerrillamail.net","sharklasers.com",
  "grr.la","guerrillamailblock.com","pokemail.net","spam4.me","bccto.me","chacuo.net",
  "discard.email","discardmail.com","discardmail.de","emailondeck.com","fakeinbox.com",
  "mailinator.com","guerrillamail.info","guerrillamail.biz","guerrillamail.de","guerrillamail.org",
  "mailnesia.com","maildrop.cc","mailnull.com","mailsac.com","10minutemail.com","temp-mail.org",
  "tempail.com","tempr.email","throwaway.email","trashmail.com","trashmail.me","trashmail.net",
  "yopmail.com","yopmail.fr","yopmail.gq","nospam.ze.tc","no-spam.ws","mailcatch.com",
  "getairmail.com","filzmail.com","mohmal.com","harakirimail.com","dispostable.com",
  "tempinbox.com","mailforspam.com","mailexpire.com","tempmailo.com","tempomail.fr",
  "jetable.org","trash-mail.com","trashymail.com","mailtemp.info","incognitomail.org",
  "mytrashmail.com","throwam.com","fast-mail.fr","speed.1s.fr","courriel.fr.nf","moncourrier.fr.nf",
  "monemail.fr.nf","monmail.fr.nf","hide.biz.st","mymail.infos.st","sharklasers.com",
  "guerrillamailblock.com","grr.la","guerrillamail.com","guerrillamail.net","spam4.me","bccto.me",
  "bobmail.info","mailseal.de","spamevader.com","trashmail.org","fakemailgenerator.com",
  "armyspy.com","cuvox.de","dayrep.com","einrot.com","fleckens.hu","gustr.com","jourrapide.com",
  "rhyta.com","superrito.com","teleworm.us","tempmailaddress.com","burnermail.io",
  "inboxbear.com","mailpoof.com","mintemail.com","nada.email","tempmailer.com",
  "getnada.com","emailfake.com","crazymailing.com","tmail.ws","tmpmail.net","tmpmail.org",
  "moakt.cc","moakt.ws","mailgw.com","generator.email","emailnax.com","safetymail.info"
]);

// Role / generic mailboxes — real verifiers flag these "risky" (not a person).
const ROLE_PREFIXES = new Set([
  "info","support","admin","administrator","contact","contacto","sales","ventas","hello","hola",
  "help","ayuda","soporte","noreply","no-reply","donotreply","do-not-reply","webmaster","postmaster",
  "hostmaster","abuse","billing","facturacion","careers","jobs","empleo","rrhh","hr","marketing",
  "press","prensa","office","oficina","team","equipo","enquiries","feedback","legal","privacy",
  "security","service","servicio","newsletter","subscribe","unsubscribe","mailer","mail","email",
]);

// From-identity used for the SMTP probe. A real, MX-backed domain gets far fewer
// defensive rejections than a random one.
const PROBE_FROM = "verify@onepulso.online";
const PROBE_HELO = "onepulso.online";

// Common free/consumer domains for typo ("did you mean") detection.
const COMMON_DOMAINS = [
  "gmail.com","googlemail.com","yahoo.com","yahoo.es","yahoo.co.uk","hotmail.com","hotmail.es",
  "hotmail.co.uk","outlook.com","outlook.es","live.com","live.co.uk","msn.com","icloud.com",
  "me.com","aol.com","protonmail.com","proton.me","gmx.com","gmx.net","mail.com","yandex.com","zoho.com",
];

function randomString(n: number): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

/** "gmial.com" → "gmail.com". Returns null if the domain is fine or unrecognisable. */
function suggestDomain(domain: string): string | null {
  for (const d of COMMON_DOMAINS) {
    if (d === domain) return null;
    if (Math.abs(d.length - domain.length) <= 2 && levenshtein(domain, d) <= 1) return d;
  }
  return null;
}

function validateFormat(email: string): boolean {
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(email);
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function checkDns(domain: string): Promise<{ exists: boolean; hasMx: boolean; mxHosts: string[] }> {
  try {
    const aRecords = await withTimeout(
      Deno.resolveDns(domain, "A").catch(() => [] as string[]),
      2500,
      [] as string[]
    );

    let mxRecords: Deno.MXRecord[] = [];
    try {
      mxRecords = await withTimeout(
        Deno.resolveDns(domain, "MX") as Promise<Deno.MXRecord[]>,
        2500,
        [] as Deno.MXRecord[]
      );
    } catch {
      mxRecords = [];
    }

    const domainExists = aRecords.length > 0 || mxRecords.length > 0;
    const hasMx = mxRecords.length > 0;
    const mxHosts = mxRecords.map((r: any) => typeof r === "object" ? r.exchange : String(r));

    return { exists: domainExists, hasMx, mxHosts };
  } catch {
    return { exists: false, hasMx: false, mxHosts: [] };
  }
}

type SmtpVerdict = "deliverable" | "undeliverable" | "catch_all" | "unknown";

/**
 * Real mailbox check via the SMTP conversation, exactly like ZeroBounce/NeverBounce:
 *   EHLO → MAIL FROM → RCPT TO:<target> → RCPT TO:<random@domain> (catch-all probe) → QUIT
 * Interprets the RCPT reply codes:
 *   250/251 target + reject random  → deliverable (mailbox exists)
 *   250/251 target + accept random  → catch_all  (server accepts everything → can't confirm)
 *   55x target + not-55x random     → undeliverable (mailbox really doesn't exist)
 *   anything else / blocked / 4xx   → unknown (never delete on a guess)
 * NOTE: Supabase Edge often can't open port 25 (egress blocked) — then this returns
 * "unknown" and verifyEmail falls back to the MX-level verdict. For guaranteed
 * mailbox-level results this probe must run somewhere with port-25 egress (a VPS)
 * or be swapped for a verification API.
 */
async function smtpVerify(mxHost: string, email: string, domain: string): Promise<SmtpVerdict> {
  let conn: Deno.Conn | null = null;
  try {
    conn = await withTimeout(Deno.connect({ hostname: mxHost, port: 25 }), 4000, null as unknown as Deno.Conn);
    if (!conn) return "unknown";
    const dec = new TextDecoder();
    const enc = new TextEncoder();

    const read = async (): Promise<number> => {
      let result = "";
      while (true) {
        const buf = new Uint8Array(1024);
        const n = await withTimeout(conn!.read(buf), 4000, null);
        if (!n || typeof n !== "number") break;
        result += dec.decode(buf.subarray(0, n));
        const lines = result.split(/\r?\n/).filter((l) => l.length > 0);
        const last = lines[lines.length - 1] || "";
        if (/^\d{3} /.test(last)) break; // final line (space, not '-')
      }
      const lines = result.trim().split(/\r?\n/);
      const code = parseInt((lines[lines.length - 1] || "").slice(0, 3), 10);
      return isNaN(code) ? 0 : code;
    };
    const cmd = async (line: string): Promise<number> => {
      await conn!.write(enc.encode(line + "\r\n"));
      return await read();
    };

    if ((await read()) !== 220) { try { conn.close(); } catch { /* */ } return "unknown"; }

    let ehlo = await cmd(`EHLO ${PROBE_HELO}`);
    if (ehlo !== 250) ehlo = await cmd(`HELO ${PROBE_HELO}`);
    if (ehlo !== 250) { try { conn.close(); } catch { /* */ } return "unknown"; }

    const mailFrom = await cmd(`MAIL FROM:<${PROBE_FROM}>`);
    if (mailFrom !== 250) { try { conn.close(); } catch { /* */ } return "unknown"; }

    const target = await cmd(`RCPT TO:<${email}>`);
    const random = await cmd(`RCPT TO:<probe-${randomString(12)}@${domain}>`);
    try { await cmd("QUIT"); } catch { /* */ }
    try { conn.close(); } catch { /* */ }

    const accepts = (c: number) => c === 250 || c === 251;
    const rejects = (c: number) => [550, 551, 553, 554, 501, 552, 505, 511].includes(c);

    if (accepts(target)) return accepts(random) ? "catch_all" : "deliverable";
    if (rejects(target)) return rejects(random) ? "unknown" : "undeliverable"; // both-reject = anti-probe → don't trust
    return "unknown"; // 4xx greylist / odd codes
  } catch {
    try { conn?.close(); } catch { /* */ }
    return "unknown";
  }
}

async function verifyEmail(email: string): Promise<{ status: string; reason: string }> {
  const normalized = email.trim().toLowerCase();
  if (!validateFormat(normalized)) return { status: "invalid", reason: "formato inválido" };

  const parts = normalized.split("@");
  const localPart = parts[0];
  const domain = parts[1];
  if (!domain || !localPart) return { status: "invalid", reason: "formato inválido" };

  if (TEMP_DOMAINS.has(domain)) return { status: "invalid", reason: "email temporal / desechable" };

  const dns = await checkDns(domain);
  if (!dns.exists) {
    const hint = suggestDomain(domain);
    return { status: "invalid", reason: hint ? `dominio no existe (¿quisiste decir ${hint}?)` : "dominio no existe" };
  }
  if (!dns.hasMx) return { status: "invalid", reason: "el dominio no recibe correo (sin MX)" };

  const isRole = ROLE_PREFIXES.has(localPart);

  // Mailbox-level probe against the primary MX (best-effort).
  const smtp: SmtpVerdict = dns.mxHosts.length > 0 ? await smtpVerify(dns.mxHosts[0], normalized, domain) : "unknown";

  if (smtp === "undeliverable") return { status: "invalid", reason: "el buzón no existe (SMTP 550)" };
  if (smtp === "catch_all") return { status: "risky", reason: "dominio catch-all: acepta todo, buzón no confirmable" };
  if (smtp === "deliverable") {
    return isRole
      ? { status: "risky", reason: "buzón confirmado pero es genérico/rol" }
      : { status: "valid", reason: "buzón confirmado por SMTP" };
  }

  // SMTP inconclusive (port 25 blocked / greylist): fall back to MX-level confidence.
  return isRole
    ? { status: "risky", reason: "email genérico/rol (dominio válido, buzón no confirmado)" }
    : { status: "valid", reason: "dominio válido (buzón no confirmado por SMTP)" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization");
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const user = userData.user;
    if (!user) throw new Error("Not authenticated");

    const { lead_ids, skip_coin_check } = await req.json();
    if (!lead_ids?.length) throw new Error("No lead_ids provided");

    // Check coins
    if (!skip_coin_check) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("coins, contact_email")
        .eq("user_id", user.id)
        .single();

      const isInfinite = ["hello@onepulso.blog", "eric@dekano-core.es"].includes(profile?.contact_email ?? "");
      const cost = Math.ceil(lead_ids.length * 0.1);

      if (!isInfinite && (profile?.coins ?? 0) < cost) {
        return new Response(JSON.stringify({ error: "insufficient_coins", required: cost, available: profile?.coins ?? 0 }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!isInfinite) {
        await supabase.from("profiles").update({ coins: (profile?.coins ?? 0) - cost }).eq("user_id", user.id);
      }
    }

    // Fetch leads
    const { data: leads } = await supabase
      .from("leads")
      .select("id, email, custom_fields")
      .in("id", lead_ids)
      .eq("user_id", user.id);

    if (!leads?.length) throw new Error("No leads found");

    const results = { valid: 0, invalid: 0, risky: 0, total: leads.length };
    const invalidIds: string[] = [];

    // Process in small batches to stay within edge function time limits
    const BATCH = 5;
    for (let i = 0; i < leads.length; i += BATCH) {
      const batch = leads.slice(i, i + BATCH);
      
      // Each verification has its own timeout — if it hangs, mark as valid (safe default)
      const verifications = await Promise.all(batch.map(l => {
        if (!l.email || !l.email.trim()) {
          return Promise.resolve({ status: "invalid", reason: "email vacío" });
        }
        return withTimeout(
          verifyEmail(l.email),
          18000, // room for the full SMTP RCPT conversation before giving up
          { status: "valid", reason: "verificación timeout - marcado válido" }
        );
      }));

      const updatePromises: Promise<unknown>[] = [];

      for (let j = 0; j < batch.length; j++) {
        const lead = batch[j];
        const result = verifications[j];
        results[result.status as keyof typeof results]++;

        if (result.status === "invalid") {
          invalidIds.push(lead.id);
        } else {
          const cf = ((lead.custom_fields as Record<string, unknown>) || {});
          cf.verification_reason = result.reason;
          updatePromises.push(
            supabase.from("leads").update({
              verification_status: result.status,
              custom_fields: cf,
            }).eq("id", lead.id)
          );
        }
      }

      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
      }
    }

    // Delete invalid leads
    if (invalidIds.length > 0) {
      for (let i = 0; i < invalidIds.length; i += 100) {
        const chunk = invalidIds.slice(i, i + 100);
        const { data: inboxMessages } = await supabase
          .from("inbox_messages")
          .select("id")
          .in("lead_id", chunk)
          .eq("user_id", user.id);

        const messageIds = (inboxMessages || []).map((message) => message.id);

        if (messageIds.length > 0) {
          await supabase
            .from("message_reminders")
            .delete()
            .in("message_id", messageIds)
            .eq("user_id", user.id);
        }

        await supabase.from("campaign_leads").delete().in("lead_id", chunk);
        await supabase.from("sent_emails").delete().in("lead_id", chunk);

        if (messageIds.length > 0) {
          await supabase.from("inbox_messages").delete().in("id", messageIds).eq("user_id", user.id);
        }

        await supabase.from("leads").delete().in("id", chunk).eq("user_id", user.id);
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("verify-leads error:", (error as Error).message);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

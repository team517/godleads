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

const GENERIC_PREFIXES = ["info", "support", "admin", "contact", "sales", "hello", "help", "noreply", "no-reply", "webmaster", "postmaster"];

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

async function checkSmtp(mxHost: string): Promise<boolean> {
  try {
    const conn = await withTimeout(
      Deno.connect({ hostname: mxHost, port: 25, transport: "tcp" }),
      2000,
      null
    );
    if (!conn) return true; // timeout = inconclusive, don't mark invalid
    
    const buf = new Uint8Array(1024);
    const n = await withTimeout(conn.read(buf), 3000, null);
    conn.close();
    if (n && typeof n === "number") {
      const greeting = new TextDecoder().decode(buf.subarray(0, n));
      return greeting.startsWith("220");
    }
    return true; // inconclusive
  } catch {
    return true; // Don't mark as invalid if we can't connect
  }
}

async function verifyEmail(email: string): Promise<{ status: string; reason: string }> {
  const normalized = email.trim().toLowerCase();
  if (!validateFormat(normalized)) return { status: "invalid", reason: "formato inválido" };

  const parts = normalized.split("@");
  const localPart = parts[0];
  const domain = parts[1];
  if (!domain || !localPart) return { status: "invalid", reason: "formato inválido" };

  if (TEMP_DOMAINS.has(domain)) return { status: "invalid", reason: "email temporal" };

  const dns = await checkDns(domain);
  
  if (!dns.exists) return { status: "invalid", reason: "dominio no existe" };
  if (!dns.hasMx) return { status: "invalid", reason: "sin registros MX" };

  if (dns.mxHosts.length > 0) {
    const smtpOk = await checkSmtp(dns.mxHosts[0]);
    if (!smtpOk) return { status: "invalid", reason: "servidor MX no responde" };
  }

  if (GENERIC_PREFIXES.some(p => localPart === p)) return { status: "risky", reason: "email genérico" };

  return { status: "valid", reason: "email válido" };
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
          5000,
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

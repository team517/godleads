// Domains of the user's leads, ASKED FOR ON DEMAND (05-10-2026).
//
// Before, the Unibox and the unread badge called get_lead_domains, which walks ALL of the user's
// leads: support@ = 278,000 leads, 59,064 domains, 0.5 s warm and 2.5–6 s cold (close to the 8 s
// timeout). On top of that PostgREST returns at most 1,000 rows, so the browser was filtering with
// 1,000 domains out of 59,000. Now it asks only about the domains of the messages it actually has
// (lead_domains_in, one index lookup per domain), and remembers the answer during the session.
import { cacheGet, cacheSet } from "@/lib/instant-cache";

export const LEAD_DOMAINS_IN_KEY = "unibox:leadDomainsIn";
export const LEAD_DOMAINS_IN_FRESH_MS = 10 * 60_000;
const CHUNK = 1000;

export type LeadDomainMemo = { at: number; asked: string[]; hits: string[] };

/** The sender's domain, lowercased; "" if there is none. */
export function domainOf(email: string | null | undefined): string {
  const e = String(email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at >= 0 ? e.slice(at + 1).trim() : "";
}

/** Domains of these messages that have not been asked about yet, without repeats. */
export function pendingDomains(emails: (string | null | undefined)[], asked: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const e of emails) {
    const d = domainOf(e);
    if (d && !asked.has(d)) out.add(d);
  }
  return [...out];
}

/** What was already known in this session (if it is less than 10 minutes old). */
export function readLeadDomainMemo(now = Date.now()): { asked: Set<string>; hits: Set<string> } {
  const m = cacheGet<LeadDomainMemo>(LEAD_DOMAINS_IN_KEY);
  if (!m || now - m.at >= LEAD_DOMAINS_IN_FRESH_MS) return { asked: new Set(), hits: new Set() };
  return { asked: new Set(m.asked), hits: new Set(m.hits) };
}

function writeMemo(asked: Set<string>, hits: Set<string>, prevAt?: number) {
  cacheSet<LeadDomainMemo>(LEAD_DOMAINS_IN_KEY, { at: prevAt ?? Date.now(), asked: [...asked], hits: [...hits] });
}

/**
 * Asks the server which of these domains belong to a lead of the user. Returns the domains that
 * do, and saves what was asked (hits and misses) so it is not asked again during the session.
 * If a request fails, those domains are NOT marked as asked: they are retried next time.
 */
export async function resolveLeadDomains(
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>,
  domains: string[],
): Promise<{ hits: Set<string>; ok: boolean }> {
  const memo = cacheGet<LeadDomainMemo>(LEAD_DOMAINS_IN_KEY);
  const fresh = memo && Date.now() - memo.at < LEAD_DOMAINS_IN_FRESH_MS;
  const asked = new Set(fresh ? memo!.asked : []);
  const hits = new Set(fresh ? memo!.hits : []);
  let ok = true;
  const todo = domains.filter((d) => d && !asked.has(d));
  for (let i = 0; i < todo.length; i += CHUNK) {
    const slice = todo.slice(i, i + CHUNK);
    const { data, error } = await rpc("lead_domains_in", { p_domains: slice });
    if (error || !Array.isArray(data)) { ok = false; continue; }
    for (const d of slice) asked.add(d);
    for (const r of data as { domain?: string }[]) {
      const d = String(r?.domain || "").toLowerCase().trim();
      if (d) hits.add(d);
    }
  }
  writeMemo(asked, hits, fresh ? memo!.at : undefined);
  return { hits, ok };
}

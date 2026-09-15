// Whether an inbox message BELONGS to a campaign, so it may appear in the clean Unibox bandeja.
// The owner's rule: a message counts as campaign-relevant when it comes from a lead's email
// (linked via lead_id / campaign_id) OR from a domain that is present in the campaign leads — so a
// colleague at the SAME company as a lead still counts. Everything else (warm-up-network traffic,
// random outreach, misdetected-language noise) is NOT campaign-relevant and is kept out of the
// clean view (it stays fully accessible under "Todos"). Pure + dependency-free so it can be tested.
// Our OWN brand domains (onepulso + its sending variants, e.g. onepulso.online / .blog /
// onnepulssoflow.eu) — mail from these always belongs in the clean view.
import { looksLikeWarmupSubject } from "@/lib/inbox-filters";

export function isOwnBrandDomain(dom: string): boolean {
  return /onepulso|onnepuls/i.test(dom);
}

/** A genuine REPLY to something one of OUR mailboxes sent: its References / In-Reply-To
 *  chain carries a Message-ID at one of our own sending domains. This catches replies to
 *  mail sent through ANOTHER system with the same mailboxes (no sent_emails row → never
 *  linked to a lead/campaign, sender unknown to godleads): a real "Interesado" in English
 *  from such a sender was hidden as outreach noise (hello@hiretop.com, 2026-09-10). Cold
 *  spam fakes "RE:" in the subject but never references OUR Message-IDs. */
export function isReplyToOurMail(
  m: { ref_chain?: string | null; subject?: string | null },
  ownDomains: Set<string> | undefined,
): boolean {
  if (!ownDomains || ownDomains.size === 0) return false;
  // Warm-up pool threads ALSO reference our domain (our seed mailbox started them). Their
  // generic English office subject gives them away — never let them through on this rule.
  if (looksLikeWarmupSubject(m.subject)) return false;
  const refs = String(m.ref_chain || "").toLowerCase();
  if (!refs.includes("@")) return false;
  for (const d of ownDomains) {
    if (d && refs.includes("@" + d)) return true;
  }
  return false;
}

export function isCampaignRelevant(
  m: { lead_id?: unknown; campaign_id?: unknown; from_email?: string | null; ref_chain?: string | null; subject?: string | null },
  leadDomains: Set<string>,
  ownDomains?: Set<string>,
): boolean {
  if (m.lead_id || m.campaign_id) return true;
  const dom = String(m.from_email || "").split("@")[1]?.toLowerCase().trim() || "";
  if (!dom) return false;
  if (leadDomains.has(dom)) return true;      // same domain as a campaign lead (colleague counts)
  if (isOwnBrandDomain(dom)) return true;     // onepulso + variants → always in campaign
  if (isReplyToOurMail(m, ownDomains)) return true; // answers OUR mail (sent from any system)
  return false;
}

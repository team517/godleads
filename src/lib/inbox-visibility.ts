// Whether an inbox message BELONGS to a campaign, so it may appear in the clean Unibox bandeja.
// The owner's rule: a message counts as campaign-relevant when it comes from a lead's email
// (linked via lead_id / campaign_id) OR from a domain that is present in the campaign leads — so a
// colleague at the SAME company as a lead still counts. Everything else (warm-up-network traffic,
// random outreach, misdetected-language noise) is NOT campaign-relevant and is kept out of the
// clean view (it stays fully accessible under "Todos"). Pure + dependency-free so it can be tested.
export function isCampaignRelevant(
  m: { lead_id?: unknown; campaign_id?: unknown; from_email?: string | null },
  leadDomains: Set<string>,
): boolean {
  if (m.lead_id || m.campaign_id) return true;
  const dom = String(m.from_email || "").split("@")[1]?.toLowerCase().trim() || "";
  return !!dom && leadDomains.has(dom);
}

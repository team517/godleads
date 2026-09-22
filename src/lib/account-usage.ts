// En qué OTRAS campañas envía ya cada buzón: por asignación directa (campaign_accounts) o por
// etiqueta (tags del buzón ∩ account_tags de la campaña). Para que en "Cuentas individuales" de
// una campaña se vea "en lluert 2" al lado del buzón y no se repita sin querer.

export interface UsageCampaign { id: string; name: string; account_tags?: string[] | null }
export interface UsageAccount { id: string; tags?: string[] | null }
export interface UsageLink { campaign_id: string; account_id: string }

export function campaignsUsingAccounts(
  accounts: UsageAccount[],
  otherCampaigns: UsageCampaign[],
  links: UsageLink[],
): Record<string, string[]> {
  const byAccount: Record<string, Set<string>> = {};
  const nameOf = new Map(otherCampaigns.map((c) => [c.id, c.name]));
  for (const l of links) {
    const n = nameOf.get(l.campaign_id);
    if (!n) continue;
    (byAccount[l.account_id] ||= new Set()).add(n);
  }
  for (const a of accounts) {
    const tags = a.tags || [];
    if (!tags.length) continue;
    for (const c of otherCampaigns) {
      const ct = c.account_tags || [];
      if (ct.length && tags.some((t) => ct.includes(t))) (byAccount[a.id] ||= new Set()).add(c.name);
    }
  }
  return Object.fromEntries(Object.entries(byAccount).map(([k, v]) => [k, [...v].sort((x, y) => x.localeCompare(y))]));
}

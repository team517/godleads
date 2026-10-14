// Pure filtering for the Cuentas de Email list. Extracted from the page so the behaviour the
// user relies on — "type eric, hit select-all, and ONLY Eric's mailboxes are selected" — is
// unit-tested instead of assumed.

export type FilterableAccount = {
  id: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  smtp_host?: string | null;
  imap_host?: string | null;
  tags?: string[] | null;
};

/**
 * SEARCH is a hard filter: every whitespace-separated term must appear somewhere in the
 * account's email, name, host or tags (case-insensitive), so "eric ionos" narrows further.
 * The TAG chip is a hard filter too (14-10-2026, owner's request): clicking "whatsapp (20)" shows
 * only those 20 mailboxes, so select-all and bulk actions act on the tag. It used to only
 * reorder (tagged first, the rest below).
 */
export function filterAccounts<T extends FilterableAccount>(
  accounts: T[],
  search: string,
  filterTag: string | null,
): T[] {
  const q = (search || "").trim().toLowerCase();
  const base = !q
    ? accounts
    : accounts.filter((a) => {
        const hay = [a.email, a.first_name, a.last_name, a.smtp_host, a.imap_host, ...(a.tags || [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return q.split(/\s+/).every((term) => hay.includes(term));
      });
  if (!filterTag) return base;
  return base.filter((a) => (a.tags || []).includes(filterTag));
}

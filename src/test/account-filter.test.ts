import { describe, it, expect } from "vitest";
import { filterAccounts, type FilterableAccount } from "@/lib/account-filter";

const ACCOUNTS: FilterableAccount[] = [
  { id: "1", email: "eric@dekano-core.es", first_name: "Eric", last_name: "Lopez", smtp_host: "smtp.ionos.es", tags: ["ONEPULSO"] },
  { id: "2", email: "eric.m@otradomain.com", first_name: "Eric", last_name: "Martin", smtp_host: "smtp.gmail.com", tags: [] },
  { id: "3", email: "maria@onnepulssoscale.store", first_name: "Maria", last_name: "Lopez", smtp_host: "smtp.gmail.com", tags: ["ONEPULSO carla"] },
  { id: "4", email: "oliver@tiarecrew.com", first_name: "Oliver", last_name: "Erickson", smtp_host: "smtp.ionos.es", tags: [] },
  { id: "5", email: "support@onepulso.online", first_name: "Support", last_name: null, smtp_host: "smtp.gmail.com", tags: ["ONEPULSO"] },
];
const ids = (a: FilterableAccount[]) => a.map((x) => x.id).sort();

describe("Cuentas de Email — buscador", () => {
  it("empty search returns everything, untouched", () => {
    expect(filterAccounts(ACCOUNTS, "", null)).toHaveLength(5);
    expect(filterAccounts(ACCOUNTS, "   ", null)).toHaveLength(5);
  });

  it('"eric" returns every Eric — including a surname match — and nothing else', () => {
    // #4 is "Erickson": a substring match is intentional (the user types a fragment).
    expect(ids(filterAccounts(ACCOUNTS, "eric", null))).toEqual(["1", "2", "4"]);
    expect(ids(filterAccounts(ACCOUNTS, "ERIC", null))).toEqual(["1", "2", "4"]); // case-insensitive
  });

  it("SELECT-ALL over a search selects exactly the filtered set (the reported requirement)", () => {
    const shown = filterAccounts(ACCOUNTS, "eric", null);
    const selected = new Set(shown.map((a) => a.id));   // what toggleSelectAll stores
    expect([...selected].sort()).toEqual(["1", "2", "4"]);
    expect(selected.has("3")).toBe(false);              // Maria must never be swept in
    expect(selected.has("5")).toBe(false);
  });

  it("several terms narrow further (AND, not OR)", () => {
    // #1 (Eric + ionos host) and #4 (ErICKson + ionos host) both satisfy BOTH terms.
    expect(ids(filterAccounts(ACCOUNTS, "eric ionos", null))).toEqual(["1", "4"]);
    expect(ids(filterAccounts(ACCOUNTS, "eric gmail", null))).toEqual(["2"]);
    expect(filterAccounts(ACCOUNTS, "eric nonexistent", null)).toHaveLength(0);
  });

  it("matches email, host and tag too", () => {
    expect(ids(filterAccounts(ACCOUNTS, "dekano", null))).toEqual(["1"]);
    expect(ids(filterAccounts(ACCOUNTS, "gmail", null))).toEqual(["2", "3", "5"]);
    expect(ids(filterAccounts(ACCOUNTS, "carla", null))).toEqual(["3"]);
  });

  it("a tag chip only REORDERS (tagged first) and still respects the search", () => {
    const byTag = filterAccounts(ACCOUNTS, "", "ONEPULSO");
    expect(byTag.map((a) => a.id)).toEqual(["1", "5", "2", "3", "4"]); // tagged first, rest after
    // search + tag together: only Erics, ONEPULSO one first
    expect(filterAccounts(ACCOUNTS, "eric", "ONEPULSO").map((a) => a.id)).toEqual(["1", "2", "4"]);
  });

  it("no match yields an empty list (so bulk actions act on nothing, never on all)", () => {
    expect(filterAccounts(ACCOUNTS, "zzzz", null)).toHaveLength(0);
  });
});

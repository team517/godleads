import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AccountsTable from "@/components/accounts/AccountsTable";
import { bindCacheUser, cacheGet, cacheSet } from "@/lib/instant-cache";

/* Con cientos de buzones (un cliente tiene 898) la pantalla de Cuentas tardaba en aparecer
 * porque montaba TODAS las filas de golpe. Ahora se pintan de 50 en 50. */

const mk = (n: number) => Array.from({ length: n }).map((_, i) => ({
  id: `a${i + 1}`,
  email: `buzon${i + 1}@dominio-${i % 20}.com`,
  first_name: `N${i + 1}`,
  last_name: "A",
  status: "connected",
  smtp_host: "smtp.ionos.es",
  daily_limit: 50,
  sent_today: 0,
  tags: [],
}));

const noop = () => {};
const renderTable = (accounts: any[]) => render(
  <AccountsTable
    accounts={accounts}
    selectedIds={new Set()}
    allSelected={false}
    onToggleSelect={noop}
    onToggleAll={noop}
    imapChecks={{}}
    domainAuth={{}}
    dnsConfiguring={{}}
    verifying={null}
    onConfigureDns={noop}
    onRecheckDomain={noop}
    onRecheckImap={noop}
    onEdit={noop}
    onVerify={noop}
    onDelete={noop}
    onAddTag={noop}
    onRemoveTag={noop}
    allTags={[]}
    filterTag={null}
    rampOf={() => null}
  />,
);

describe("AccountsTable — paginación", () => {
  // jsdom tarda en montar 50 filas con todas sus celdas; con la suite entera en paralelo pasa de 5 s.
  vi.setConfig({ testTimeout: 30_000 });

  it("con 120 cuentas pinta 50 filas y dice cuántas se ven", () => {
    renderTable(mk(120));
    expect(screen.getAllByRole("row")).toHaveLength(51); // cabecera + 50
    expect(screen.getByText("Mostrando 1 - 50 de 120 cuentas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument();
  });

  it("«Página siguiente» enseña las siguientes 50", () => {
    renderTable(mk(120));
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(screen.getByText("Mostrando 51 - 100 de 120 cuentas")).toBeInTheDocument();
    expect(screen.getByText("buzon51@dominio-10.com")).toBeInTheDocument();
    expect(screen.queryByText("buzon1@dominio-0.com")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(screen.getByText("Mostrando 101 - 120 de 120 cuentas")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(21);
  });

  it("con pocas cuentas no hay paginador", () => {
    renderTable(mk(7));
    expect(screen.getByText("Mostrando 1 - 7 de 7 cuentas")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Página siguiente" })).not.toBeInTheDocument();
  });
});

describe("caché de cuentas en disco", () => {
  it("guarda la lista sin la firma HTML (no hace falta para pintarla y reventaba el localStorage)", () => {
    vi.spyOn(Storage.prototype, "setItem");
    bindCacheUser("u-test");
    cacheSet("accounts:list", [{ id: "a1", email: "x@y.com", signature_html: "<p>firma</p>".repeat(100), notes: "n", last_error: "e" }]);
    const stored = (Storage.prototype.setItem as any).mock.calls.find((c: any[]) => String(c[0]).includes("accounts:list"));
    expect(stored).toBeTruthy();
    expect(String(stored[1])).not.toContain("firma");
    expect(String(stored[1])).toContain("x@y.com");
    // En memoria sigue entera: la pantalla abierta no pierde nada.
    expect(cacheGet<any[]>("accounts:list")![0].signature_html).toContain("firma");
    vi.restoreAllMocks();
  });
});

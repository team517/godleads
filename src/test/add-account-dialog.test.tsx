import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AddAccountDialog from "@/components/accounts/AddAccountDialog";
import { ACCOUNTS_CSV_HEADERS, accountsCsvTemplate, accountsToCsv } from "@/lib/accounts-csv";

describe("CSV de cuentas", () => {
  it("la plantilla lleva SOLO la fila de cabeceras, las mismas que la exportación", () => {
    const tpl = accountsCsvTemplate();
    expect(tpl.trim().split("\n")).toHaveLength(1);
    expect(tpl.trim()).toBe(ACCOUNTS_CSV_HEADERS.join(","));
    expect(accountsToCsv([]).trim()).toBe(tpl.trim());
  });
  it("las cabeceras son las que entiende el importador (normalizadas a minúsculas_con_guion_bajo)", () => {
    const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    for (const h of ACCOUNTS_CSV_HEADERS) expect(norm(h)).toBe(h);
    expect(ACCOUNTS_CSV_HEADERS).toEqual(expect.arrayContaining(["email", "imap_host", "imap_password", "smtp_host", "smtp_password"]));
  });
  it("exporta escapando comas y comillas", () => {
    const csv = accountsToCsv([{ email: "a@b.es", first_name: 'Ana "la jefa"', last_name: "Pérez, S.L.", imap_port: 993 }]);
    const row = csv.trim().split("\n")[1];
    expect(row).toContain('"Ana ""la jefa"""');
    expect(row).toContain('"Pérez, S.L."');
    expect(row.startsWith("a@b.es,")).toBe(true);
  });
});

function setup(over: Partial<React.ComponentProps<typeof AddAccountDialog>> = {}) {
  const props = {
    open: true, onOpenChange: vi.fn(), renderForm: () => <div>FORMULARIO SMTP</div>,
    onSubmitSingle: vi.fn(), onCsvFile: vi.fn(), onDownloadTemplate: vi.fn(), onDownloadAccounts: vi.fn(), accountsCount: 3,
    ...over,
  };
  render(<AddAccountDialog {...props} />);
  return props;
}

describe("AddAccountDialog", () => {
  it("ofrece las dos vías y «Descargar mails»", () => {
    const p = setup();
    expect(screen.getByText("Conectar una cuenta")).toBeInTheDocument();
    expect(screen.getByText("Bulk connect")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Descargar mails/ }));
    expect(p.onDownloadAccounts).toHaveBeenCalled();
  });
  it("una cuenta: Continuar → formulario → Añadir cuenta", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText("FORMULARIO SMTP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Añadir cuenta" }));
    expect(p.onSubmitSingle).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    expect(screen.getByText("Bulk connect")).toBeInTheDocument();
  });
  it("Bulk connect: muestra la zona de subida con «Descargar plantilla» y entrega el archivo", () => {
    const p = setup({ initialMode: "bulk" });
    fireEvent.click(screen.getByRole("button", { name: /Descargar plantilla/ }));
    expect(p.onDownloadTemplate).toHaveBeenCalled();
    const file = new File(["email\n"], "cuentas.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Archivo CSV de cuentas"), { target: { files: [file] } });
    expect(p.onCsvFile).toHaveBeenCalledWith(file);
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });
  it("sin cuentas, «Descargar mails» está desactivado", () => {
    setup({ accountsCount: 0 });
    expect(screen.getByRole("button", { name: /Descargar mails/ })).toBeDisabled();
  });
});

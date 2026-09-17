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
    onPickProvider: vi.fn(), onSubmitSingle: vi.fn(), onCsvFile: vi.fn(), onDownloadTemplate: vi.fn(), onDownloadAccounts: vi.fn(), accountsCount: 3,
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
  it("una cuenta: elige proveedor con su logo (Gmail / Outlook / SMTP) → formulario → Añadir cuenta", () => {
    const p = setup();
    expect(document.querySelector('[data-logo="gmail"]')).not.toBeNull();
    expect(document.querySelector('[data-logo="outlook"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Gmail" }));
    expect(p.onPickProvider).toHaveBeenCalledWith("gmail");
    expect(screen.getByText("FORMULARIO SMTP")).toBeInTheDocument();
    expect(screen.getByText("Conectar con Gmail")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Añadir cuenta" }));
    expect(p.onSubmitSingle).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    expect(screen.getByText("Bulk connect")).toBeInTheDocument();
  });
  it("cada proveedor prepara el formulario con su clave", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Outlook" }));
    expect(p.onPickProvider).toHaveBeenLastCalledWith("outlook");
    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    fireEvent.click(screen.getByRole("button", { name: "SMTP" }));
    expect(p.onPickProvider).toHaveBeenLastCalledWith("custom");
    expect(screen.getByText("Conectar con SMTP")).toBeInTheDocument();
  });
  it("el formulario recibe el proveedor elegido; el error se ve y, conectando, el botón se bloquea", () => {
    const renderForm = vi.fn((p: string) => <div>form:{p}</div>);
    const p = setup({ renderForm, submitError: "No se pudo conectar: SMTP auth failed", submitting: true });
    fireEvent.click(screen.getByRole("button", { name: "Outlook" }));
    expect(screen.getByText("form:outlook")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("SMTP auth failed");
    const btn = screen.getByRole("button", { name: /Conectando/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(p.onSubmitSingle).not.toHaveBeenCalled();
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

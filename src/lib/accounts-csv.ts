// CSV de cuentas de email: UNA sola definición de columnas para la plantilla que se descarga,
// la exportación ("Descargar mails") y lo que entiende el importador (Bulk connect). Así un
// archivo exportado se puede volver a importar tal cual, y la plantilla nunca se desalinea.

export const ACCOUNTS_CSV_HEADERS = [
  "email", "first_name", "last_name",
  "imap_username", "imap_password", "imap_host", "imap_port",
  "smtp_username", "smtp_password", "smtp_host", "smtp_port",
] as const;

const csvCell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Plantilla para Bulk connect: SOLO la fila de cabeceras (sin ejemplos que alguien
 *  importaría por error como una cuenta real). */
export function accountsCsvTemplate(): string {
  return ACCOUNTS_CSV_HEADERS.join(",") + "\n";
}

/** Exportación de cuentas con las mismas columnas que la plantilla. */
export function accountsToCsv(accounts: Array<Record<string, unknown>>): string {
  const lines = [ACCOUNTS_CSV_HEADERS.join(",")];
  for (const a of accounts) lines.push(ACCOUNTS_CSV_HEADERS.map((h) => csvCell(a[h])).join(","));
  return lines.join("\n") + "\n";
}

/** Descarga un texto como archivo (con BOM para que Excel respete los acentos). */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

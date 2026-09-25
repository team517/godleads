import { describe, expect, it } from "vitest";
import { elegirCarpetaEnviados, fechaImap } from "../../supabase/functions/_shared/sent-folder";

const LISTA_IONOS = [
  '* LIST (\HasNoChildren) "." "INBOX"',
  '* LIST (\HasNoChildren \Drafts) "." "Drafts"',
  '* LIST (\HasNoChildren \Sent) "." "Sent"',
  '* LIST (\HasNoChildren \Trash) "." "Trash"',
  "c2 OK LIST completed",
].join("\r\n");

const LISTA_SIN_MARCAS = [
  '* LIST (\HasNoChildren) "/" "INBOX"',
  '* LIST (\HasNoChildren) "/" "Enviados"',
  '* LIST (\HasNoChildren) "/" "Papelera"',
  "c2 OK LIST completed",
].join("\r\n");

describe("elegirCarpetaEnviados", () => {
  it("usa la marca \Sent cuando el servidor la da", () => {
    expect(elegirCarpetaEnviados(LISTA_IONOS)).toBe("Sent");
  });
  it("si no hay marcas, reconoce el nombre en español", () => {
    expect(elegirCarpetaEnviados(LISTA_SIN_MARCAS)).toBe("Enviados");
  });
  it("reconoce la carpeta colgando de INBOX", () => {
    expect(elegirCarpetaEnviados('* LIST (\HasNoChildren) "." "INBOX.Sent"\r\nc2 OK')).toBe("INBOX.Sent");
  });
  it("si no encuentra ninguna, lo dice", () => {
    expect(elegirCarpetaEnviados('* LIST (\HasNoChildren) "." "INBOX"\r\nc2 OK')).toBeNull();
  });
});

describe("fechaImap", () => {
  it("da el formato que pide APPEND", () => {
    expect(fechaImap(new Date("2026-09-24T17:13:02Z"))).toBe("24-Sep-2026 17:13:02 +0000");
  });
});

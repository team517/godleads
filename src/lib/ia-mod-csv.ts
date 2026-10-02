// Modificaciones IA — leer un CSV adjunto en el chat de PulseBot (parte pura, se prueba).
//
// Mismos criterios que el importador de leads de la plataforma (csv-parser.ts): cabeceras en
// minúsculas con guiones bajos, email obligatorio y válido, campos limpiados con cleanCsvField.
// Un CSV sin columna de email se acepta igualmente como "tabla" para que PulseBot lo analice.
import { cleanCsvField, parseCSV } from "@/lib/csv-parser";
import { repairMojibakeBytes } from "@/lib/reply-text";

export const MAX_FILAS_ADJUNTO = 25000;
export const TROZO_SUBIDA = 2000;

/** Cómo llaman al email los CSV de verdad (Apollo, Excel en español, CRMs…). */
const ALIAS_EMAIL = ["email", "e_mail", "e-mail", "email_address", "work_email", "business_email", "correo", "correo_electronico", "correo_electrónico", "mail", "emails", "email_1"];

const EMAIL_OK = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

export interface CsvPreparado {
  /** "documento" = un PDF: cada fila es una página ({ pagina, texto }). */
  kind: "leads" | "tabla" | "documento";
  headers: string[];
  rows: Record<string, string>[];
  /** Filas que no entran: sin email válido (en "leads") o vacías. */
  descartadas: number;
  total: number;
  /** Sólo PDF: el documento era más largo de lo que se sube y se ha cortado. */
  recortado?: boolean;
}

/** Bytes del archivo → texto: UTF-8 si lo es; si no, Windows-1252 (el CSV típico de Excel en español). */
export function decodificarArchivo(buf: ArrayBuffer): string {
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    texto = new TextDecoder("windows-1252").decode(buf);
  }
  return repairMojibakeBytes(texto);
}

const cabecera = (h: string) => String(h || "").trim().toLowerCase().replace(/\s+/g, "_");

export function prepararCsv(texto: string): CsvPreparado | { error: string } {
  const filas = parseCSV(texto);
  if (filas.length < 2) return { error: "El archivo está vacío o sólo tiene la cabecera" };
  if (filas.length - 1 > MAX_FILAS_ADJUNTO) return { error: `El archivo tiene ${(filas.length - 1).toLocaleString("es-ES")} filas; el máximo es ${MAX_FILAS_ADJUNTO.toLocaleString("es-ES")}. Divídelo en varios.` };

  // Cabeceras únicas (como el importador: la segunda "email" pasa a "email_2").
  const cuenta: Record<string, number> = {};
  let headers = filas[0].map((h, i) => {
    const c = cabecera(h) || `columna_${i + 1}`;
    cuenta[c] = (cuenta[c] || 0) + 1;
    return cuenta[c] === 1 ? c : `${c}_${cuenta[c]}`;
  });
  // La columna del email, se llame como se llame, pasa a "email".
  if (!headers.includes("email")) {
    const i = headers.findIndex((h) => ALIAS_EMAIL.includes(h));
    if (i >= 0) headers = headers.map((h, j) => (j === i ? "email" : h));
  }
  const iEmail = headers.indexOf("email");
  const cuerpo = filas.slice(1);

  if (iEmail < 0) {
    const rows = cuerpo
      .map((v) => Object.fromEntries(headers.map((h, i) => [h, String(v[i] ?? "").trim().slice(0, 1000)])))
      .filter((r) => Object.values(r).some(Boolean));
    return { kind: "tabla", headers, rows, descartadas: cuerpo.length - rows.length, total: cuerpo.length };
  }

  const rows: Record<string, string>[] = [];
  for (const v of cuerpo) {
    const email = String(v[iEmail] ?? "").trim().replace(/[,\s]/g, "").toLowerCase();
    if (!EMAIL_OK.test(email)) continue;
    const r: Record<string, string> = {};
    headers.forEach((h, i) => { r[h] = h === "email" ? email : cleanCsvField(h, String(v[i] ?? "")); });
    rows.push(r);
  }
  return { kind: "leads", headers, rows, descartadas: cuerpo.length - rows.length, total: cuerpo.length };
}

export const MAX_PAGINAS_PDF = 60;
const MAX_CHARS_PAGINA = 8000;
const MAX_CHARS_PDF = 300_000;
/** Páginas por petición al subir un PDF (cada una puede traer varios KB de texto). */
export const TROZO_PAGINAS = 5;

/**
 * Las páginas de un PDF (texto ya extraído) → un adjunto que PulseBot puede leer. Un PDF escaneado
 * (sólo imágenes) no trae texto: se avisa en vez de subir un documento vacío.
 */
export function prepararDocumento(paginas: string[]): CsvPreparado | { error: string } {
  const rows: Record<string, string>[] = [];
  let chars = 0, vacias = 0, recortado = false;
  paginas.slice(0, MAX_PAGINAS_PDF).forEach((p, i) => {
    const texto = String(p || "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
    if (!texto) { vacias++; return; }
    if (chars >= MAX_CHARS_PDF) { recortado = true; return; }
    const t = texto.slice(0, Math.min(MAX_CHARS_PAGINA, MAX_CHARS_PDF - chars));
    if (t.length < texto.length) recortado = true;
    chars += t.length;
    rows.push({ pagina: String(i + 1), texto: t });
  });
  if (!rows.length) return { error: "No he podido leer texto en ese PDF: parece escaneado (sólo imágenes). Súbelo con texto seleccionable o pega el contenido en el chat." };
  if (paginas.length > MAX_PAGINAS_PDF) recortado = true;
  return { kind: "documento", headers: ["pagina", "texto"], rows, descartadas: vacias, total: paginas.length, ...(recortado ? { recortado: true } : {}) };
}

/** Trozos para subir sin mandar un cuerpo enorme de una vez. */
export function trozos<T>(lista: T[], n = TROZO_SUBIDA): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

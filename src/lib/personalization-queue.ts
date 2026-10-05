// Cola de personalizaciones: cómo se presenta cada lista y cómo se exporta su CSV.
//
// 04-10-2026, petición del dueño: poder subir varias listas seguidas. Cada "Generar todo" crea un
// trabajo en el servidor y la página vuelve al paso 1 para la siguiente; el procesador (cron cada
// minuto + empujón de la página) genera hasta 4 a la vez y las demás esperan su turno. Aquí va lo
// que no toca la pantalla, para poder probarlo: el estado que se enseña, el orden de la cola, el
// puesto de cada lista y el CSV que se descarga (siempre desde lo guardado en el servidor).
import Papa from "papaparse";

export interface TrabajoCola {
  id: string;
  filename: string | null;
  status: string;
  total: number | null;
  done: number | null;
  ok: number | null;
  failed: number | null;
  created_at: string;
  updated_at?: string | null;
  /** Columnas del CSV tal como se subió (jsonb); puede faltar en trabajos antiguos. */
  columns?: unknown;
  email_column?: string | null;
  /** Etiqueta libre para saber de quién o para qué es la lista ("Lucy", "Juan software"…). */
  label?: string | null;
}

export type EstadoCola = {
  txt: string;
  cls: "soft-state-wait" | "soft-state-good" | "soft-state-bad";
  /** Se está generando o espera su turno: se sondea y se puede parar. */
  activo: boolean;
  /** Aún no ha empezado (espera turno): se enseña su puesto. */
  enCola: boolean;
};

export type FilaCsv = Record<string, unknown> & { __idx: number };
export type ResultadosCsv = Record<string, { message: string; error?: string }>;

const esActivo = (status: string) => status === "pending" || status === "running";

/** Lo que ve el usuario de cada lista. Entre tanda y tanda el servidor la deja en "pending": si ya
 *  tiene mensajes sigue siendo "Generando", no "En cola". */
export function estadoTrabajo(h: Pick<TrabajoCola, "status" | "done">): EstadoCola {
  if (h.status === "uploading") return { txt: "Subiendo leads", cls: "soft-state-wait", activo: false, enCola: false };
  if (h.status === "running" || (h.status === "pending" && (h.done || 0) > 0)) return { txt: "Generando", cls: "soft-state-wait", activo: true, enCola: false };
  if (h.status === "pending") return { txt: "En cola", cls: "soft-state-wait", activo: true, enCola: true };
  if (h.status === "completed") return { txt: "Completada", cls: "soft-state-good", activo: false, enCola: false };
  if (h.status === "cancelled") return { txt: "Parada", cls: "soft-state-wait", activo: false, enCola: false };
  return { txt: "Con errores", cls: "soft-state-bad", activo: false, enCola: false };
}

/** Las que se están haciendo o esperan, primero y en el orden en que van (la más antigua antes);
 *  después las terminadas, la más reciente arriba. */
export function ordenarCola<T extends TrabajoCola>(lista: T[]): T[] {
  const t = (h: TrabajoCola) => Date.parse(h.created_at) || 0;
  const vivas = lista.filter((h) => esActivo(h.status) || h.status === "uploading").sort((a, b) => t(a) - t(b));
  const resto = lista.filter((h) => !(esActivo(h.status) || h.status === "uploading")).sort((a, b) => t(b) - t(a));
  return [...vivas, ...resto];
}

/** Puesto (1 = la siguiente) entre las listas que aún no han empezado; null si no espera. */
export function puestoEnCola(lista: TrabajoCola[], id: string): number | null {
  const esperando = ordenarCola(lista).filter((h) => estadoTrabajo(h).enCola);
  const i = esperando.findIndex((h) => h.id === id);
  return i >= 0 ? i + 1 : null;
}

export const hayActivas = (lista: TrabajoCola[]) => lista.some((h) => esActivo(h.status));

/** Columnas de una lista: las guardadas con el trabajo o, si no están, las de sus filas. */
export function columnasDe(columns: unknown, rows: Array<Record<string, unknown>>): string[] {
  if (Array.isArray(columns) && columns.length) return columns.map(String);
  const out: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (k !== "__idx" && !out.includes(k)) out.push(k);
  return out;
}

/** Un mensaje HTML / de varias líneas en UNA celda: los saltos de línea rompen el importador de
 *  Instantly / Smartlead. */
export function flattenCell(s: string): string {
  return (s || "").replace(/>\s+</g, "><").replace(/\r?\n+/g, " ").trim();
}

/** El CSV descargable: las columnas del archivo + personalized_message, una fila por lead y en el
 *  orden del archivo (por __idx), venga de la página o del servidor. */
export function csvPersonalizado(cols: string[], rows: FilaCsv[], results: ResultadosCsv): string {
  const base = cols.filter((c) => c !== "personalized_message" && c !== "__idx");
  const ordenadas = [...rows].sort((a, b) => a.__idx - b.__idx);
  const data = ordenadas.map((r) => {
    const rr = results[String(r.__idx)];
    return [...base.map((c) => (r[c] === undefined || r[c] === null ? "" : String(r[c]))), rr?.error ? `[ERROR] ${rr.error}` : flattenCell(rr?.message || "")];
  });
  return Papa.unparse({ fields: [...base, "personalized_message"], data });
}

export function nombreDescarga(filename: string | null | undefined, label?: string | null): string {
  const base = `${(filename || "").replace(/\.csv$/i, "") || "leads"}_personalizado.csv`;
  const tag = limpiarEtiqueta(label).replace(/[\\/:*?"<>|]+/g, "-");
  return tag ? `${tag} - ${base}` : base;
}

/* ── Etiquetas de las listas (05-10-2026) ── */

/** Lo que se guarda: sin espacios de sobra y como mucho 40 caracteres. Vacía = sin etiqueta. */
export function limpiarEtiqueta(s: string | null | undefined): string {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

/** Las etiquetas usadas, sin repetir (sin distinguir mayúsculas), por orden de uso, con cuántas listas. */
export function etiquetasDe(lista: Pick<TrabajoCola, "label">[]): { label: string; n: number }[] {
  const m = new Map<string, { label: string; n: number }>();
  for (const h of lista) {
    const l = limpiarEtiqueta(h.label);
    if (!l) continue;
    const k = l.toLowerCase();
    const cur = m.get(k);
    if (cur) cur.n++; else m.set(k, { label: l, n: 1 });
  }
  return [...m.values()];
}

/** ¿Pasa el filtro de etiqueta? null = todas; "" = las que no tienen. */
export function pasaFiltroEtiqueta(h: Pick<TrabajoCola, "label">, filtro: string | null): boolean {
  if (filtro === null) return true;
  return limpiarEtiqueta(h.label).toLowerCase() === filtro.toLowerCase();
}

/** Un color estable por etiqueta (la misma etiqueta, el mismo color siempre). */
const PALETA = ["#6E58F1", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#EC4899", "#8B5CF6", "#14B8A6", "#F97316", "#64748B"];
export function colorEtiqueta(label: string | null | undefined): string {
  const s = limpiarEtiqueta(label).toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}

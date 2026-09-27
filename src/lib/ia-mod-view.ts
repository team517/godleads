// Modificaciones IA — tipos y textos de la pantalla (parte pura, se prueba).
import { ADMIN_EMAILS } from "@/lib/access";

/** Las mismas tres cuentas que deja pasar el servidor (hello@, support@, equipo@). */
export const puedeVerIaMod = (email: string | null | undefined) => ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());

export interface IaCliente {
  id: string; email: string; full_name: string; company_name: string;
  logo_url: string | null; brand_color: string | null; campaigns: number; active: number;
  last_chat_at?: string | null; last_chat_preview?: string;
}

export interface VistaPaso {
  step_id: string; posicion: number; espera_dias: number; asunto: string; cuerpo: string;
  variantes: { letra: string; encendida: boolean; asunto: string; cuerpo: string }[];
}

export type IaTarjeta =
  | { type: "mensajes"; campaign_id: string; campaign_name: string; status: string; steps: VistaPaso[]; summary?: string }
  | { type: "metricas"; titulo: string; subtitulo: string; dias: number;
      totales: { enviados_periodo: number; respuestas_periodo: number; enviados: number; contactados: number; respuestas: number; interesados: number; rebotes: number; tasa_respuesta: number };
      serie: { day: string; sends: number; replies: number }[];
      campanas: { nombre: string; estado: string; enviados_periodo: number; respuestas_periodo: number; contactados: number; respuestas: number; interesados: number }[];
      summary?: string }
  | { type: "cambio" | "pendiente"; change_id: string; summary: string; campaign_name?: string; posicion?: number; letra?: string;
      asunto?: string; cuerpo?: string; espera_dias?: number; aviso?: string; activa?: boolean;
      mensajes?: { posicion: number; asunto: string; cuerpo: string; espera_dias: number }[];
      importacion?: ImportacionVista }
  | { type: "adjunto"; upload_id: string; nombre: string; tipo: "leads" | "tabla"; filas: number; descartadas?: number; columnas: string[]; summary?: string }
  | { type: "nota"; texto: string; summary?: string };

export interface ImportacionVista {
  archivo: string; nuevos: number; actualizados: number; invalidos: number; repetidos: number;
  columnas: string[]; variables_sin_columna: string[]; renombradas: Record<string, string>;
  ejemplo: Record<string, string>[];
}

export interface IaMensaje {
  id: string; role: "user" | "assistant"; content: string; cards: IaTarjeta[]; author_email: string | null; created_at: string;
}

export const ESTADO_CAMPANA: Record<string, string> = { active: "Activa", paused: "Pausada", draft: "Borrador", completed: "Terminada" };

export const ESTADO_CAMBIO: Record<string, string> = {
  applied: "Aplicado", undone: "Deshecho", pending: "Pendiente de confirmar", cancelled: "Cancelado",
};

export function nombreCliente(c: Pick<IaCliente, "company_name" | "full_name" | "email">): string {
  return c.company_name || c.full_name || c.email.split("@")[0] || "Cliente";
}

/** "hace 5 min", "ayer 18:02", "12 sept 10:15". */
export function horaMensaje(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const min = Math.round((now - d.getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const hoy = new Date(now); hoy.setHours(0, 0, 0, 0);
  const ayer = new Date(hoy.getTime() - 86400000);
  if (d >= hoy) return hm;
  if (d >= ayer) return `ayer ${hm}`;
  return `${d.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} ${hm}`;
}

/** Día de la serie ("2026-09-27") → "27 sept". */
export const diaCorto = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });

/** Hora bajo cada burbuja: "10:24" si es de hoy, "ayer 18:05" o "12 sept 10:15". */
export function horaCorta(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const hoy = new Date(now); hoy.setHours(0, 0, 0, 0);
  if (d >= hoy) return hm;
  if (d >= new Date(hoy.getTime() - 86400000)) return `ayer ${hm}`;
  return `${d.toLocaleDateString("es-ES", { day: "numeric", month: "short" })} ${hm}`;
}

/** "Hace 5 min", "Hace 2 horas", "Hace 1 día", "Hace 3 días" (para las conversaciones recientes). */
export function haceCuanto(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return "Ahora mismo";
  if (min < 60) return `Hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? "Hace 1 hora" : `Hace ${h} horas`;
  const d = Math.round(h / 24);
  return d === 1 ? "Hace 1 día" : `Hace ${d} días`;
}

/** Clientes con conversación, la más reciente primero. */
export function conversacionesRecientes(clientes: IaCliente[], max = 6): IaCliente[] {
  return clientes.filter((c) => c.last_chat_at).sort((a, b) => String(b.last_chat_at).localeCompare(String(a.last_chat_at))).slice(0, max);
}

/** CSV de una tarjeta de métricas (se abre bien en Excel en español: separador ";" y BOM). */
export function csvMetricas(t: Extract<IaTarjeta, { type: "metricas" }>): string {
  const q = (v: unknown) => {
    const x = String(v ?? "");
    return /[";\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  const filas: unknown[][] = [
    ["Métricas", t.titulo, `últimos ${t.dias} días`],
    [],
    ["Día", "Envíos", "Respuestas"],
    ...t.serie.map((d) => [d.day, d.sends, d.replies]),
    [],
    ["Envíos en el periodo", t.totales.enviados_periodo],
    ["Respuestas en el periodo", t.totales.respuestas_periodo],
    ["Contactados en total", t.totales.contactados],
    ["Respuestas en total", t.totales.respuestas],
    ["Tasa de respuesta (%)", String(t.totales.tasa_respuesta).replace(".", ",")],
    ["Interesados", t.totales.interesados],
    ["Rebotes", t.totales.rebotes],
  ];
  if (t.campanas.length) {
    filas.push([], ["Campaña", "Estado", "Envíos periodo", "Respuestas periodo", "Contactados", "Respuestas", "Interesados"]);
    for (const c of t.campanas) filas.push([c.nombre, ESTADO_CAMPANA[c.estado] || c.estado, c.enviados_periodo, c.respuestas_periodo, c.contactados, c.respuestas, c.interesados]);
  }
  return "\uFEFF" + filas.map((f) => f.map(q).join(";")).join("\r\n");
}

/** Sugerencias del panel derecho: texto que se envía y color del icono. */
export const SUGERENCIAS: { id: string; texto: string; tono: "blue" | "violet" | "amber" | "indigo" | "green" }[] = [
  { id: "graficos", texto: "Analiza sus campañas con gráficos", tono: "blue" },
  { id: "mensajes", texto: "Enséñame los mensajes de su campaña activa", tono: "violet" },
  { id: "asuntos", texto: "Dame 5 asuntos con alta apertura para su primer correo", tono: "amber" },
  { id: "secuencia", texto: "Optimiza su secuencia de emails", tono: "indigo" },
  { id: "respuestas", texto: "¿Qué están respondiendo sus leads? Dame ideas para mejorar", tono: "green" },
];

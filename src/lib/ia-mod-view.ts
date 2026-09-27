// Modificaciones IA — tipos y textos de la pantalla (parte pura, se prueba).
import { ADMIN_EMAILS } from "@/lib/access";

/** Las mismas tres cuentas que deja pasar el servidor (hello@, support@, equipo@). */
export const puedeVerIaMod = (email: string | null | undefined) => ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());

export interface IaCliente {
  id: string; email: string; full_name: string; company_name: string;
  logo_url: string | null; brand_color: string | null; campaigns: number; active: number;
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
      mensajes?: { posicion: number; asunto: string; cuerpo: string; espera_dias: number }[] }
  | { type: "nota"; texto: string; summary?: string };

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

export const SUGERENCIAS = [
  "Enséñame sus campañas y cómo van",
  "Métricas de los últimos 14 días en imagen",
  "Enséñame los mensajes de su campaña activa",
  "¿Qué están respondiendo los leads? Dame ideas para mejorar",
  "Crea una variante B del primer correo con otro ángulo",
];

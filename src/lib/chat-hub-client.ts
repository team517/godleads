// Cliente del chatbot flotante (10-11-2026): conversaciones guardadas, visitantes sin sesión y
// peticiones para hablar con el equipo. Todo lo de visitantes pasa por la función chat-hub (el
// visitante no toca la base); lo de usuarios con sesión va directo a las tablas por RLS.
import { supabase } from "@/integrations/supabase/client";

export const DEMO_URL = "https://cal.com/xavier-falco-hszeeb/15min";
const VISITOR_KEY = "fl_visitor_id";
const VISITOR_CONV_KEY = "fl_visitor_conversation";

export type ChatConversation = { id: string; title: string | null; last_message_at: string; message_count: number; mode?: string | null; team_status?: string | null };
export type StoredMessage = { id?: string; role: "user" | "assistant" | "system"; content: string; cards?: unknown; via?: string | null; created_at?: string; author_name?: string | null };

/** Id anónimo del navegador para los visitantes (se guarda en localStorage). */
export function visitorId(): string {
  try {
    const prev = localStorage.getItem(VISITOR_KEY);
    if (prev && /^[A-Za-z0-9_-]{8,64}$/.test(prev)) return prev;
  } catch { /* sin almacenamiento */ }
  const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  try { localStorage.setItem(VISITOR_KEY, id); } catch { /* */ }
  return id;
}
export function visitorConversation(): string | null {
  try { return localStorage.getItem(VISITOR_CONV_KEY); } catch { return null; }
}
export function rememberVisitorConversation(id: string | null) {
  try { if (id) localStorage.setItem(VISITOR_CONV_KEY, id); else localStorage.removeItem(VISITOR_CONV_KEY); } catch { /* */ }
}

export async function callChatHub<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("chat-hub", { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

/* ── Usuarios con sesión: tablas directas (RLS: sólo lo suyo) ─────────────────────────────────── */

export async function listConversations(): Promise<ChatConversation[]> {
  const { data, error } = await (supabase as any).from("chat_conversations")
    .select("id, title, last_message_at, message_count, mode, team_status").order("last_message_at", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data || []) as ChatConversation[];
}

export async function createConversation(userId: string, mode: string): Promise<string> {
  const { data, error } = await (supabase as any).from("chat_conversations").insert({ user_id: userId, mode }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function loadMessages(conversationId: string): Promise<StoredMessage[]> {
  const { data, error } = await (supabase as any).from("chat_messages")
    .select("id, role, content, cards, via, created_at, author_name").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(300);
  if (error) throw new Error(error.message);
  return (data || []) as StoredMessage[];
}

/** Guarda un mensaje; nunca rompe el chat si falla (se avisa por consola). */
export async function saveMessage(conversationId: string, m: StoredMessage): Promise<void> {
  const { error } = await (supabase as any).from("chat_messages").insert({
    conversation_id: conversationId, role: m.role, content: m.content, cards: m.cards ?? null, via: m.via ?? null,
  });
  if (error) console.warn("chat: no se pudo guardar el mensaje:", error.message);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const { error } = await (supabase as any).from("chat_conversations").delete().eq("id", conversationId);
  if (error) throw new Error(error.message);
}

/** Fecha corta para la lista del historial. */
export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  return mismoDia
    ? d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

/* ── Chat en directo con el equipo (10-11-2026) ───────────────────────────────────────────────
   El cliente escribe al equipo y el equipo responde desde Mensajes (/peticiones). Todo pasa por
   chat-hub: con sesión, chat-hub sabe quién es por el token; sin sesión, por el visitor_id. */

export type TeamMessage = { id: string; role: "user" | "assistant" | "system"; content: string; via: string | null; author_name?: string | null; created_at: string };
export type TeamSendResult = { conversation_id: string; team_status: string; message: TeamMessage; contact_email: string | null; needs_email: boolean };

const TEAM_THREAD_KEY = "fl_team_thread";

/** Hilo abierto con el equipo en este navegador (para el aviso de no leídos del botón flotante). */
export function rememberTeamThread(id: string | null, ownerUserId: string | null) {
  try {
    if (id) localStorage.setItem(TEAM_THREAD_KEY, JSON.stringify({ id, uid: ownerUserId }));
    else localStorage.removeItem(TEAM_THREAD_KEY);
  } catch { /* sin almacenamiento */ }
}
/** El hilo recordado, sólo si es de quien está ahora (o de nadie, si es un visitante). */
export function teamThread(currentUserId: string | null): string | null {
  try {
    const raw = localStorage.getItem(TEAM_THREAD_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { id?: string; uid?: string | null };
    if (!j?.id) return null;
    return (j.uid || null) === (currentUserId || null) ? j.id : null;
  } catch { return null; }
}

export function teamSend(o: { conversationId: string | null; visitorId: string | null; message: string; page?: string }): Promise<TeamSendResult> {
  return callChatHub<TeamSendResult>({ action: "team_send", conversation_id: o.conversationId, visitor_id: o.visitorId, message: o.message, page: o.page });
}
export function teamPoll(o: { conversationId: string; visitorId: string | null; since?: string | null }): Promise<{ conversation_id: string; team_status: string; contact_email: string | null; messages: TeamMessage[] }> {
  return callChatHub({ action: "team_poll", conversation_id: o.conversationId, visitor_id: o.visitorId, since: o.since || undefined });
}
export function teamUnread(visitorId: string | null): Promise<{ unread: number; conversation_id: string | null; team_status: string }> {
  return callChatHub({ action: "team_unread", visitor_id: visitorId });
}
export function teamContact(o: { conversationId: string; visitorId: string | null; email: string }): Promise<{ ok: boolean; contact_email: string }> {
  return callChatHub({ action: "team_contact", conversation_id: o.conversationId, visitor_id: o.visitorId, contact_email: o.email });
}

/** Tiempo relativo corto ("ahora", "hace 5 min", "hace 2 h", "3 nov"). */
export function haceCuanto(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

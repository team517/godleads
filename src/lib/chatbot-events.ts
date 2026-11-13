// Abrir el asistente (FunnyBot) desde cualquier sitio, p. ej. el botón «Pregunta a la IA» (13-11-2026).
export const OPEN_CHATBOT = "fl:open-chatbot";
export function openChatbot() {
  try { window.dispatchEvent(new Event(OPEN_CHATBOT)); } catch { /* fuera del navegador */ }
}

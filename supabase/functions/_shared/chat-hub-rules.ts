// Reglas puras del chat (chat-hub): intención de hablar con una persona, validación de la petición
// al equipo, límites de visitantes y textos del correo. Sin Deno ni BD: se prueban con vitest.

/** Tope de mensajes de un visitante por conversación, y por día (por visitante y por IP). */
export const VISITOR_MAX_PER_CONVERSATION = 20;
export const VISITOR_MAX_PER_DAY = 60;
export const REQUEST_MESSAGE_MAX = 2000;
export const TRANSCRIPT_MAX = 20;

const PERSONA = /\b(hablar|contactar|charlar|reuni[oó]n|reunirme|llamada|llamadme|llamarme|cita|agendar|agenda|demo|demostraci[oó]n|presupuesto|cotizaci[oó]n|precio a medida|plan a medida|a medida|humano|persona real|una persona|alguien del equipo|con el equipo|con vosotros|con ustedes|comercial|asesor|soporte humano|talk to (a )?(human|person|someone|sales|the team)|speak (to|with) (a )?(human|person|someone)|book (a )?(call|demo|meeting)|schedule (a )?(call|demo|meeting)|custom (plan|pricing|quote)|get a quote|contact (you|sales|the team))\b/i;
const NEGACION = /\b(no (quiero|hace falta|necesito|me interesa) (una |la |ninguna )?(hablar|llamada|reuni[oó]n|demo|cita)|sin (llamada|reuni[oó]n|cita))\b/i;

/** ¿Quiere hablar con una persona del equipo (demo, llamada, precio a medida, soporte humano)? */
export function quiereHablarConElEquipo(texto: string): boolean {
  const t = String(texto || "").trim();
  if (t.length < 3) return false;
  if (NEGACION.test(t)) return false;
  return PERSONA.test(t);
}

export interface PeticionEntrada {
  name?: unknown; email?: unknown; company?: unknown; phone?: unknown; topic?: unknown; message?: unknown;
}
export interface PeticionValida {
  name: string; email: string; company: string | null; phone: string | null; topic: string | null; message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const limpio = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);

/** Valida y normaliza una petición. Devuelve {error} con el motivo en español si no vale. */
export function validarPeticion(p: PeticionEntrada): { ok: true; value: PeticionValida } | { ok: false; error: string } {
  const name = limpio(p.name, 120);
  const email = limpio(p.email, 200).toLowerCase();
  const message = limpio(p.message, REQUEST_MESSAGE_MAX + 1);
  if (name.length < 2) return { ok: false, error: "Dinos tu nombre." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "El correo no tiene un formato válido." };
  if (message.length < 3) return { ok: false, error: "Cuéntanos brevemente qué necesitas." };
  if (message.length > REQUEST_MESSAGE_MAX) return { ok: false, error: `El mensaje no puede pasar de ${REQUEST_MESSAGE_MAX} caracteres.` };
  return {
    ok: true,
    value: {
      name, email, message,
      company: limpio(p.company, 160) || null,
      phone: limpio(p.phone, 40) || null,
      topic: limpio(p.topic, 120) || null,
    },
  };
}

/** ¿Puede un visitante mandar otro mensaje? `enConversacion` = mensajes del usuario ya en esa
 *  conversación; `hoyVisitante` / `hoyIp` = contadores del día DESPUÉS de sumar este mensaje. */
export function visitanteDentroDeLimites(enConversacion: number, hoyVisitante: number, hoyIp: number): { ok: true } | { ok: false; error: string } {
  if (enConversacion >= VISITOR_MAX_PER_CONVERSATION) {
    return { ok: false, error: "Esta conversación ha llegado a su límite. Déjanos tu correo con «Hablar con el equipo» y seguimos por ahí." };
  }
  if (hoyVisitante > VISITOR_MAX_PER_DAY || hoyIp > VISITOR_MAX_PER_DAY) {
    return { ok: false, error: "Has llegado al límite de mensajes de hoy. Si quieres, déjanos tu correo con «Hablar con el equipo»." };
  }
  return { ok: true };
}

export interface MensajeTranscripcion { role: string; content: string; created_at?: string }

const escapeHtml = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Asunto y cuerpo HTML del aviso a team@ por una petición nueva. */
export function correoPeticion(p: PeticionValida, opts: { source: "visitor" | "user"; transcript: MensajeTranscripcion[]; userEmail?: string | null; appUrl: string }): { subject: string; html: string } {
  const subject = `Nueva petición desde el chat: ${p.name}${p.company ? ` (${p.company})` : ""}`;
  const filas: [string, string | null][] = [
    ["Nombre", p.name], ["Correo", p.email], ["Empresa", p.company], ["Teléfono", p.phone], ["Tema", p.topic],
    ["Origen", opts.source === "visitor" ? "Visitante de la landing (sin cuenta)" : `Usuario con cuenta${opts.userEmail ? ` (${opts.userEmail})` : ""}`],
  ];
  const tabla = filas.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#65768D">${k}</td><td style="padding:4px 0;color:#0F172B"><b>${escapeHtml(String(v))}</b></td></tr>`).join("");
  const trans = opts.transcript.slice(-TRANSCRIPT_MAX).map((m) =>
    `<p style="margin:0 0 8px"><b style="color:${m.role === "user" ? "#0F9D6E" : "#6E58F1"}">${m.role === "user" ? "Persona" : "Chat"}:</b> ${escapeHtml(m.content).slice(0, 600)}</p>`).join("");
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#0F172B;max-width:640px">
<h2 style="margin:0 0 12px;font-size:18px">Alguien quiere hablar con el equipo</h2>
<table style="border-collapse:collapse;margin-bottom:14px">${tabla}</table>
<p style="margin:0 0 6px;color:#65768D">Qué necesita</p>
<div style="white-space:pre-wrap;border-left:3px solid #6E58F1;padding:8px 12px;margin:0 0 16px;background:#F5F3FC">${escapeHtml(p.message)}</div>
${trans ? `<p style="margin:0 0 6px;color:#65768D">Lo que habló con el chat (últimos ${Math.min(opts.transcript.length, TRANSCRIPT_MAX)} mensajes)</p><div style="border:1px solid #E7E2D6;border-radius:8px;padding:10px 12px;margin-bottom:16px">${trans}</div>` : ""}
<p style="margin:0;font-size:13px;color:#65768D">Gestiónala en <a href="${opts.appUrl}/peticiones" style="color:#6E58F1">${opts.appUrl}/peticiones</a>. Responde directamente a ${escapeHtml(p.email)}.</p>
</div>`;
  return { subject, html };
}

/** Título de una conversación: el primer mensaje del usuario, recortado. */
export function tituloDeConversacion(primerMensaje: string, max = 60): string {
  const t = String(primerMensaje || "").replace(/\s+/g, " ").trim();
  if (!t) return "Nueva conversación";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** El asistente comercial de Funnyleads para visitantes (sin cuenta). */
export const VISITOR_SYSTEM_PROMPT = `Eres FunnyBot, el asistente de Funnyleads, una plataforma de cold email para equipos que envían a volumen.
Hablas con un VISITANTE de la web que aún no tiene cuenta. Responde en el idioma en que te escriban (español por defecto), breve (máximo 120 palabras), claro y sin promesas de resultados concretos.

LO QUE ES FUNNYLEADS:
- Buzones de envío y warm-up ILIMITADOS en todos los planes, sin coste por buzón; configuración de dominios (SPF, DKIM, DMARC) incluida.
- Motor de envío pensado para cold email: ritmo por buzón, slow ramp automático, pausas si el proveedor falla.
- AI replies: las respuestas se clasifican al instante (interesado, no interesado, fuera de oficina…) y se redactan borradores de respuesta.
- Master Inbox: todas las respuestas de todos los buzones en una sola bandeja, con avisos al móvil.
- Envío en la zona horaria de cada contacto ("todos reciben el correo a las 9 de la mañana").
- Proveedores: Gmail, Outlook o servidores propios (IONOS, etc.).

PLANES (IVA no incluido, todos con 14 días de prueba, cancelas cuando quieras; anual con 17 % de descuento):
- Starter: 21 €/mes (anual 17 €/mes) · 15.000 correos/mes · 5.000 contactos.
- Growth: 65 €/mes (anual 54 €/mes) · 180.000 correos/mes · 60.000 contactos · más popular.
- Scale: 170 €/mes (anual 141 €/mes) · 500.000 correos/mes · 190.000 contactos.
- Enterprise: a medida, hablar con ventas. Formación 1:1 opcional: 350 € pago único.
Para empezar: botón "Start free trial" / "Choose" en la página de precios. Para una demo o hablar con una persona: la agenda https://cal.com/xavier-falco-hszeeb/15min o el botón «Hablar con el equipo» de este chat.

REGLAS: no inventes funciones ni cifras que no estén aquí; si no lo sabes, dilo y ofrece hablar con el equipo. No pidas contraseñas ni datos de pago. Si la persona quiere hablar con alguien, una demo, un presupuesto o tiene un caso especial, invítale a pulsar «Hablar con el equipo» en este chat: escribe ahí y una persona del equipo le contesta en el mismo chat.`;

/* ── Chat en directo con el equipo (10-11-2026) ────────────────────────────────────────────────
   El cliente o visitante escribe al equipo desde el chat; el equipo contesta desde /peticiones.
   Aviso a team@ con el PRIMER mensaje de un hilo y después como mucho cada 10 minutos. */

export const TEAM_MESSAGE_MAX = 2000;
export const NOTIFY_THROTTLE_MS = 10 * 60 * 1000;
/** Si el cliente ha sondeado el chat hace menos de esto, está mirando: no se le manda correo. */
export const CLIENT_ONLINE_MS = 45 * 1000;

/** Un mensaje para el equipo (o del equipo): sin caracteres de control, recortado y no vacío. */
export function validarMensajeEquipo(texto: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const t = limpio(texto, TEAM_MESSAGE_MAX + 1);
  if (!t) return { ok: false, error: "Escribe un mensaje." };
  if (t.length > TEAM_MESSAGE_MAX) return { ok: false, error: `El mensaje no puede pasar de ${TEAM_MESSAGE_MAX} caracteres.` };
  return { ok: true, value: t };
}

/** Correo de contacto normalizado, o null si no tiene formato válido. */
export function correoDeContacto(email: unknown): string | null {
  const e = limpio(email, 200).toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/** ¿Toca avisar a team@? La primera vez siempre; después, como mucho una vez cada 10 minutos. */
export function debeAvisarEquipo(lastNotifiedAt: string | null | undefined, nowMs: number): boolean {
  if (!lastNotifiedAt) return true;
  const last = Date.parse(lastNotifiedAt);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= NOTIFY_THROTTLE_MS;
}

/** ¿El cliente tiene el chat abierto ahora mismo (ha sondeado hace nada)? */
export function clienteMirando(clientSeenAt: string | null | undefined, nowMs: number): boolean {
  if (!clientSeenAt) return false;
  const t = Date.parse(clientSeenAt);
  return !Number.isNaN(t) && nowMs - t < CLIENT_ONLINE_MS;
}

/** Nombre de quien responde del equipo: su nombre de perfil, o la parte del correo antes de la @. */
export function nombreDeAutor(email: string | null | undefined, fullName?: string | null): string {
  const n = String(fullName || "").trim();
  if (n) return n.slice(0, 60);
  const local = String(email || "").split("@")[0].replace(/[._-]+/g, " ").trim();
  if (!local) return "Equipo de Funnyleads";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** Aviso a team@ por un mensaje nuevo en el chat. */
export function correoMensajeChat(o: {
  quien: string; cuenta: string | null; mensaje: string; pagina?: string | null; appUrl: string;
  previos?: MensajeTranscripcion[]; primero: boolean;
}): { subject: string; html: string } {
  const subject = `${o.primero ? "Nuevo chat" : "Nuevo mensaje en el chat"}: ${o.quien}`.slice(0, 140);
  const contexto = (o.previos || []).slice(-6).map((m) =>
    `<p style="margin:0 0 6px;color:#45556C"><b style="color:${m.role === "user" ? "#0F9D6E" : "#6E58F1"}">${m.role === "user" ? "Cliente" : "Chat"}:</b> ${escapeHtml(m.content).slice(0, 400)}</p>`).join("");
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#0F172B;max-width:640px">
<h2 style="margin:0 0 6px;font-size:18px">${o.primero ? "Alguien quiere hablar con el equipo" : "Nuevo mensaje en el chat"}</h2>
<p style="margin:0 0 14px;color:#65768D;font-size:14px">${escapeHtml(o.quien)}${o.cuenta ? ` · ${escapeHtml(o.cuenta)}` : ""}${o.pagina ? ` · desde ${escapeHtml(o.pagina)}` : ""}</p>
<div style="white-space:pre-wrap;border-left:3px solid #6E58F1;padding:10px 14px;margin:0 0 16px;background:#F5F3FC;font-size:15px">${escapeHtml(o.mensaje)}</div>
${contexto ? `<p style="margin:0 0 6px;color:#65768D;font-size:13px">Lo anterior en la conversación</p><div style="border:1px solid #E7E2D6;border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:13px">${contexto}</div>` : ""}
<p style="margin:0"><a href="${o.appUrl}/peticiones" style="display:inline-block;background:#6E58F1;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Responder en el chat</a></p>
<p style="margin:12px 0 0;font-size:12px;color:#65768D">Contesta desde Mensajes en la plataforma: la respuesta le aparece en su chat al momento.</p>
</div>`;
  return { subject, html };
}

/** Correo al cliente cuando el equipo le responde y no tiene el chat abierto. */
export function correoRespuestaAlCliente(o: { autor: string; mensaje: string; enlace: string }): { subject: string; html: string } {
  const subject = `${o.autor} te ha respondido en el chat de Funnyleads`.slice(0, 140);
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#0F172B;max-width:600px">
<p style="margin:0 0 12px;font-size:15px"><b>${escapeHtml(o.autor)}</b>, del equipo de Funnyleads, te ha respondido:</p>
<div style="white-space:pre-wrap;border-left:3px solid #6E58F1;padding:10px 14px;margin:0 0 16px;background:#F5F3FC;font-size:15px">${escapeHtml(o.mensaje)}</div>
<p style="margin:0"><a href="${o.enlace}" style="display:inline-block;background:#6E58F1;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Seguir la conversación</a></p>
<p style="margin:12px 0 0;font-size:12px;color:#65768D">También puedes responder a este correo.</p>
</div>`;
  return { subject, html };
}

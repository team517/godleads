import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sparkles, ArrowRight, Workflow, Plus, Pencil, Trash2, ChevronRight, UserPlus, GripVertical, Brain, Mail, FileText, MessageSquare, ShieldCheck, CheckCircle2, XCircle, Link2, RefreshCw, Loader2, ImagePlus, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractLogoColor } from "@/lib/logoColor";

type FormResponse = { id: string; form_id: string | null; form_title: string | null; respondent_email: string | null; answers: Record<string, unknown> | null; received_at: string };

// Match an incoming form response to a client in the flow by email, domain or company name.
const norm = (s?: string | null) => (s || "").toLowerCase().trim();
const domainOf = (email?: string | null) => norm(email).split("@")[1] || "";
function clientMatchesResponse(c: { email: string; company: string }, r: FormResponse): boolean {
  const rEmail = norm(r.respondent_email), rDom = domainOf(r.respondent_email);
  const ansText = norm(Object.values(r.answers || {}).map((v) => String(v)).join(" "));
  const cEmail = norm(c.email), cDom = domainOf(c.email), cComp = norm(c.company);
  if (rEmail && cEmail && rEmail === cEmail) return true;          // exact email
  if (rDom && cDom && rDom === cDom) return true;                   // same domain
  if (cComp && cComp.length >= 3 && (ansText.includes(cComp) || rEmail.includes(cComp.replace(/\s+/g, "")))) return true; // company name
  return false;
}

// Clean an inbound email body for display: strip quoted history + MIME/header noise, keep the
// person's actual message. Mirrors the cleaner the client-service-agent applies server-side.
function cleanInbound(raw?: string | null): string {
  let t = (raw || "").replace(/\r/g, "");
  const markers = [/\nOn .+ wrote:/i, /\nEl .+ escribi[oó]:/i, /\n-{2,}\s*Forwarded/i, /\n_{5,}/, /\nDe: .+\nEnviado:/i, /\nFrom: .+\nSent:/i];
  for (const rx of markers) { const mm = t.match(rx); if (mm && mm.index != null && mm.index > 20) t = t.slice(0, mm.index); }
  t = t.split("\n").filter((l) => !/^--[0-9a-f]{8,}/i.test(l) && !/^BODY\[/i.test(l) && !/^Content-(Type|Transfer|Disposition)/i.test(l) && !/^>+/.test(l.trim())).join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
const ACTION_LABEL: Record<string, string> = { reply: "Respondido", copy_change: "Copy cambiado", confirm: "Confirmado", escalate: "Escalado a team@", ignore: "Sin acción", error: "Error", skip_unknown: "Sin acción", escalate_unknown: "Escalado" };
const ACTION_STYLE = (a: string) => a === "error" ? "bg-destructive/10 text-destructive" : (a === "copy_change" || a === "confirm") ? "bg-emerald-500/10 text-emerald-600" : a === "reply" ? "bg-blue-500/10 text-blue-600" : /escalate/.test(a) ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground";

// Owner-only automation module — an EDITABLE flow (N8N-style) of the auto-onboarding +
// customer-service pipeline, organised as separate AI "agents" per phase. It runs on
// DeepSeek (wired up once the backend deploy path is restored).
//
// SAFETY (as the owner explicitly required): this module NEVER touches the sending engine.
//  · The campaign agent creates campaigns as DRAFTS only — never sets them active. The
//    engine only ever sends campaigns the owner approves.
//  · The reply agent escalates anything important to the owner (summary + proposed reply
//    saved as a draft); only routine replies are handled autonomously, rate-limited.
//  · Reports keep their existing per-client throttle. Nothing here mass-sends.
//
// FIRST VERSION: flow definition, clients-in-flow and the AI "brain" (memory + per-agent
// behaviour) are stored in the browser (localStorage) so the owner can shape and author
// everything now. Real persistence + execution plug in on the backend later.

type Node = { id: string; label: string; desc: string; agent: AgentKey };
type FlowClient = { id: string; name: string; email: string; company: string; context: string; step: number; startedAt: string; clientId?: string; onboardingSlug?: string; brandColor?: string; emailStatus?: "sending" | "sent" | "failed"; emailFrom?: string; emailError?: string; campaignStatus?: "generating" | "done" | "failed"; campaignError?: string; campaignName?: string; campaignSteps?: { subject: string; body: string; delay_days: number; variants: { subject: string; body: string }[] }[] };
type AgentKey = "onboarding" | "campaign" | "replies" | "manual";
type AIFile = { name: string; url: string };
type AIConfig = {
  globalMemory: string;
  formUrl: string;
  formId: string;
  formName: string;
  onboarding: string;
  campaign: string;
  replies: string;
  autoHandleRoutine: boolean;
  notifyEmail: string;
  files: { global: AIFile[]; onboarding: AIFile[]; campaign: AIFile[]; replies: AIFile[] };
};
type GForm = { id: string; name: string; url: string; modifiedTime: string | null };

const FLOW_KEY = "op_automation_flow_v2";
const CLIENTS_KEY = "op_automation_clients_v2";
const AI_KEY = "op_automation_ai_v2"; // v2: memoria oficial de OnePulso (asistente + generador de campañas)
const GOOGLE_KEY = "op_automation_google_v1";

// The connection status is written by the backend once OAuth completes. NEVER store the
// client secret here — the secret lives only in Supabase edge-function secrets.
type GoogleConn = { connected: boolean; account: string; connectedAt: string };
const DEFAULT_GOOGLE: GoogleConn = { connected: false, account: "", connectedAt: "" };

const DEFAULT_NODES: Node[] = [
  { id: "n1", label: "Datos del cliente", desc: "Nombre, correo, empresa y contexto. Su logo y colores ya vienen de su perfil.", agent: "manual" },
  { id: "n2", label: "Correo de arranque", desc: "Se le envía el enlace del Google Form + el enlace del onboarding (ve su campaña en tiempo real).", agent: "onboarding" },
  { id: "n3", label: "Cliente responde el Form", desc: "Contesta las preguntas que necesitamos para la campaña.", agent: "onboarding" },
  { id: "n4", label: "IA genera la campaña", desc: "Analiza el Form + tu contexto y crea la(s) campaña(s) en BORRADOR, sin leads, con todos los copys.", agent: "campaign" },
  { id: "n5", label: "Tu aprobación", desc: "Revisas y das Aceptar. Nada se envía hasta aquí.", agent: "manual" },
  { id: "n6", label: "Campaña activa", desc: "Empieza a enviar con el motor de siempre.", agent: "manual" },
  { id: "n7", label: "Atención al cliente (IA)", desc: "Lee el perfil de quien responde, cuenta interesados/preguntas y responde. Importante → borrador + te avisa.", agent: "replies" },
];

const DEFAULT_AI: AIConfig = {
  globalMemory: `Eres el asistente de OnePulso, agencia española de lead generation especializada en cold email B2B.

QUIÉNES SOMOS: no una agencia al uso, un partner comercial. Nos integramos en el equipo del cliente, con panel en tiempo real y timeline conjunto de objetivos.

CÓMO TRABAJAMOS (úsalo para explicar y defender el servicio):
- Entregabilidad primero: infraestructura y calentamiento de dominios cuidados para no caer en spam.
- Slow ramp: el volumen sube progresivamente, nunca de golpe.
- Volumen masivo pero controlado.
- Copys con IA: cada mensaje es único, reduce el riesgo de filtros de spam.
- Revisión y ajuste cada 48h.
- Estructura: 14 días de implementación + 3 meses de campaña. No es capricho: es el tiempo mínimo para calentar dominios, iterar copys y tener datos para optimizar.

TONO: cercano, humano, natural y directo. Como una persona del equipo, no un departamento. Frases cortas, sin corporativismo. En el idioma del cliente. Tutea salvo que el cliente marque distancia.

REGLAS INNEGOCIABLES:
- Nunca prometas resultados garantizados ni cifras concretas de leads/reuniones/facturación.
- Nunca inventes métricas, casos ni nombres de clientes. Si no está en el panel, dilo y escala.
- No pedimos reuniones proactivamente. Si el cliente la pide, se la das sin fricción: https://calendly.com/onepulso/30min
- Adapta marca (colores, logo, nombre) al perfil de cada cliente.
- Ante la duda o temas delicados (dinero, cancelación, queja seria, legal), NO improvises: déjalo en borrador y avisa a team@onepulso.online.`,
  formUrl: "https://forms.gle/QuZsPwTcwkmB6qoF7",
  formId: "",
  formName: "",
  onboarding: `Tu trabajo: arrancar la relación con un cliente nuevo y mantener las fases actualizadas EN SILENCIO (el cliente no recibe notificaciones de cambios internos de estado).

AL ARRANCAR, envía un correo de bienvenida que contenga:
1. El enlace del Google Form de briefing (preguntas para construir la campaña).
2. El enlace del panel de onboarding, explicando que ahí ve en tiempo real qué hacemos y el timeline conjunto de objetivos.
3. Qué pasa después y cuándo: 14 días de implementación, luego campaña activa.
El correo va al grano: bienvenida breve, los dos enlaces con una línea cada uno, y qué necesitamos ahora (rellenar el Form). Nada de mensajes largos de agradecimiento.

SEGUIMIENTO:
- Si no ha rellenado el Form a las 48h → recordatorio corto y amable. Segundo recordatorio a los 4 días. No insistas más: escala.
- Cuando el Form llegue completo → actualiza la fase y avisa al equipo. NO respondas al cliente con un análisis del briefing ni le hagas más preguntas por tu cuenta: eso lo revisa una persona.
- Si el briefing llega con huecos críticos (sector, cargo objetivo o servicio sin definir) → no lances nada: prepara en borrador las preguntas de aclaración y avisa.`,
  campaign: `Eres el generador de campañas de cold email de OnePulso. A partir de un nicho o empresa, devuelves una campaña COMPLETA lista para enviar, en la voz de Xavi.

VOZ: directo, personal, sin jerga corporate, como un colega senior que sabe lo que hace. Sin humo ni promesas vacías.
IDIOMA: español por defecto; si el público objetivo es de un país NO hispanohablante, escribe TODO en inglés (ni una palabra en otro idioma).
APERTURA: empieza SIEMPRE con un saludo personal "Hola {{firstName}}, soy [nombre]". Habla más de la EMPRESA ({{companyName}}) que de la industria — cosas generales pero que PAREZCAN muy personalizadas apoyándote en las variables. Ej: "Hola {{firstName}}, soy Xavi. Estuve mirando {{companyName}}…".
CTA: termina SIEMPRE con una llamada clara a agendar una reunión/llamada.

DOS MODOS:
- MODO A (OnePulso): promocionas los servicios de lead gen de OnePulso.
- MODO B (cliente): vendes SU producto, sin mencionar OnePulso ni lead gen; firma su comercial (o "El equipo de [empresa]").
- Detección: si se da una empresa/URL distinta a OnePulso → B; si no → A.

ESTRUCTURA DEL EMAIL (orden fijo): saludo → apertura (touch LinkedIn + selectividad) → propuesta directa → prueba social con número → gancho personalizado (algo concreto ya preparado: estudio/audit/IA/lista) → CTA → salida sin presión → firma.

FORMATO (no negociable):
- HTML: cada bloque en su propio <p>. NUNCA dos bloques en un mismo <p>.
- <strong> solo en 3-4 cosas: concepto core, número/resultado, lo que ofreces, tiempo del CTA. Nunca en "hola/gracias/saludos" ni sobre frases enteras.
- Frases ≤20 palabras. Bloques ≤3 líneas. Sin emojis. Sin "estimado", "saludos cordiales", "atte.", "espero que estés bien".
- LONGITUD: el email inicial entre 150 y 170 palabras; cada follow-up entre 125 y 135 palabras. Respeta estos rangos.
- Variables: {{firstName}} {{companyName}} {{industry}} {{city}}. ÚSALAS BASTANTE para que suene real: ≥3 de las 4 en cada variante, {{companyName}} siempre.
- Investigación REAL del nicho (números, casos). Cero copy genérico reutilizable entre nichos.

CADENCIA (haz solo los STEPS NECESARIOS, sin pasarte):
- Step 1 — delay 0 días: el email completo.
- Follow-ups: los que hagan falta, normalmente 2, MÁXIMO 3. Nunca más de 4 steps en total. Cada FU aporta algo NUEVO (no parafrasear el anterior).
- Intervalo entre follow-ups: 1-2 días (delays cortos, p.ej. 0 / 2 / 2 / 2).
- FU#1: bump suave subiendo el hilo. FU#2: caso real del nicho CON NÚMERO + pregunta de cualificación. FU#3 (solo si aporta): breakup educado invitando a retomar.

VARIANTES A/B/C: 3 por step, el mismo mensaje con distinto ángulo/apertura/fraseo del CTA. Nunca 3 clones ni menos de 3.

SUBJECTS:
- Step 1: con variable ({{companyName}} o {{firstName}}), 4-7 palabras, minúscula inicial, sin emojis ni exclamaciones, que despierte curiosidad. Ej: "idea para {{companyName}}", "{{firstName}}, una propuesta", "{{companyName}} → 10 min".
- Follow-ups: subject "" (vacío) para mantener el hilo (si la plataforma lo exige, bump con variable: "{{firstName}}, ¿lo viste?").

CRITERIOS: uno por cliente/campaña (nunca reutilices copys). Cortos, el objetivo es la conversación, no cerrar en el email. Sin palabras que disparen spam, sin mayúsculas gritadas, sin adjuntos ni imágenes, un solo enlace como mucho. Sin promesas numéricas insostenibles. En el idioma del prospecto.

SALIDA: devuelve SOLO el JSON de la campaña (name, mode, niche, goal, steps[] con step, delay_days y variants[] {label, subject, body_html}). Sin markdown ni explicaciones.

Nunca actives nada: solo generas el copy en BORRADOR. Si el ICP es demasiado amplio (>3 sectores o >1 servicio), no inventes: haz la interpretación más razonable, marca claramente las suposiciones y avisa para que una persona lo valide.`,
  replies: `Cuando responda un lead o escriba un cliente, lee primero su perfil (propuesta, tono, oferta contratada, estado de la campaña) y responde DESDE ese perfil.

PRIMERO CLASIFICA: Interesado / Pregunta / Objeción / No interesado / Queja / Petición de revisión de campaña.

QUÉ RESUELVES SOLO:
- Preguntas informativas y objeciones estándar sobre cómo trabajamos.
- Peticiones de reunión: pasa el Calendly (https://calendly.com/onepulso/30min) sin insistir ni forzar.
- Revisión de campaña / métricas: comprueba que el correo o dominio del que escribe cuadra con una cuenta existente; entra en el panel de esa campaña, coge los datos y explícale en lenguaje llano cómo va (envíos, aperturas, respuestas, reuniones y qué estamos ajustando). Si el email o dominio NO cuadra con ninguna cuenta, no des ningún dato: pide que escriba desde el correo de la cuenta.
- NUNCA pidas el email ni datos de identidad: ya sabes de qué cliente es (lo identificamos por su dominio). Trátalo por su empresa, con naturalidad.
- Cambios en la campaña (copy, asunto, ángulo, un mensaje…): sé DECISIVO. Si te da el texto, aplícalo; si no, redacta tú una buena versión coherente con lo que pide y aplícala — sin dar largas ni pedir mil confirmaciones. Dile "vale, lo aplico" y hazlo SIN esperar respuesta; cuando esté hecho, envíale un correo confirmando que "los cambios ya están aplicados y puedes verlos en tu campaña". Si el cambio NO es de copy (base de datos/leads, ampliar el alcance, algo delicado…), NO lo hagas por tu cuenta: avisa a team@onepulso.online.

QUÉ DEJAS SIEMPRE EN BORRADOR (redáctalo y avisa a team@onepulso.online): dinero, cancelaciones, quejas serias, cualquier mención legal, y cualquier caso donde no estés seguro.

QUEJAS Y DEVOLUCIONES: antes de hablar de dinero, propón solución de trabajo (ampliar leads, recrear la campaña con otro ángulo, o un mes adicional sin coste). Nuestra posición: si no llegamos a los mínimos acordados, seguimos trabajando sin coste hasta llegar — explícalo como compromiso, no como excusa. Nunca confirmes, niegues ni insinúes una devolución por tu cuenta: siempre a borrador, lo decide una persona.

TONO: humano y cercano, nunca defensivo. Si el cliente está molesto, reconoce el problema en la primera frase antes de explicar nada. Nada de plantillas de soporte.`,
  autoHandleRoutine: true,
  notifyEmail: "team@onepulso.online",
  files: { global: [], onboarding: [], campaign: [], replies: [] },
};

const AGENT_META: Record<AgentKey, { label: string; color: string }> = {
  onboarding: { label: "Onboarding", color: "bg-blue-500/10 text-blue-600" },
  campaign: { label: "Campaña", color: "bg-violet-500/10 text-violet-600" },
  replies: { label: "Atención", color: "bg-emerald-500/10 text-emerald-600" },
  manual: { label: "Tú", color: "bg-muted text-muted-foreground" },
};

const load = <T,>(key: string, fallback: T): T => {
  try { const r = localStorage.getItem(key); return r ? { ...(fallback as object), ...JSON.parse(r) } as T : fallback; } catch { return fallback; }
};
const loadArr = <T,>(key: string, fallback: T[]): T[] => {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) as T[] : fallback; } catch { return fallback; }
};
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } };
const uid = () => "x" + Math.random().toString(36).slice(2, 9);

// Calls the (already deployed) admin-users edge function with the owner's session — used
// to create the real client account + its onboarding profile straight from this flow.
async function callAdmin(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(payload),
  });
  return resp.json().catch(() => ({ error: "bad response" }));
}
const slugify = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const genPassword = () => Math.random().toString(36).slice(2, 10) + "Aa1!" + Math.random().toString(36).slice(2, 5);

// Maps the flow step to the 6 onboarding phases (kickoff, dominios, calentamiento, listas,
// copywriting, lanzamiento) so the client's onboarding fills in ON ITS OWN as the flow runs.
function onboardingStatusForFlow(step: number): ("pending" | "in_progress" | "done")[] {
  // Phases: 0 kickoff/estrategia · 1 dominios · 2 calentamiento · 3 listas · 4 copywriting · 5 lanzamiento
  const s: ("pending" | "in_progress" | "done")[] = ["pending", "pending", "pending", "pending", "pending", "pending"];
  if (step >= 1) s[0] = "in_progress";                                       // arranque → kickoff en curso
  if (step >= 3) { s[0] = "done"; s[1] = "done"; s[2] = "done"; s[3] = "in_progress"; } // form respondido → estrategia + dominios + calentamiento hechos, listas en curso
  if (step >= 4) { s[3] = "done"; s[4] = "in_progress"; }                    // IA genera → listas ok, copys en curso
  if (step >= 5) { s[4] = "done"; s[5] = "in_progress"; }                    // aprobado/activa → copys listos, lanzamiento
  if (step >= 6) { s[5] = "done"; }                                          // atención → lanzamiento hecho
  return s;
}

// The flow is editable, so we locate the key steps by their node (never a hard-coded index):
// the "Correo de arranque" node and the "Cliente responde el Form" node. Fall back to the
// default positions (1, 2) only if a matching node isn't found.
const emailNodeIdx = (ns: Node[]) => { const i = ns.findIndex((n) => /correo|arranque/i.test(n.label)); return i >= 0 ? i : 1; };
const formNodeIdx = (ns: Node[]) => { const i = ns.findIndex((n) => /responde/i.test(n.label) && /form/i.test(n.label)); return i >= 0 ? i : 2; };

// Language for the campaign: Spanish by default; English if the target market in the briefing
// is clearly a NON-Spanish-speaking country (and no Spanish-speaking market is mentioned).
const detectCampaignLanguage = (text: string): string => {
  const t = (text || "").toLowerCase();
  const es = /(espa[ñn]a|spain|m[ée]xico|argentina|colombia|chile|per[uú]|ecuador|uruguay|paraguay|bolivia|venezuela|guatemala|rep[uú]blica dominicana|latinoam|latam|hispano|castellano|espa[ñn]ol|habla\s*hispana)/;
  const en = /(estados\s*unidos|united\s*states|\busa\b|\bu\.s\.a?\b|\buk\b|reino\s*unido|inglaterra|england|londres|london|nueva\s*york|new\s*york|alemania|germany|francia|france|italia|italy|holanda|netherlands|b[ée]lgica|belgium|suecia|sweden|noruega|dinamarca|europa\b|internacional|global|english|ingl[ée]s|angloparlante|non[-\s]?spanish)/;
  if (en.test(t) && !es.test(t)) return "Inglés";
  return "Español";
};

// Steer passed to generate-campaign (short on purpose — the full memory broke its JSON).
const CAMPAIGN_SKILLS = "Empieza SIEMPRE con un saludo personal: 'Hola {{firstName}}, soy [nombre del que firma]'. Habla más de la EMPRESA del prospecto ({{companyName}}) que de la industria — cosas generales pero que PAREZCAN muy personalizadas, apoyándote en las variables {{firstName}} {{companyName}} {{industry}} {{city}} por todo el correo. LONGITUD: el email inicial entre 150 y 170 palabras; cada follow-up entre 125 y 135 palabras (respeta estos rangos). Voz cercana y directa, sin corporativismo. Termina SIEMPRE con un CTA claro para agendar una reunión/llamada. Follow-ups a 1-2 días, un solo enlace, sin promesas numéricas.";

// Sends the intro email from one of the owner's connected accounts (is_test:true → doesn't
// touch daily limits / the sent log). Same send-email fn the Onboarding page uses.
async function sendIntroEmail(accountId: string, to: string, subject: string, html: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ account_id: accountId, to_email: to, subject, body: html, is_test: true }),
  });
  return resp.json().catch(() => ({ error: "bad response" }));
}
const escHtml = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Loads + downscales a PNG to a data URL (for the copy PDF logo). Mirrors ClientPortal.
async function loadPngDataUrl(url: string, maxW = 340): Promise<{ dataUrl: string; ratio: number } | null> {
  try {
    const blob = await (await fetch(url)).blob();
    const src = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const ratio = img.naturalWidth / img.naturalHeight || 4;
    const w = Math.min(maxW, img.naturalWidth), h = Math.max(1, Math.round(w / ratio));
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { dataUrl: src, ratio };
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL("image/png"), ratio };
  } catch { return null; }
}

function introEmailHtml(opts: { name: string; company: string; formUrl: string; onboardingUrl: string; color: string; email?: string; password?: string; loginUrl?: string }) {
  const hi = opts.name ? `Hola ${escHtml(opts.name)}` : (opts.company ? `Hola ${escHtml(opts.company)}` : "Hola");
  const c = opts.color || "#6E58F1";
  const creds = (opts.email && opts.password) ? `<p style="margin:20px 0;padding:12px 14px;background:#f5f5fb;border-radius:10px;font-size:14px;line-height:1.7">
  <b>Tus accesos a la plataforma:</b><br/>
  Entrar: <a href="${escHtml(opts.loginUrl || "")}" style="color:${c}">${escHtml(opts.loginUrl || "")}</a><br/>
  Usuario: <b>${escHtml(opts.email!)}</b><br/>
  Contraseña: <b>${escHtml(opts.password!)}</b>
</p>` : "";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6">
  <p>${hi} 👋</p>
  <p>¡Encantados de empezar! Para preparar tu campaña necesitamos que respondas unas preguntas rápidas:</p>
  <p style="margin:20px 0"><a href="${escHtml(opts.formUrl)}" style="background:${c};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">Responder el formulario →</a></p>
  <p>Y aquí tienes tu <b>portal de seguimiento</b>, donde podrás ver el progreso de tu proyecto <b>en directo</b>:</p>
  <p style="margin:20px 0"><a href="${escHtml(opts.onboardingUrl)}" style="border:1px solid ${c};color:${c};text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">Ver mi proyecto en directo →</a></p>
  ${creds}
  <p>En cuanto respondas el formulario, nos ponemos con tu campaña. Cualquier duda, responde a este correo.</p>
  <p>Un saludo,<br/>El equipo de OnePulso</p>
</div>`;
}

export default function AutomationFlow() {
  const { user } = useAuth();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [clients, setClients] = useState<FlowClient[]>([]);
  const [ai, setAi] = useState<AIConfig>(DEFAULT_AI);
  const [google, setGoogle] = useState<GoogleConn>(DEFAULT_GOOGLE);
  const [editNode, setEditNode] = useState<Node | null>(null);
  const [newClient, setNewClient] = useState(false); // se abre solo al pulsar "Nuevo cliente", no al entrar
  const [aiOpen, setAiOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [reviewClient, setReviewClient] = useState<FlowClient | null>(null);

  const [forms, setForms] = useState<GForm[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [respMatch, setRespMatch] = useState<Record<string, string>>({});
  const [serviceActivity, setServiceActivity] = useState<any[]>([]);
  const [supportInbox, setSupportInbox] = useState<any[]>([]);
  const [expandedMsg, setExpandedMsg] = useState<Record<string, boolean>>({});
  const [agentRunning, setAgentRunning] = useState(false);
  const campaignStartedRef = useRef<Set<string>>(new Set());
  const SUPPORT_ACCOUNT = "7b97ced3-007b-44b4-846b-49dfb78d8454"; // support@onepulso.online mailbox

  const loadServiceActivity = async () => { try { const { data } = await supabase.rpc("my_service_activity" as never); setServiceActivity((data as any[]) || []); } catch { /* */ } };
  // Real Unibox of support@onepulso.online — the chatbot's mailbox. Reads inbox_messages
  // directly (owner RLS), newest first, full message. Refreshes every 2 min like the campaigns Unibox.
  const loadSupportInbox = async () => {
    try {
      const { data } = await (supabase as any)
        .from("inbox_messages")
        .select("id, from_email, from_name, subject, body_text, body_html, received_at, auto_replied")
        .eq("account_id", SUPPORT_ACCOUNT).eq("is_sent", false).eq("is_warmup", false)
        .order("received_at", { ascending: false }).limit(40);
      setSupportInbox((data as any[]) || []);
    } catch { /* */ }
  };
  // Latest agent action for a given sender (overlay on each inbox message).
  const actionFor = (fromEmail: string) => serviceActivity.find((a) => (a.from_email || "").toLowerCase() === (fromEmail || "").toLowerCase());
  const runAgent = async (dry: boolean) => {
    setAgentRunning(true);
    try {
      const { data } = await supabase.functions.invoke("client-service-agent", { body: { account_id: SUPPORT_ACCOUNT, dry_run: dry, limit: 10 } });
      toast.success(`Agente: ${(data as any)?.processed ?? 0} correo(s) ${dry ? "analizados (prueba)" : "procesados"}`);
      loadServiceActivity(); loadSupportInbox();
    } catch { toast.error("No se pudo ejecutar el agente"); }
    setAgentRunning(false);
  }; // flow clients whose campaign generation already started

  const loadResponses = async () => {
    try {
      const { data } = await (supabase as any)
        .from("form_responses")
        .select("id, form_id, form_title, respondent_email, answers, received_at")
        .order("received_at", { ascending: false })
        .limit(100);
      setResponses((data || []) as FormResponse[]);
    } catch { /* ignore */ }
  };

  const loadForms = async () => {
    setFormsLoading(true);
    try {
      let list: GForm[] = [];
      // Preferred: live list via the edge function (needs Google creds set).
      try {
        const { data } = await supabase.functions.invoke("google-forms-list");
        list = ((data as any)?.forms || []) as GForm[];
      } catch { /* ignore */ }
      // Fallback: the server-synced snapshot table.
      if (!list.length) {
        const { data } = await (supabase as any)
          .from("google_forms")
          .select("form_id, name, url, modified_time")
          .order("modified_time", { ascending: false });
        list = ((data || []) as any[]).map((f) => ({ id: f.form_id, name: f.name, url: f.url, modifiedTime: f.modified_time }));
      }
      setForms(list);
    } catch { setForms([]); } finally { setFormsLoading(false); }
  };

  const checkGoogle = async () => {
    try {
      const { data } = await supabase.rpc("my_google_connection" as never);
      const row = Array.isArray(data) ? (data[0] as any) : (data as any);
      if (row && row.connected) { setGoogle({ connected: true, account: row.email || "", connectedAt: row.connected_at || "" }); loadForms(); }
      else setGoogle(DEFAULT_GOOGLE);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    setNodes(loadArr(FLOW_KEY, DEFAULT_NODES));
    setClients(loadArr(CLIENTS_KEY, []));
    setAi(load(AI_KEY, DEFAULT_AI));
    checkGoogle();
    loadResponses();
    loadServiceActivity();
    loadSupportInbox();
    const onFocus = () => { checkGoogle(); loadResponses(); loadServiceActivity(); loadSupportInbox(); };
    window.addEventListener("focus", onFocus);
    // Auto-refresh like the campaigns Unibox: responses every min; the support@ inbox +
    // agent activity every 2 min (the fetch-inbox cron pulls new mail every minute).
    const iv = setInterval(() => loadResponses(), 60000);
    const iv2 = setInterval(() => { loadSupportInbox(); loadServiceActivity(); }, 30000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(iv); clearInterval(iv2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persistNodes = (n: Node[]) => { setNodes(n); save(FLOW_KEY, n); };
  const persistClients = (c: FlowClient[]) => { setClients(c); save(CLIENTS_KEY, c); };
  const updateFlowClient = (id: string, patch: Partial<FlowClient>) => setClients((prev) => { const next = prev.map((c) => c.id === id ? { ...c, ...patch } : c); save(CLIENTS_KEY, next); return next; });
  const persistAi = (a: AIConfig) => { setAi(a); save(AI_KEY, a); };

  // When a form response matches a client (email / domain / company), advance that client
  // to the step AFTER "responde el Form" so the flow continues on its own.
  useEffect(() => {
    if (!responses.length || !clients.length) return;
    const respondedStep = Math.min(formNodeIdx(nodes) + 1, nodes.length - 1); // node right after "responde Form"
    const map: Record<string, string> = {};
    let changed = false;
    const next = clients.map((c) => ({ ...c }));
    const toGenerate: { fc: FlowClient; resp: FormResponse }[] = [];
    for (const r of responses) {
      const idx = next.findIndex((c) => clientMatchesResponse(c, r));
      if (idx >= 0) {
        map[r.id] = next[idx].company || next[idx].name || next[idx].email;
        // Only a response that arrived AFTER the client entered the flow advances it. An old
        // response (same email/domain, from a previous test) must NEVER make a new client jump —
        // it stays "Esperando la respuesta del Form…" until a fresh answer comes in.
        const respTime = r.received_at ? new Date(r.received_at).getTime() : 0;
        const startTime = next[idx].startedAt ? new Date(next[idx].startedAt).getTime() : 0;
        const fresh = respTime > startTime;
        if (fresh && next[idx].step < respondedStep) {
          next[idx].step = respondedStep; changed = true; syncOnboarding(next[idx].clientId, respondedStep);
          if (next[idx].clientId && !campaignStartedRef.current.has(next[idx].id)) toGenerate.push({ fc: next[idx], resp: r });
        }
      }
    }
    setRespMatch(map);
    if (changed) persistClients(next);
    toGenerate.forEach(({ fc, resp }) => generateCampaignFor(fc, resp)); // genera la campaña de verdad (borrador)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responses, clients, nodes]);

  if (!user) return null;
  if ((user.email || "").toLowerCase() !== "hello@onepulso.blog") return <Navigate to="/dashboard" replace />;

  const addNode = () => { const n = [...nodes, { id: uid(), label: "Nuevo paso", desc: "Describe qué hace este paso", agent: "manual" as AgentKey }]; persistNodes(n); setEditNode(n[n.length - 1]); };
  const saveNode = (node: Node) => { persistNodes(nodes.map((n) => n.id === node.id ? node : n)); setEditNode(null); };
  const deleteNode = (id: string) => { persistNodes(nodes.filter((n) => n.id !== id)); setEditNode(null); };

  // Push the client's onboarding phases to match the flow step (fire-and-forget).
  const syncOnboarding = (clientId: string | undefined, step: number) => {
    if (!clientId) return;
    callAdmin({ action: "update_client", user_id: clientId, onboarding_status: onboardingStatusForFlow(step) }).catch(() => {});
  };
  const advance = (c: FlowClient) => {
    const ns = Math.min(c.step + 1, nodes.length - 1);
    const node = nodes[ns];
    const isActiveStep = !!node && /campa\w*\s+activ|activa/i.test(node.label);
    if (isActiveStep && c.clientId) {
      if (!confirm("¿La campaña ya tiene los leads cargados y está activa? Se le enviará al cliente un correo avisando de que su campaña ya está activa.")) return;
    }
    persistClients(clients.map((x) => x.id === c.id ? { ...x, step: ns } : x));
    syncOnboarding(c.clientId, ns);
    if (isActiveStep && c.clientId) sendCampaignActiveEmail(c);
  };
  const removeClient = (id: string) => persistClients(clients.filter((x) => x.id !== id));

  // When the Form is answered, GENERATE the campaign for real (deployed generate-campaign +
  // create_client_campaign) as a DRAFT in the client's account, then move to the approval step.
  const generateCampaignFor = async (fc: FlowClient, resp: FormResponse, test = false) => {
    if (!fc.clientId || campaignStartedRef.current.has(fc.id)) return;
    campaignStartedRef.current.add(fc.id);
    updateFlowClient(fc.id, { campaignStatus: "generating" });
    try {
      const briefing = Object.entries(resp.answers || {}).map(([k, v]) => `${k}: ${String(v)}`).join("\n")
        + (fc.context ? `\n\nContexto del dueño de cuenta: ${fc.context}` : "");
      const { data: { session } } = await supabase.auth.getSession();
      // Short, safe steer — passing the FULL campaign memory as skills made the AI output huge
      // and its JSON broke. The generate-campaign fn has its own robust prompt; this just nudges it.
      const campaignLang = detectCampaignLanguage(briefing);
      const shortSkills = CAMPAIGN_SKILLS;
      const genOnce = async (variants: number) => {
        const gen = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-campaign`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ briefing, website: "", company: fc.company || "", sender: "Xavi", language: campaignLang, tone: "cercano y directo", goal: "conseguir una reunión / llamada", num_steps: 3, num_variants: variants, skills: shortSkills }),
        });
        const gj = await gen.json();
        if (gj.error) throw new Error(gj.error);
        if (!Array.isArray(gj.steps) || gj.steps.length === 0) throw new Error("no se generó la secuencia");
        return gj.steps as any[];
      };
      // The AI's JSON occasionally breaks with many variants — retry twice, then fall back to 1.
      let rawSteps: any[] | null = null;
      for (const v of [3, 3, 1]) { try { rawSteps = await genOnce(v); break; } catch { /* siguiente intento */ } }
      if (!rawSteps) throw new Error("la IA no devolvió una secuencia válida tras varios intentos");
      const steps = rawSteps.map((s: any, i: number) => ({
        subject: (s.subject || "").trim(),
        body: s.body || "",
        delay_days: i === 0 ? 0 : 2, // 1-2 días entre follow-ups
        variants: Array.isArray(s.variants) ? s.variants.filter((v: any) => (v.subject || v.body)).map((v: any) => ({ subject: (v.subject || "").trim(), body: v.body || "" })) : [],
      }));
      const campaignName = `${test ? "PRUEBA · " : "Automatización · "}${fc.company || fc.name || fc.email}`;
      // TEST mode: NO crea la campaña en la cuenta del cliente — solo genera los copys para verlos.
      if (!test) {
        const res = await callAdmin({
          action: "create_client_campaign",
          client_user_id: fc.clientId,
          name: campaignName,
          options: { stop_on_reply: true, first_email_text_only: false, text_only_emails: false, break_thread_after: 0, include_unsubscribe: false },
          steps,
          leads: [], // sin leads cargados — se aprueba en borrador
        });
        if (res.error) throw new Error(res.error);
      }
      const approvalStep = Math.min(formNodeIdx(nodes) + 2, nodes.length - 1); // "Tu aprobación"
      updateFlowClient(fc.id, { campaignStatus: "done", campaignName, campaignSteps: steps, step: approvalStep });
      syncOnboarding(fc.clientId, approvalStep);
      toast.success(test ? "Simulación lista — copys generados (sin crear la campaña en la cuenta)" : `Campaña generada en borrador para ${fc.company || fc.email}`);
    } catch (e: any) {
      updateFlowClient(fc.id, { campaignStatus: "failed", campaignError: String(e?.message || e) });
      toast.error(`No se pudo generar la campaña: ${e?.message || e}`);
    }
  };
  const retryCampaign = (c: FlowClient) => {
    const resp = responses.find((r) => clientMatchesResponse(c, r));
    if (!resp) { toast.error("No hay respuesta del Form para regenerar"); return; }
    campaignStartedRef.current.delete(c.id);
    generateCampaignFor(c, resp);
  };

  // On approval: build the copys as a nice PDF (OnePulso logo) and email the client the link
  // for sign-off — same proven mechanism as the Portal's "Enviar copys".
  const sendCopysToClient = async (fc: FlowClient) => {
    if (!fc.email) return;
    const steps = fc.campaignSteps || [];
    if (!steps.length) { toast.error("No hay copys para enviar"); return; }
    try {
      const [{ default: jsPDF }, { buildCopyDoc }, logo] = await Promise.all([
        import("jspdf"), import("@/lib/report/buildCopyPdf"), loadPngDataUrl("/onepulso-logo-white-transparent.png"),
      ]);
      // Build the PDF from the generated copys in memory — works for a real campaign AND for a
      // TEST run (no real campaign in the client's account).
      const campaigns = [{
        name: fc.campaignName || `Campaña · ${fc.company || fc.email}`,
        status: "draft",
        steps: steps.map((s, i) => ({ step_order: i, subject: s.subject, body: s.body, variants: s.variants, delay_days: s.delay_days })),
      }];
      const doc = buildCopyDoc(jsPDF, {
        clientName: fc.company || fc.name || fc.email,
        generatedAtLabel: new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }),
        campaigns, sampleLead: null,
        agencyLogoDataUrl: logo?.dataUrl || null, agencyLogoRatio: logo?.ratio || null,
      });
      const uri: string = doc.output("datauristring");
      const b64 = uri.substring(uri.indexOf("base64,") + 7);
      const { data: { session } } = await supabase.auth.getSession();
      const up = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-report`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ mode: "upload_copys", pdf_base64: b64 }) });
      const ur = await up.json();
      if (!ur.ok || !ur.link) throw new Error(ur.error || "no se pudo generar el enlace del PDF");
      const { data: accs } = await (supabase as any).from("email_accounts").select("id, email").not("smtp_host", "is", null);
      const fromAcc = ((accs || []) as any[]).find((a) => /team@onepulso/i.test(a.email))?.id || (accs || [])[0]?.id;
      if (!fromAcc) throw new Error("no hay cuenta de envío");
      const message = `Hola ${fc.name || fc.company || ""},\n\nAquí tienes los mensajes de tu campaña para que les des un vistazo:\n${ur.link}\n\nSi está todo bien, solo faltaría añadir los leads y activar la campaña. Si quieres retocar algo, dínoslo por aquí y lo ajustamos.\n\nUn saludo,\nEl equipo de OnePulso`;
      const send = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-report`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ mode: "send_copys", to: fc.email, from_account_id: fromAcc, subject: "Los mensajes de tu campaña — dales el visto bueno", message }) });
      const sr = await send.json();
      if (!sr.ok) throw new Error(sr.error || "no se pudo enviar");
      toast.success(`Copys enviados a ${fc.email} para su visto bueno`);
    } catch (e: any) { toast.error(`No se pudieron enviar los copys: ${e?.message || e}`); }
  };
  const approveClient = (fc: FlowClient) => { advance(fc); sendCopysToClient(fc); };

  // When the campaign is live WITH leads, tell the client it's active (with the live-tracking link).
  const sendCampaignActiveEmail = async (fc: FlowClient) => {
    if (!fc.clientId || !fc.email) return;
    try {
      const { data: prof } = await (supabase as any).from("profiles").select("onboarding_from_account_id").eq("user_id", user.id).maybeSingle();
      let fromAcc: string | null = prof?.onboarding_from_account_id || null;
      if (!fromAcc) { const { data: acc } = await (supabase as any).from("email_accounts").select("id").eq("user_id", user.id).eq("status", "connected").limit(1).maybeSingle(); fromAcc = acc?.id || null; }
      if (!fromAcc) { toast.error("Sin cuenta de envío para el aviso"); return; }
      const col = fc.brandColor || "#6E58F1";
      const hi = fc.name ? `Hola ${fc.name}` : (fc.company ? `Hola ${fc.company}` : "Hola");
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6"><p>${hi} 🚀</p><p>¡Buenas noticias! Tu <b>campaña ya está activa</b> y hemos empezado a enviar los mensajes a tus leads.</p>${fc.onboardingSlug ? `<p>Puedes seguir el progreso en tiempo real aquí:</p><p style="margin:16px 0"><a href="${window.location.origin}/o/${fc.onboardingSlug}" style="background:${col};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">Ver mi campaña en directo →</a></p>` : ""}<p>Cualquier cosa, aquí estamos.</p><p>Un saludo,<br/>El equipo de OnePulso</p></div>`;
      const r = await sendIntroEmail(fromAcc, fc.email, "Tu campaña ya está activa 🚀", html);
      if (r?.success) toast.success(`Aviso de campaña activa enviado a ${fc.email}`);
      else toast.error(`No se pudo enviar el aviso: ${r?.error || ""}`);
    } catch (e: any) { toast.error(String(e?.message || e)); }
  };

  // TEST: simulate a Form answer for a client so you can run the generation step without
  // filling the real Google Form. Uses the client's company + context as the briefing.
  const simulateForm = (c: FlowClient) => {
    if (!c.clientId) { toast.error("Este cliente no tiene cuenta creada (créalo desde 'Nuevo cliente')"); return; }
    const testResp: FormResponse = {
      id: "test-" + uid(), form_id: "test", form_title: "Prueba",
      respondent_email: c.email,
      answers: { "Empresa": c.company || c.name || "", "Contexto para la campaña": c.context || "Campaña de prueba para ver el proceso" },
      received_at: new Date().toISOString(),
    };
    const respondedStep = Math.min(formNodeIdx(nodes) + 1, nodes.length - 1);
    campaignStartedRef.current.delete(c.id);
    updateFlowClient(c.id, { step: respondedStep, campaignStatus: undefined, campaignError: undefined });
    syncOnboarding(c.clientId, respondedStep);
    toast.info("Simulando respuesta del Form… (no se crea la campaña)");
    generateCampaignFor({ ...c, step: respondedStep }, testResp, true); // test = no crea la campaña real
  };

  // The client whose run is being visualised on the flow (defaults to the most recent).
  const activeClient = clients.find((c) => c.id === activeClientId) || clients[0] || null;
  const activeStep = activeClient ? activeClient.step : -1;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Workflow className="h-5 w-5" /></span>
          <div>
            <h1 className="font-display text-2xl font-bold">Automatización</h1>
            <p className="text-sm text-muted-foreground">Onboarding y atención al cliente automáticos · editable · agentes de IA.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setChatOpen(true)}><MessageSquare className="h-4 w-4" /> Probar chat</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAiOpen(true)}><Brain className="h-4 w-4" /> Cómo actúa la IA</Button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" /> DeepSeek
          </span>
        </div>
      </div>

      {/* ── Google Forms connection status ── */}
      <Card className={google.connected ? "border-emerald-500/40" : ""}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${google.connected ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
              <Link2 className="h-5 w-5" />
            </span>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                Conexión con Google Forms
                {google.connected
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Conectado</span>
                  : <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> No conectado</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {google.connected
                  ? `Cuenta: ${google.account || "—"}. La IA ya puede leer las respuestas del Form.`
                  : "Aún no conectado. Se activará cuando cableemos el backend (OAuth). Te avisaré en cuanto quede conectado."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { checkGoogle(); toast.info("Estado actualizado"); }}>
              <RefreshCw className="h-4 w-4" /> Actualizar
            </Button>
            {!google.connected && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                if (!user?.id) return;
                window.open(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-oauth?owner=${user.id}`, "_blank");
                toast.info("Autoriza en la pestaña de Google. Al volver, pulsa Actualizar.");
              }}>
                <Link2 className="h-4 w-4" /> Conectar con Google
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Your Google Forms (only when connected) ── */}
      {google.connected && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Tus Google Forms
              {ai.formId && <span className="ml-1 text-xs font-normal text-emerald-600">· elegido: {ai.formName}</span>}
            </CardTitle>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { loadForms(); loadResponses(); }} disabled={formsLoading}>
              <RefreshCw className={`h-4 w-4 ${formsLoading ? "animate-spin" : ""}`} /> Actualizar
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {formsLoading ? (
              <p className="text-sm text-muted-foreground">Cargando tus formularios…</p>
            ) : forms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No aparecen formularios aún. Si acabas de conectar, pulsa <b className="text-foreground">Actualizar</b>. Se listan los Google Forms de la cuenta conectada.</p>
            ) : (
              <div className="space-y-1.5">
                {forms.map((f) => {
                  const sel = ai.formId === f.id;
                  return (
                    <button key={f.id} onClick={() => { const a = { ...ai, formId: f.id, formName: f.name, formUrl: f.url }; persistAi(a); loadResponses(); toast.success(`Formulario elegido: ${f.name}`); }}
                      className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition ${sel ? "border-emerald-500/50 bg-emerald-500/5" : "border-border hover:border-primary/40 hover:bg-muted/40"}`}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{f.name}</p>
                        <a href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-muted-foreground hover:underline">Abrir en Google ↗</a>
                      </div>
                      {sel ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <span className="shrink-0 text-xs text-muted-foreground">Elegir</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Responses for the selected form — only the respondent (email); the system reads the answers. */}
            {ai.formId && (() => {
              const mine = responses.filter((r) => r.form_id === ai.formId);
              return (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <p className="text-xs font-semibold text-muted-foreground">Respuestas de "{ai.formName}" · {mine.length}</p>
                  {mine.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                      Aún no hay respuestas de este formulario.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {mine.map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm">{r.respondent_email || "sin correo"}</span>
                          </span>
                          {respMatch[r.id]
                            ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {respMatch[r.id]}</span>
                            : <span className="shrink-0 text-xs text-muted-foreground/70">{r.received_at ? new Date(r.received_at).toLocaleDateString() : ""}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* ── Customer-service agent ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-primary" /> Agente de atención al cliente
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Activo</span>
          </CardTitle>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { loadSupportInbox(); loadServiceActivity(); }}><RefreshCw className="h-4 w-4" /> Actualizar</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            El chatbot vive SOLO en <b className="text-foreground">support@onepulso.online</b>. Lee cada correo, cuadra al cliente por su <b className="text-foreground">cuenta o dominio</b>, responde y aplica cambios de copy automáticamente, e ignora el ruido. Solo avisa a <b className="text-foreground">team@onepulso.online</b> lo <b className="text-foreground">esencial</b> (reuniones, devoluciones, dinero, cancelaciones, legal). Corre cada 3 min y responde a los <b className="text-foreground">~5 min</b> (humano).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => runAgent(false)} disabled={agentRunning}>{agentRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />} Ejecutar ahora</Button>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => runAgent(true)} disabled={agentRunning}>Ver qué haría (prueba)</Button>
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Mail className="h-3.5 w-3.5" /> Bandeja de support@onepulso.online
              {serviceActivity.some((a) => a.action === "error") && <span className="text-destructive">· hay errores</span>}
              <span className="ml-auto font-normal">sync cada minuto · se refresca solo</span>
            </p>
            {supportInbox.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Aún no hay correos en support@. Cuando alguien escriba, el mensaje completo aparecerá aquí y el bot actuará solo.</p>
            ) : (
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {supportInbox.map((m) => {
                  const act = actionFor(m.from_email);
                  const bodyFull = cleanInbound(m.body_text || m.body_html);
                  const isOpen = !!expandedMsg[m.id];
                  const long = bodyFull.length > 240;
                  return (
                    <div key={m.id} className="rounded-lg border border-border p-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{m.from_name ? `${m.from_name} · ` : ""}{m.from_email}</p>
                          <p className="truncate text-muted-foreground">{m.subject || "(sin asunto)"}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-[10px] text-muted-foreground">{m.received_at ? new Date(m.received_at).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                          {act
                            ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ACTION_STYLE(act.action)}`}>{ACTION_LABEL[act.action] || act.action}</span>
                            : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{m.auto_replied ? "Procesado" : "En cola"}</span>}
                        </div>
                      </div>
                      {bodyFull && (
                        <div className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-foreground/90">
                          {isOpen || !long ? bodyFull : bodyFull.slice(0, 240) + "…"}
                          {long && <button className="ml-1 font-medium text-primary" onClick={() => setExpandedMsg((p) => ({ ...p, [m.id]: !isOpen }))}>{isOpen ? "Ver menos" : "Ver más"}</button>}
                        </div>
                      )}
                      {act?.reply && act.action !== "error" && <p className="mt-1.5 break-words text-muted-foreground"><b className="text-foreground">Respuesta del bot:</b> {act.reply.slice(0, 280)}</p>}
                      {act?.action === "error" && <p className="mt-1.5 break-words text-destructive"><b>Error:</b> {(act.reply || "").slice(0, 200)} · se reintenta solo en la próxima pasada.</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Editable flow ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">El flujo <span className="ml-1 text-xs font-normal text-muted-foreground">· clic en un paso para editarlo</span></CardTitle>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={addNode}><Plus className="h-4 w-4" /> Añadir paso</Button>
        </CardHeader>
        <CardContent>
          {/* Which client's run we're watching — the flow lights up for this one, like N8N */}
          {clients.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Viendo:</span>
              {clients.map((c) => (
                <button key={c.id} onClick={() => setActiveClientId(c.id)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${activeClient?.id === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"}`}>
                  {c.company || c.name || c.email}
                </button>
              ))}
            </div>
          )}
          <div className="overflow-x-auto pb-2">
            <div className="flex w-max items-stretch gap-1">
              {nodes.map((s, i) => {
                const state = !activeClient ? "idle" : i < activeStep ? "done" : i === activeStep ? "current" : "pending";
                const waitForm = /responde/i.test(s.label) && /form/i.test(s.label);
                // "Atención al cliente" is an ONGOING state, not a task in progress — show it as
                // active/green (not a spinner) once the client is on it.
                const isReplies = s.agent === "replies" || i === nodes.length - 1;
                const activeReplies = state === "current" && isReplies;
                const doneLike = state === "done" || activeReplies;
                return (
                  <div key={s.id} className="flex items-stretch gap-1">
                    <button
                      onClick={() => setEditNode(s)}
                      className={`group flex w-48 flex-col rounded-xl border p-3 text-left transition-all ${
                        doneLike ? "border-emerald-500/50 bg-emerald-500/10"
                        : state === "current" ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                        : state === "pending" ? "border-border bg-muted/20 opacity-60"
                        : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5"}`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${AGENT_META[s.agent].color}`}>{AGENT_META[s.agent].label}</span>
                        {doneLike ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          : state === "current" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          : <Pencil className="h-3 w-3 text-muted-foreground/0 transition-colors group-hover:text-primary" />}
                      </div>
                      <p className="text-sm font-semibold">{i + 1}. {s.label}</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {activeReplies ? "Activa · la IA responde a los leads"
                          : state === "current"
                          ? (waitForm ? "Esperando la respuesta del Form…"
                            : (/correo|arranque/i.test(s.label) && activeClient?.emailStatus === "sending") ? "Enviando el correo…"
                            : (/correo|arranque/i.test(s.label) && activeClient?.emailStatus === "failed") ? "⚠ No se pudo enviar el correo"
                            : (/genera|campa/i.test(s.label) && activeClient?.campaignStatus === "generating") ? "Generando la campaña con IA…"
                            : (/genera|campa/i.test(s.label) && activeClient?.campaignStatus === "failed") ? "⚠ No se pudo generar la campaña"
                            : "En curso…")
                          : s.desc}
                      </p>
                    </button>
                    {i < nodes.length - 1 && <div className={`flex items-center px-0.5 ${activeClient && i < activeStep ? "text-emerald-500" : "text-muted-foreground/30"}`}><ArrowRight className="h-4 w-4" /></div>}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Clients in flow ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Clientes en el flujo</CardTitle>
          <Button size="sm" className="gap-1.5" onClick={() => setNewClient(true)}><UserPlus className="h-4 w-4" /> Nuevo cliente</Button>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Mete los datos de un cliente con <b className="text-foreground">"Nuevo cliente"</b> y arranca su flujo. Aquí lo verás avanzar por cada paso en tiempo real.
            </div>
          ) : (
            <div className="space-y-2">
              {clients.map((c) => {
                const node = nodes[c.step] || nodes[0];
                const pct = Math.round(((c.step + 1) / nodes.length) * 100);
                const isFinal = c.step >= nodes.length - 1;
                const waitingForm = /responde/i.test(node?.label || "") && /form/i.test(node?.label || "");
                const isApproval = /aprobaci|aprobar|revis/i.test(node?.label || "");
                return (
                  <div key={c.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{c.company || c.name || c.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.email}{c.context ? ` · ${c.context}` : ""}</p>
                        {c.onboardingSlug && <a href={`/o/${c.onboardingSlug}`} target="_blank" rel="noreferrer" className="block text-xs text-primary hover:underline">Onboarding: /o/{c.onboardingSlug} ↗</a>}
                        {c.emailStatus === "sending" && <p className="flex items-center gap-1 text-xs text-primary"><Loader2 className="h-3 w-3 animate-spin" /> Enviando el correo…</p>}
                        {c.emailStatus === "sent" && <p className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Correo enviado desde {c.emailFrom || "la cuenta de envío"}</p>}
                        {c.emailStatus === "failed" && <p className="text-xs text-destructive">⚠ Correo no enviado{c.emailError ? `: ${c.emailError}` : ""}</p>}
                        {c.campaignStatus === "generating" && <p className="flex items-center gap-1 text-xs text-primary"><Loader2 className="h-3 w-3 animate-spin" /> Generando la campaña con IA…</p>}
                        {c.campaignStatus === "done" && <p className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Campaña en borrador creada</p>}
                        {c.campaignStatus === "failed" && <p className="text-xs text-destructive">⚠ Campaña no generada{c.campaignError ? `: ${c.campaignError}` : ""} <button type="button" onClick={() => retryCampaign(c)} className="underline hover:text-foreground">Reintentar</button></p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${AGENT_META[node?.agent || "manual"].color}`}>
                          {!isFinal && <Loader2 className="h-3 w-3 animate-spin" />}
                          {c.step + 1}. {node?.label}
                        </span>
                        {isApproval
                          ? <Button size="sm" className="h-8 gap-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setReviewClient(c)}><CheckCircle2 className="h-3.5 w-3.5" /> Revisar y aprobar</Button>
                          : <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => advance(c)} disabled={isFinal}><ChevronRight className="h-3.5 w-3.5" /> Siguiente</Button>}
                        {c.campaignStatus === "done" && <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setReviewClient(c)}><FileText className="h-3.5 w-3.5" /> Ver mensajes</Button>}
                        {c.clientId && <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => simulateForm(c)} title="Probar: simula la respuesta del Form y genera la campaña"><RefreshCw className="h-3.5 w-3.5" /> Probar Form</Button>}
                        <Button size="sm" variant="ghost" className="h-8 text-destructive hover:text-destructive" onClick={() => removeClient(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                    {/* Real-time status line — the "ruedecita" while it waits/works on this step */}
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {waitingForm
                        ? <><Loader2 className="h-3 w-3 animate-spin text-primary" /> Esperando la respuesta del Form…</>
                        : isFinal
                          ? <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Atención al cliente activa</>
                          : <><Loader2 className="h-3 w-3 animate-spin text-primary" /> {node?.desc}</>}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p>
          <b className="text-foreground">Aislado y seguro:</b> no toca el motor de envío. La IA crea campañas <b className="text-foreground">en borrador</b> (nunca las activa), lo importante se escala a ti como borrador + aviso, y nada envía correos en masa. Por ahora el flujo y la memoria se guardan en tu navegador; cuando restauremos el deploy, se conecta al backend para persistir y ejecutarse solo.
        </p>
      </div>

      {/* Edit node dialog */}
      <Dialog open={!!editNode} onOpenChange={(o) => !o && setEditNode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display flex items-center gap-2"><GripVertical className="h-4 w-4 text-muted-foreground" /> Editar paso</DialogTitle></DialogHeader>
          {editNode && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label className="text-xs">Nombre del paso</Label><Input value={editNode.label} onChange={(e) => setEditNode({ ...editNode, label: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Qué hace</Label>
                <textarea value={editNode.desc} onChange={(e) => setEditNode({ ...editNode, desc: e.target.value })} rows={3} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Agente responsable</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(AGENT_META) as AgentKey[]).map((k) => (
                    <button key={k} onClick={() => setEditNode({ ...editNode, agent: k })}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${editNode.agent === k ? "ring-2 ring-primary " + AGENT_META[k].color : AGENT_META[k].color + " opacity-70"}`}>
                      {AGENT_META[k].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="justify-between gap-2 sm:justify-between">
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => editNode && deleteNode(editNode.id)}><Trash2 className="mr-1.5 h-4 w-4" /> Eliminar</Button>
            <Button onClick={() => editNode && saveNode(editNode)}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New client dialog — creates the REAL client account + its onboarding profile */}
      <NewClientDialog
        open={newClient}
        onClose={() => setNewClient(false)}
        onCreate={async (data) => {
          // 1) Create the real client account (login + branding).
          const password = data.password?.trim() || genPassword();
          const cr = await callAdmin({
            action: "create_user",
            email: data.email.toLowerCase(),
            password,
            company_name: data.company || null,
            brand_color: data.brandColor || null,
            logo_url: data.logoUrl || null,
            allowed_routes: ["/dashboard", "/campaigns", "/unibox", "/stats"],
          });
          if (cr.error || !cr.user_id) { toast.error(cr.error || "No se pudo crear el cliente"); return false; }
          // 2) Auto-create its onboarding profile (a stable /o/:slug portal + 6 phases).
          const base = slugify(data.company || data.name || data.email.split("@")[0]) || "cliente";
          const slug = `${base}-${Math.random().toString(36).slice(2, 5)}`;
          await callAdmin({ action: "update_client", user_id: cr.user_id, onboarding_slug: slug });
          // 3) Add to the flow at the "Correo de arranque" step, marked as SENDING (the node
          //    stays loading until the email is REALLY sent — no jumping ahead).
          const flowId = uid();
          const emailStep = emailNodeIdx(nodes);
          persistClients([{ id: flowId, step: emailStep, startedAt: new Date().toISOString(), clientId: cr.user_id, onboardingSlug: slug, emailStatus: "sending", ...data }, ...clients]);
          setNewClient(false);
          toast.success(`Cliente creado con onboarding: /o/${slug}`);
          // 4) Send the intro email IN THE BACKGROUND, then reflect the REAL result on the flow.
          (async () => {
            try {
              const onboardingUrl = `${window.location.origin}/o/${slug}`;
              const formUrl = ai.formUrl || "https://forms.gle/QuZsPwTcwkmB6qoF7";
              const { data: prof } = await (supabase as any).from("profiles").select("onboarding_from_account_id").eq("user_id", user.id).maybeSingle();
              let fromAcc: string | null = prof?.onboarding_from_account_id || null;
              let fromEmail = "";
              if (fromAcc) {
                const { data: a } = await (supabase as any).from("email_accounts").select("email").eq("id", fromAcc).maybeSingle();
                fromEmail = a?.email || "";
              } else {
                const { data: acc } = await (supabase as any).from("email_accounts").select("id, email").eq("user_id", user.id).eq("status", "connected").limit(1).maybeSingle();
                fromAcc = acc?.id || null; fromEmail = acc?.email || "";
              }
              if (!fromAcc) {
                updateFlowClient(flowId, { emailStatus: "failed", emailError: "sin cuenta de envío" });
                toast.error("Cliente creado, pero no hay cuenta de envío (Onboarding → Avisos al cliente).");
                return;
              }
              const html = introEmailHtml({ name: data.name, company: data.company, formUrl, onboardingUrl, color: data.brandColor, email: data.email.toLowerCase(), password, loginUrl: `${window.location.origin}/auth` });
              const r = await sendIntroEmail(fromAcc, data.email, "Empezamos con tu campaña 🚀", html);
              if (r?.success) {
                const formStep = formNodeIdx(nodes);
                updateFlowClient(flowId, { emailStatus: "sent", emailFrom: fromEmail, step: formStep });
                syncOnboarding(cr.user_id, formStep);
                toast.success(`Correo enviado desde ${fromEmail}`);
              } else {
                updateFlowClient(flowId, { emailStatus: "failed", emailError: r?.error || "error de envío" });
                toast.error(`No se pudo enviar el correo: ${r?.error || "error"}`);
              }
            } catch (e) {
              updateFlowClient(flowId, { emailStatus: "failed", emailError: String(e) });
            }
          })();
          return true;
        }}
      />

      {/* AI brain / memory dialog */}
      <AIConfigDialog open={aiOpen} onClose={() => setAiOpen(false)} value={ai} onSave={(a) => { persistAi(a); setAiOpen(false); toast.success("Memoria de la IA guardada"); }} />

      {/* Review the generated copys before approving */}
      <ReviewDialog client={reviewClient} onClose={() => setReviewClient(null)} onApprove={() => { if (reviewClient) approveClient(reviewClient); setReviewClient(null); }} />

      {/* Test a conversation with the customer-service agent */}
      <ChatTestDialog open={chatOpen} onClose={() => setChatOpen(false)} prompt={ai.replies} />
    </div>
  );
}

function NewClientDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (d: { name: string; email: string; company: string; context: string; brandColor: string; logoUrl: string; password: string }) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [context, setContext] = useState("");
  const [password, setPassword] = useState("");
  const [brandColor, setBrandColor] = useState("#6E58F1");
  const [logoUrl, setLogoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setName(""); setEmail(""); setCompany(""); setContext(""); setPassword(""); setBrandColor("#6E58F1"); setLogoUrl(""); setUploading(false); setCreating(false); } }, [open]);

  const uploadLogo = async (file: File) => {
    if (file.size > 3 * 1024 * 1024) { toast.error("El logo debe pesar menos de 3 MB"); return; }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `client-logos/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { error } = await supabase.storage.from("godtube-media").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      setLogoUrl(supabase.storage.from("godtube-media").getPublicUrl(path).data.publicUrl);
      const color = await extractLogoColor(file);   // auto brand color from the logo
      if (color) setBrandColor(color);
      toast.success("Logo subido");
    } catch (e: any) { toast.error(e?.message || "Error al subir el logo"); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    if (!email.trim()) { toast.error("El correo es obligatorio"); return; }
    if (password.trim() && password.trim().length < 6) { toast.error("La contraseña debe tener al menos 6 caracteres"); return; }
    setCreating(true);
    await onCreate({ name: name.trim(), email: email.trim(), company: company.trim(), context: context.trim(), brandColor, logoUrl, password: password.trim() });
    setCreating(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !creating && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><UserPlus className="h-5 w-5" /></div>
          <DialogTitle className="text-center font-display text-xl">Crear cliente y arrancar</DialogTitle>
          <p className="text-center text-sm text-muted-foreground">Se crea la cuenta + su <b>onboarding</b>, y se le <b>envía el correo</b> con el formulario y el enlace de seguimiento en directo.</p>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5"><Label className="text-xs">Nombre</Label><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del contacto" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Correo *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@empresa.com" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Empresa</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nombre de la empresa" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Contraseña <span className="text-muted-foreground">(opcional; vacía = se genera sola)</span></Label><Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña de acceso del cliente" /></div>
          <div className="space-y-1.5">
            <Label className="text-xs">Logo</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40">
                {logoUrl ? <img src={logoUrl} alt="logo" className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Subiendo…</> : <><ImagePlus className="h-4 w-4" /> {logoUrl ? "Cambiar logo" : "Subir logo"}</>}
              </Button>
              {logoUrl && <button type="button" onClick={() => setLogoUrl("")} className="text-xs text-muted-foreground hover:text-destructive">Quitar</button>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Color de marca <span className="text-muted-foreground">(auto del logo)</span></Label>
            <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-8 w-14 cursor-pointer rounded border border-border bg-background" />
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Contexto para la IA <span className="text-muted-foreground">(opcional)</span></Label>
            <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={2} placeholder="Sector, oferta, tono, a quién quiere llegar…" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={onClose} disabled={creating}>Ahora no</Button>
          <Button onClick={submit} size="lg" className="gap-1.5" disabled={creating}>
            {creating ? <><Loader2 className="h-4 w-4 animate-spin" /> Creando…</> : <><ArrowRight className="h-4 w-4" /> Crear y arrancar</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Chat to TEST a conversation with the customer-service agent (no email/campaign effects).
function ChatTestDialog({ open, onClose, prompt }: { open: boolean; onClose: () => void; prompt: string }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [company, setCompany] = useState("");
  const [typing, setTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setMessages([]); setInput(""); setTyping(false); } }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);
  const send = async () => {
    const text = input.trim();
    if (!text || typing) return;
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next); setInput(""); setTyping(true);
    try {
      const { data } = await supabase.functions.invoke("client-service-agent", { body: { action: "chat", company, message: text, history: messages, prompt } });
      await new Promise((r) => setTimeout(r, 1200)); // pequeño retardo humano
      setMessages([...next, { role: "assistant" as const, text: (data as any)?.reply || "…" }]);
    } catch { setMessages([...next, { role: "assistant" as const, text: "(no se pudo responder)" }]); }
    setTyping(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" /> Probar conversación</DialogTitle>
          <p className="text-sm text-muted-foreground">Habla con el agente como si fueras el cliente. (El agente real de correos responde a los ~5 min, más humano.)</p>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-xs">Empresa del cliente</Label>
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="ej. iqcode" className="h-8 text-sm" />
        </div>
        <div className="min-h-[240px] flex-1 space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
          {messages.length === 0 && <p className="text-center text-xs text-muted-foreground">Escribe un mensaje para empezar…</p>}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-background"}`}>{m.text}</div>
            </div>
          ))}
          {typing && <div className="flex justify-start"><div className="rounded-2xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground"><Loader2 className="inline h-3 w-3 animate-spin" /> escribiendo…</div></div>}
          <div ref={endRef} />
        </div>
        <div className="flex items-center gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Escribe como el cliente…" disabled={typing} />
          <Button onClick={send} disabled={typing || !input.trim()} className="gap-1.5"><ArrowRight className="h-4 w-4" /></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Review popup: shows the emails the AI generated (with A/B/C variants) before approving.
function ReviewDialog({ client, onClose, onApprove }: { client: FlowClient | null; onClose: () => void; onApprove: () => void }) {
  const steps = client?.campaignSteps || [];
  return (
    <Dialog open={!!client} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Revisar campaña · {client?.company || client?.name || client?.email}</DialogTitle>
          <p className="text-sm text-muted-foreground">Estos son los correos que ha creado la IA. Revísalos y aprueba.</p>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">Notas a tener en cuenta</p>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>Empieza siempre con <b className="text-foreground">{"Hola {{firstName}}, soy [persona]"}</b>.</li>
              <li>Habla más de la <b className="text-foreground">empresa ({"{{companyName}}"})</b> que de la industria — general, pero que parezca muy personalizado con las variables.</li>
              <li>Usa bastante las variables en todo el correo para que suene a medida.</li>
              <li>Termina con un <b className="text-foreground">CTA claro para agendar una reunión</b>.</li>
            </ul>
          </div>
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay copys guardados para mostrar aquí. Puedes verlos en la cuenta del cliente → Campañas.</p>
          ) : steps.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Email {i + 1}{i === 0 ? " · inicial" : ` · +${s.delay_days} día(s)`}</p>
              <p className="text-sm font-semibold">Asunto: {s.subject || "(vacío — sigue el hilo)"}</p>
              <div className="mt-1 rounded bg-muted/40 p-2 text-sm [&_p]:my-1" dangerouslySetInnerHTML={{ __html: s.body || "" }} />
              {(s.variants || []).length > 0 && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Variantes</p>
                  {s.variants.map((v, vi) => (
                    <div key={vi} className="rounded border border-border/60 p-2">
                      <p className="text-xs font-medium">Variante {String.fromCharCode(65 + vi)}{v.subject ? ` — ${v.subject}` : ""}</p>
                      <div className="mt-1 text-xs text-muted-foreground [&_p]:my-1" dangerouslySetInnerHTML={{ __html: v.body || "" }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onApprove}><CheckCircle2 className="h-4 w-4" /> Aprobar y continuar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Attach memory / behaviour files (uploaded to storage; the URL+name is kept in the AI config).
function MemoryFiles({ files, onChange }: { files: AIFile[]; onChange: (f: AIFile[]) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) { toast.error("El archivo debe pesar menos de 8 MB"); return; }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `ai-memory/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("godtube-media").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const url = supabase.storage.from("godtube-media").getPublicUrl(path).data.publicUrl;
      onChange([...(files || []), { name: file.name, url }]);
      toast.success("Archivo adjuntado");
    } catch (e: any) { toast.error(e?.message || "Error al subir el archivo"); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  return (
    <div className="space-y-1">
      {(files || []).map((f, i) => (
        <div key={i} className="flex items-center justify-between gap-2 rounded border border-border/60 bg-muted/30 px-2 py-1 text-xs">
          <a href={f.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 truncate text-foreground hover:underline"><Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{f.name}</span></a>
          <button type="button" onClick={() => onChange((files || []).filter((_, j) => j !== i))} className="shrink-0 text-muted-foreground hover:text-destructive">Quitar</button>
        </div>
      ))}
      <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>
        {uploading ? <><Loader2 className="h-3 w-3 animate-spin" /> Subiendo…</> : <><Paperclip className="h-3 w-3" /> Adjuntar memoria/comportamiento</>}
      </Button>
    </div>
  );
}

function AgentBlock({ icon, title, hint, value, onChange, files, onFilesChange }: { icon: React.ReactNode; title: string; hint: string; value: string; onChange: (v: string) => void; files: AIFile[]; onFilesChange: (f: AIFile[]) => void }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2"><span className="text-primary">{icon}</span><Label className="text-sm font-semibold">{title}</Label></div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={9} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
      <MemoryFiles files={files} onChange={onFilesChange} />
    </div>
  );
}

function AIConfigDialog({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: AIConfig; onSave: (a: AIConfig) => void }) {
  const [cfg, setCfg] = useState<AIConfig>(value);
  useEffect(() => { if (open) setCfg(value); }, [open, value]);
  const set = (patch: Partial<AIConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const f = cfg.files || { global: [], onboarding: [], campaign: [], replies: [] };
  const setFilesFor = (k: keyof AIConfig["files"], v: AIFile[]) => set({ files: { global: f.global || [], onboarding: f.onboarding || [], campaign: f.campaign || [], replies: f.replies || [], [k]: v } });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> Cómo actúa la IA</DialogTitle>
          <p className="text-sm text-muted-foreground">La memoria y el comportamiento de cada agente según la fase. Escríbelo como quieras — cada bloque es un agente distinto.</p>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-2"><Brain className="h-4 w-4 text-primary" /><Label className="text-sm font-semibold">Memoria general</Label></div>
            <p className="text-xs text-muted-foreground">Cómo debe actuar siempre: tono, marca, principios. Aquí subes tu "memoria" de cómo hacerlo.</p>
            <textarea value={cfg.globalMemory} onChange={(e) => set({ globalMemory: e.target.value })} rows={10} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            <MemoryFiles files={f.global} onChange={(v) => setFilesFor("global", v)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Enlace del Google Form</Label>
            <Input value={cfg.formUrl} onChange={(e) => set({ formUrl: e.target.value })} placeholder="https://forms.gle/…" />
            <p className="text-xs text-muted-foreground">Es el que la IA envía al cliente para recoger la info de la campaña.</p>
          </div>

          <AgentBlock icon={<Mail className="h-4 w-4" />} title="Agente Onboarding" hint="Envía el correo de arranque (Form + onboarding) y actualiza las fases en silencio." value={cfg.onboarding} onChange={(v) => set({ onboarding: v })} files={f.onboarding} onFilesChange={(v) => setFilesFor("onboarding", v)} />
          <AgentBlock icon={<FileText className="h-4 w-4" />} title="Agente Campaña" hint="Analiza el Form + tu contexto y crea la campaña en borrador con los copys. Nunca la activa." value={cfg.campaign} onChange={(v) => set({ campaign: v })} files={f.campaign} onFilesChange={(v) => setFilesFor("campaign", v)} />
          <AgentBlock icon={<MessageSquare className="h-4 w-4" />} title="Agente Atención al cliente" hint="Lee el perfil de quien responde y contesta. Lo importante lo deja en borrador y te avisa." value={cfg.replies} onChange={(v) => set({ replies: v })} files={f.replies} onFilesChange={(v) => setFilesFor("replies", v)} />

          <div className="space-y-2 rounded-lg border border-border p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={cfg.autoHandleRoutine} onChange={(e) => set({ autoHandleRoutine: e.target.checked })} className="mt-0.5 h-4 w-4 rounded border-border" />
              <span><b>La IA responde sola lo rutinario.</b> <span className="text-muted-foreground">Lo importante o dudoso siempre se queda en borrador y te avisa. Si lo desactivas, TODO queda en borrador para que tú lo apruebes.</span></span>
            </label>
            <div className="space-y-1.5"><Label className="text-xs">Correo para avisos importantes</Label><Input type="email" value={cfg.notifyEmail} onChange={(e) => set({ notifyEmail: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onSave(cfg)}>Guardar memoria</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { resolveSel, type SafeId, type TourTarget } from "@/lib/tour";

/* Cómo encuentra el tutorial las cosas en la pantalla REAL y cómo las usa: por selector y, si hace
 * falta, por el texto. Antes de pulsar o escribir, `isAllowed` comprueba que el elemento es de
 * verdad el de la lista cerrada (SAFE_IDS) para ESA acción; lo de la campaña, sólo dentro de la
 * campaña de ejemplo del propio tutorial. */

export interface TourCtx { campaignId: string | null }

function visible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  if (!r) return false;
  // En jsdom todo mide 0: ahí basta con que exista y no esté oculto.
  const jsdom = r.width === 0 && r.height === 0 && typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
  if (!jsdom && (r.width < 2 || r.height < 2)) return false;
  const st = window.getComputedStyle(el as HTMLElement);
  return st.visibility !== "hidden" && st.display !== "none";
}

const textOf = (el: Element) => (el.textContent || "").replace(/\s+/g, " ").trim();

/** Todos los elementos visibles que cumplen un objetivo. */
function matches(t: TourTarget, ctx: TourCtx, root: ParentNode): HTMLElement[] {
  const sel = resolveSel(t.sel, ctx.campaignId);
  if (!sel) return [];
  let list: Element[] = [];
  try { list = Array.from(root.querySelectorAll(sel)); } catch { return []; }
  return list.filter((el) => (!t.text || t.text.test(textOf(el))) && visible(el)) as HTMLElement[];
}

/** El primer elemento visible que cumple alguno de los objetivos, por orden (sin subir). */
export function findRaw(targets: TourTarget[], ctx: TourCtx = { campaignId: null }, root: ParentNode = document): { el: HTMLElement; t: TourTarget } | null {
  for (const t of targets) {
    const list = matches(t, ctx, root);
    const el = list[t.nth ?? 0];
    if (el) return { el, t };
  }
  return null;
}

/** Igual, y si el objetivo lo pide, su contenedor (`up` niveles). */
export function findTarget(targets: TourTarget[], ctx: TourCtx = { campaignId: null }, root: ParentNode = document): HTMLElement | null {
  const hit = findRaw(targets, ctx, root);
  if (!hit) return null;
  let el: HTMLElement = hit.el;
  for (let i = 0; i < (hit.t.up ?? 0) && el.parentElement; i++) el = el.parentElement;
  return el;
}

/** Cuántos visibles hay (para no repetir lo ya hecho: «si ya hay 2 pasos, no añadas otro»). */
export function countOf(sel: string, ctx: TourCtx, root: ParentNode = document): number {
  return matches({ sel }, ctx, root).length;
}

/** Espera a que aparezca (las pantallas cargan por partes). null si no sale a tiempo. */
export function waitForTarget(
  targets: TourTarget[], timeoutMs = 3500, signal?: { cancelled: boolean }, ctx: TourCtx = { campaignId: null }, raw = false,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    if (!targets.length) { resolve(null); return; }
    const find = () => (raw ? findRaw(targets, ctx)?.el ?? null : findTarget(targets, ctx));
    const first = find();
    if (first) { resolve(first); return; }
    let done = false;
    const finish = (v: HTMLElement | null) => {
      if (done) return;
      done = true; obs?.disconnect(); window.clearInterval(iv); window.clearTimeout(to); resolve(v);
    };
    const check = () => {
      if (signal?.cancelled) { finish(null); return; }
      const el = find();
      if (el) finish(el);
    };
    const obs = typeof MutationObserver !== "undefined" ? new MutationObserver(check) : null;
    try { obs?.observe(document.body, { childList: true, subtree: true, attributes: true }); } catch { /* nada */ }
    const iv = window.setInterval(check, 150);
    const to = window.setTimeout(() => finish(null), timeoutMs);
  });
}

/** El enlace del menú lateral a una pantalla (aunque el menú del móvil esté cerrado). */
export function navLink(path: string, root: ParentNode = document): HTMLAnchorElement | null {
  return root.querySelector<HTMLAnchorElement>(`aside a[href="${path}"]`);
}

/* ── La lista cerrada, comprobada en la página ─────────────────────────────────────────── */

const isTag = (el: Element, tag: string) => el.tagName === tag;
const txt = (el: Element, re: RegExp) => re.test(textOf(el));
const inDialog = (el: Element, title?: RegExp) => {
  const d = el.closest('[role="dialog"]:not([data-testid="guided-tour"])');
  return !!d && (!title || title.test(textOf(d)));
};
/** Dentro de la campaña de ejemplo del tutorial (nunca otra campaña del cliente). */
const inTourCampaign = (el: Element, ctx: TourCtx) =>
  !!ctx.campaignId && el.closest("[data-tour-campaign]")?.getAttribute("data-tour-campaign") === ctx.campaignId;

const AGENT_SECTIONS = /^(Objetivo y alcance|Categorías de lead|Modo de respuesta|Tono y longitud|Contexto y guía|Integraciones)$/;

const SAFE: Record<SafeId, (el: Element, ctx: TourCtx) => boolean> = {
  "nav": (el) => el.matches("aside a[href]"),
  "create-open": (el) => isTag(el, "BUTTON") && txt(el, /^Crear campaña$/) && !el.closest('[role="dialog"]') && !!el.closest("main"),
  "create-name": (el) => isTag(el, "INPUT") && inDialog(el, /Crear campaña/),
  "create-submit": (el) => isTag(el, "BUTTON") && txt(el, /^Crear$/) && inDialog(el, /Crear campaña/),
  "campaign-row": (el, ctx) => el.matches('[data-tour="campaign-row"]') && !!ctx.campaignId && el.getAttribute("data-campaign-id") === ctx.campaignId,
  "campaign-tab": (el, ctx) => isTag(el, "BUTTON") && !!el.closest('nav[aria-label="Secciones de la campaña"]') && inTourCampaign(el, ctx),
  "campaign-back": (el, ctx) => el.matches('button[aria-label="Volver a campañas"]') && inTourCampaign(el, ctx),
  "seq-first-step": (el, ctx) => isTag(el, "BUTTON") && txt(el, /^Crear primer paso$/) && inTourCampaign(el, ctx),
  "seq-add-step": (el, ctx) => isTag(el, "BUTTON") && txt(el, /^Añadir paso$/) && inTourCampaign(el, ctx),
  "seq-step-card": (el, ctx) => el.classList.contains("seq2-card") && !!el.closest("[data-step-row]") && inTourCampaign(el, ctx),
  "seq-subject": (el, ctx) => el.id === "seq-subject-editor" && inTourCampaign(el, ctx),
  "seq-body": (el, ctx) => el.id === "seq-body-editor" && inTourCampaign(el, ctx),
  "seq-delay": (el, ctx) => el.matches('input[aria-label="Cuánto esperar"]') && inTourCampaign(el, ctx),
  "seq-add-variant": (el, ctx) => el.matches('button[aria-label="Añadir variante"]') && inTourCampaign(el, ctx),
  "seq-variant-chip": (el, ctx) => isTag(el, "BUTTON") && !!el.closest(".seq2-chip") && el.getAttribute("role") !== "switch" && inTourCampaign(el, ctx),
  "seq-variant-off": (el, ctx) => el.matches('button[role="switch"][title^="Apagar la versión B"]') && inTourCampaign(el, ctx),
  "seq-variant-on": (el, ctx) => el.matches('button[role="switch"][title^="Encender la versión B"]') && inTourCampaign(el, ctx),
  "seq-preview": (el, ctx) => el.matches('button.seq2-tool[aria-label="Vista previa"]') && inTourCampaign(el, ctx),
  "seq-insert-var": (el, ctx) => el.matches('button.seq2-tool[aria-label="Insertar variable"]') && inTourCampaign(el, ctx),
  "settings-subtab": (el, ctx) => isTag(el, "BUTTON") && txt(el, /^(Cuentas|Horario|Opciones|Bajas)$/) && inTourCampaign(el, ctx),
  "leads-import-open": (el, ctx) => isTag(el, "BUTTON") && txt(el, /^Importar CSV$/) && inTourCampaign(el, ctx),
  "dialog-close": (el) => isTag(el, "BUTTON") && txt(el, /^Close$/) && inDialog(el),
  "accounts-add-open": (el) => isTag(el, "BUTTON") && el.classList.contains("soft-primary") && txt(el, /^Añadir cuenta/) && !!el.closest("main"),
  "accounts-single": (el) => el.matches("button[aria-pressed]") && txt(el, /^Conectar una cuenta/) && inDialog(el, /Añadir cuenta de email/),
  "accounts-provider": (el) => isTag(el, "BUTTON") && txt(el, /^(Gmail|Outlook|SMTP)$/) && inDialog(el, /Añadir cuenta de email/),
  "accounts-email": (el) => el.id === "acc-email" && inDialog(el, /Añadir cuenta de email/),
  "leads-add-open": (el) => isTag(el, "BUTTON") && txt(el, /^Añadir\s*Lead$/) && !!el.closest("main"),
  "leads-email": (el) => el.matches('input[placeholder="lead@empresa.com"]') && inDialog(el, /Añadir lead/),
  "unibox-filter": (el) => isTag(el, "BUTTON") && !!el.closest('[data-tour="unibox-filters"]'),
  "agent-create-open": (el) => isTag(el, "BUTTON") && txt(el, /^Crear agente(\s|$)/) && !!el.closest("main"),
  "agent-kind": (el) => el.getAttribute("role") === "menuitem" && txt(el, /^Agente de respuestas/),
  "agent-section": (el) => isTag(el, "BUTTON") && !!el.closest("main nav") && txt(el, AGENT_SECTIONS),
  "agent-back": (el) => el.matches('main button[aria-label="Volver"]'),
  "deliv-mode": (el) => el.matches("main button[aria-pressed]") && txt(el, /^(Copy de una campaña|Escribir o pegar mi copy)$/),
  "settings-tab": (el) => el.getAttribute("role") === "tab" && txt(el, /^(Perfil|Plan|Envío)$/),
  "search-input": (el) => el.matches('input[placeholder="Buscar campañas, leads, correos..."]'),
  "notifications": (el) => el.matches('button[aria-label="Notificaciones"]'),
  "account-menu": (el) => el.matches('button[aria-label="Cuenta"]'),
  "chat-open": (el) => el.matches('button[aria-label^="Abrir el"]'),
  "chat-close": (el) => el.matches('[aria-label="Asistente IA"] button[aria-label="Cerrar"]'),
};

/** ¿Puede el guía usar este elemento para esta acción? Nunca nada fuera de la lista. */
export function isAllowed(el: Element | null, safe: SafeId, ctx: TourCtx): boolean {
  if (!el) return false;
  const check = SAFE[safe];
  if (!check) return false;
  // Nada de enviar formularios por la puerta de atrás (sólo «Crear» de la campaña de ejemplo).
  if (safe !== "create-submit" && el.getAttribute("type") === "submit") return false;
  try { return check(el, ctx); } catch { return false; }
}

/* ── Usar la página ─────────────────────────────────────────────────────────────────────── */

/** Centro de un elemento en pantalla (para llevar el cursor). */
export function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 };
}

/** Un clic «de verdad»: los componentes de Radix abren con pointerdown/mousedown, no sólo click. */
export function realClick(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const base = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
  const P = typeof PointerEvent !== "undefined" ? PointerEvent : null;
  const pointer = (type: string, buttons: number) =>
    P ? new P(type, { ...base, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true }) : new MouseEvent(type, { ...base, buttons });
  el.dispatchEvent(pointer("pointerdown", 1));
  el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
  el.dispatchEvent(pointer("pointerup", 0));
  el.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
  el.click();
}

/** Pone el valor como si lo escribiera una persona (React se entera por el evento input). */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Escribe letra a letra (borra lo que hubiera). Si ya pone eso, no hace nada. */
export async function typeInto(
  el: HTMLInputElement | HTMLTextAreaElement, text: string,
  opts: { cps?: number; signal?: { cancelled: boolean }; blur?: boolean } = {},
): Promise<void> {
  if (el.value === text) { if (opts.blur) el.blur(); return; }
  try { el.focus({ preventScroll: true }); } catch { /* nada */ }
  const delay = opts.cps && opts.cps > 0 ? 1000 / opts.cps : 0;
  setNativeValue(el, "");
  if (!delay) {
    setNativeValue(el, text);
  } else {
    for (let i = 1; i <= text.length; i++) {
      if (opts.signal?.cancelled) break;
      setNativeValue(el, text.slice(0, i));
      await new Promise((r) => window.setTimeout(r, delay));
    }
    if (!opts.signal?.cancelled && el.value !== text) setNativeValue(el, text);
  }
  if (opts.blur) el.blur();
}

/** Las teclas que pulsa el propio guía (para que el tutorial no las tome por del cliente). */
const OWN_KEYS = new WeakSet<Event>();
export const isTourKey = (e: Event): boolean => OWN_KEYS.has(e);

/** Cierra el menú o desplegable abierto (Escape). Lo ignora el propio tutorial (no es del usuario). */
export function pressEscape(): void {
  const target = (document.activeElement as HTMLElement | null) || document.body;
  const ev = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
  OWN_KEYS.add(ev);
  target.dispatchEvent(ev);
}

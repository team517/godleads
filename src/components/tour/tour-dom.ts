import type { TourTarget } from "@/lib/tour";

/* Cómo encuentra el tutorial las cosas en la pantalla REAL: por selector y, si hace falta, por el
 * texto. Sólo lee la página; el único clic de verdad es abrir algo para mirarlo (isSafeClick). */

function visible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  if (!r) return false;
  // En jsdom todo mide 0: ahí basta con que exista y no esté oculto.
  const jsdom = r.width === 0 && r.height === 0 && typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
  if (!jsdom && (r.width < 2 || r.height < 2)) return false;
  const st = window.getComputedStyle(el as HTMLElement);
  return st.visibility !== "hidden" && st.display !== "none";
}

/** El primer elemento visible que cumple alguno de los objetivos, por orden. */
export function findTarget(targets: TourTarget[], root: ParentNode = document): HTMLElement | null {
  for (const t of targets) {
    let list: Element[] = [];
    try { list = Array.from(root.querySelectorAll(t.sel)); } catch { continue; }
    for (const el of list) {
      if (t.text && !t.text.test((el.textContent || "").trim())) continue;
      if (visible(el)) return el as HTMLElement;
    }
  }
  return null;
}

/** Espera a que aparezca (las pantallas cargan por partes). null si no sale a tiempo. */
export function waitForTarget(targets: TourTarget[], timeoutMs = 3500, signal?: { cancelled: boolean }): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    if (!targets.length) { resolve(null); return; }
    const start = Date.now();
    const tick = () => {
      if (signal?.cancelled) { resolve(null); return; }
      const el = findTarget(targets);
      if (el) { resolve(el); return; }
      if (Date.now() - start >= timeoutMs) { resolve(null); return; }
      window.setTimeout(tick, 120);
    };
    tick();
  });
}

/** El enlace del menú lateral a una pantalla (aunque el menú del móvil esté cerrado). */
export function navLink(path: string, root: ParentNode = document): HTMLAnchorElement | null {
  return root.querySelector<HTMLAnchorElement>(`aside a[href="${path}"]`);
}

const SAFE_TABS = new Set(["Editor", "Ajustes", "Analítica"]);

/** Sólo se pulsa de verdad lo que abre o enseña algo, nunca lo que guarda, crea o borra:
 *  la fila de una campaña (la abre) y las pestañas Editor / Ajustes / Analítica. */
export function isSafeClick(el: Element | null): boolean {
  if (!el) return false;
  if (el.matches('[data-tour="campaign-row"]')) return true;
  if (el.tagName === "BUTTON" && SAFE_TABS.has((el.textContent || "").trim())
    && !el.closest("form") && el.getAttribute("type") !== "submit") return true;
  return false;
}

/** Centro de un elemento en pantalla (para llevar el cursor). */
export function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 };
}

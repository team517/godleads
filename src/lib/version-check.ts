// Vigilante de versión: cuando EasyPanel publica un build nuevo, la pestaña abierta (o la
// PWA instalada) sigue con el index.html y los chunks viejos hasta que alguien recarga a
// mano — el usuario veía "la versión de ayer" con el servidor ya actualizado (2026-09-16).
//
// Cada pocos minutos, y al volver a la pestaña, se pide /index.html sin caché y se compara
// el hash del bundle principal con el que está corriendo. Si cambió, se recarga — salvo que
// la persona esté escribiendo (una respuesta a medias vale más que la versión nueva; se
// reintenta en la siguiente comprobación).

const BUNDLE_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

/** Hash del bundle principal que está corriendo en esta pestaña (o "" si no se encuentra). */
export function runningBundle(doc: Document = document): string {
  const scripts = Array.from(doc.querySelectorAll('script[src]')) as HTMLScriptElement[];
  for (const s of scripts) {
    const m = (s.getAttribute("src") || "").match(BUNDLE_RE);
    if (m) return m[0];
  }
  return "";
}

/** Hash del bundle principal que el servidor sirve AHORA, leído de un index.html fresco. */
export function bundleInHtml(html: string): string {
  const m = html.match(BUNDLE_RE);
  return m ? m[0] : "";
}

/** ¿Hay alguien escribiendo? Entonces no se recarga. */
export function userIsTyping(doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable === true;
}

export async function checkForNewVersion(fetchImpl: typeof fetch = fetch, doc: Document = document): Promise<"same" | "reload" | "typing" | "unknown"> {
  const current = runningBundle(doc);
  if (!current) return "unknown";
  try {
    const res = await fetchImpl(`/index.html?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return "unknown";
    const served = bundleInHtml(await res.text());
    if (!served || served === current) return "same";
    if (userIsTyping(doc)) return "typing";
    return "reload";
  } catch {
    return "unknown";
  }
}

let started = false;
/** Arranca el vigilante una sola vez por pestaña. */
export function startVersionWatcher(intervalMs = 5 * 60 * 1000): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = async () => {
    if ((await checkForNewVersion()) === "reload") window.location.reload();
  };
  window.setInterval(tick, intervalMs);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void tick(); });
}

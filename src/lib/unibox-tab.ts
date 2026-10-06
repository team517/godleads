// Pestaña del Unibox que se abre al entrar (06-10-2026): Campaigns por defecto y, si el usuario
// cambió de pestaña en este navegador, la última que usó. Se guarda en localStorage; si no está
// disponible (modo privado, datos bloqueados) se abre Campaigns y no pasa nada.
export type UniboxTab = "global" | "all_mailboxes" | "important" | "campaigns" | "reminders" | "sent";

const KEY = "op_unibox_tab";
const TABS: readonly UniboxTab[] = ["global", "all_mailboxes", "important", "campaigns", "reminders", "sent"];

export function isUniboxTab(v: unknown): v is UniboxTab {
  return typeof v === "string" && (TABS as readonly string[]).includes(v);
}

export function readSavedUniboxTab(storage?: Pick<Storage, "getItem"> | null): UniboxTab {
  try {
    const st = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    const v = st?.getItem(KEY);
    return isUniboxTab(v) ? v : "campaigns";
  } catch {
    return "campaigns";
  }
}

export function saveUniboxTab(tab: UniboxTab, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const st = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    st?.setItem(KEY, tab);
  } catch { /* sin almacenamiento: la próxima vez se abre Campaigns */ }
}

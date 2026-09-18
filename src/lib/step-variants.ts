/* Versiones (A/B) de un correo de la secuencia.
 *
 * Un paso tiene SIEMPRE su versión A —el propio `subject`/`body` del paso— y puede tener
 * variantes B, C… Cada una se puede APAGAR: apagada se queda escrita, pero no se envía.
 *
 * Cómo se consigue eso sin tocar el motor de envío: el motor sólo lee `campaign_steps.variants`,
 * así que una variante apagada se GUARDA EN OTRA COLUMNA (`variants_off`) que el motor no mira.
 * Encenderla es devolverla a su sitio. Cada apagada recuerda su hueco (`off_slot`) para que la
 * letra no baile: si apagas la B, la B sigue siendo la B.
 *
 * Todo lo de aquí es puro (entra un estado, sale otro) para poder probarlo.
 */

export interface StepVariant {
  subject?: string;
  body?: string;
  tag_filter?: string | null;
  /** Sólo en las apagadas: el hueco que ocupaban (1 = B, 2 = C…). */
  off_slot?: number;
}

export interface VariantState {
  /** Las que SÍ se envían, en el orden que usa el motor. */
  variants: StepVariant[];
  /** Las apagadas, cada una con su hueco. */
  off: StepVariant[];
}

export interface Version {
  /** 0 = la versión A (el propio paso); 1 = B; 2 = C… */
  slot: number;
  label: string;
  enabled: boolean;
  /** null en la versión A: su texto vive en el paso, no en la lista. */
  variant: StepVariant | null;
  /** Dónde está de verdad: posición en `variants` si está encendida, en `off` si no. -1 en la A. */
  index: number;
}

const letter = (slot: number) => String.fromCharCode(65 + slot);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
/** Una variante lista para `variants`: sin la marca del hueco, que sólo vale estando apagada. */
const clean = (v: StepVariant): StepVariant => {
  const { off_slot, ...rest } = v || {};
  return rest;
};

export function readState(step: any): VariantState {
  return {
    variants: Array.isArray(step?.variants) ? step.variants : [],
    off: Array.isArray(step?.variants_off) ? step.variants_off : [],
  };
}

/** Todas las versiones del paso en orden: A, B, C… con su estado y dónde vive cada una. */
export function versionsOf(state: VariantState): Version[] {
  const total = state.variants.length + state.off.length;
  const bySlot: (Version | null)[] = new Array(total).fill(null);

  // Primero las apagadas, cada una en el hueco que recuerda.
  const homeless: number[] = [];
  state.off.forEach((v, i) => {
    const at = clamp((Number(v.off_slot) || 1) - 1, 0, Math.max(0, total - 1));
    if (total > 0 && bySlot[at] === null) {
      bySlot[at] = { slot: at + 1, label: letter(at + 1), enabled: false, variant: v, index: i };
    } else {
      homeless.push(i);
    }
  });

  // Luego las encendidas llenan los huecos libres, en su orden.
  const queue: { enabled: boolean; index: number; v: StepVariant }[] = [
    ...state.variants.map((v, i) => ({ enabled: true, index: i, v })),
    ...homeless.map((i) => ({ enabled: false, index: i, v: state.off[i] })),
  ];
  for (let i = 0; i < total; i++) {
    if (bySlot[i] !== null) continue;
    const q = queue.shift();
    if (!q) continue;
    bySlot[i] = { slot: i + 1, label: letter(i + 1), enabled: q.enabled, variant: q.v, index: q.index };
  }

  return [
    { slot: 0, label: "A", enabled: true, variant: null, index: -1 },
    ...bySlot.filter((v): v is Version => v !== null),
  ];
}

/** ¿Hay alguna variante (B, C…) encendida? La A siempre se envía. */
export const hasLiveVariants = (state: VariantState) => state.variants.length > 0;

const find = (state: VariantState, slot: number) => versionsOf(state).find((v) => v.slot === slot);

/** Apaga una variante: sale de `variants` (deja de enviarse) y se guarda con su hueco. */
export function disableSlot(state: VariantState, slot: number): VariantState {
  const target = find(state, slot);
  if (!target || !target.enabled || !target.variant || target.index < 0) return state;
  return {
    variants: state.variants.filter((_, i) => i !== target.index),
    off: [...state.off, { ...clean(target.variant), off_slot: slot }],
  };
}

/** Enciende una variante apagada: vuelve a `variants`, en el orden de su hueco. */
export function enableSlot(state: VariantState, slot: number): VariantState {
  const target = find(state, slot);
  if (!target || target.enabled || !target.variant || target.index < 0) return state;
  const off = state.off.filter((_, i) => i !== target.index);
  // Se coloca detras de las que ya se envian y van antes que ella, para no alterar el orden.
  const before = versionsOf({ variants: state.variants, off }).filter((v) => v.slot > 0 && v.slot < slot && v.enabled).length;
  const variants = [...state.variants];
  variants.splice(clamp(before, 0, variants.length), 0, clean(target.variant));
  return { variants, off };
}

/** Apaga TODAS las variantes: sólo se envía la A. */
export function disableAll(state: VariantState): VariantState {
  let next = state;
  for (const v of versionsOf(state)) {
    if (v.slot > 0 && v.enabled) next = disableSlot(next, v.slot);
  }
  return next;
}

/** Vuelve a encender todas las apagadas. */
export function enableAll(state: VariantState): VariantState {
  let next = state;
  for (const v of versionsOf(state)) {
    if (v.slot > 0 && !v.enabled) next = enableSlot(next, v.slot);
  }
  return next;
}

/** Borra del todo una versión (la papelera). La A no se borra: es el propio correo. */
export function removeSlot(state: VariantState, slot: number): VariantState {
  const target = find(state, slot);
  if (slot <= 0 || !target || !target.variant || target.index < 0) return state;
  const next: VariantState = target.enabled
    ? { variants: state.variants.filter((_, i) => i !== target.index), off: state.off }
    : { variants: state.variants, off: state.off.filter((_, i) => i !== target.index) };
  // Las apagadas que iban detras suben una letra.
  return { variants: next.variants, off: next.off.map((v) => {
    const s = Number(v.off_slot) || 1;
    return s > slot ? { ...v, off_slot: s - 1 } : v;
  }) };
}

/** Cambia el texto (o la etiqueta) de una versión, esté encendida o apagada. */
export function writeSlot(state: VariantState, slot: number, patch: Partial<StepVariant>): VariantState {
  const target = find(state, slot);
  if (!target || !target.variant || target.index < 0) return state;
  if (target.enabled) {
    const variants = [...state.variants];
    variants[target.index] = { ...variants[target.index], ...patch };
    return { variants, off: state.off };
  }
  const off = [...state.off];
  off[target.index] = { ...off[target.index], ...patch };
  return { variants: state.variants, off };
}

/** Añade una variante nueva al final, encendida. Devuelve también su hueco. */
export function addVariantTo(state: VariantState, base: { subject?: string; body?: string }): { state: VariantState; slot: number } {
  const slot = state.variants.length + state.off.length + 1;
  return {
    state: { variants: [...state.variants, { subject: base.subject || "", body: base.body || "", tag_filter: null }], off: state.off },
    slot,
  };
}

// Reparto del día entre PRIMEROS CORREOS (leads nuevos) y SEGUIMIENTOS.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 02-10-2026: el motor vaciaba primero todos los seguimientos y lo que sobrara era para leads
// nuevos. Con una cola de seguimientos atrasados salían días enteros sin un solo primer correo
// (support@: 6.037 envíos, 0 leads nuevos, 23 respuestas). Ahora cada campaña puede repartir.
//
// Es un módulo PURO (sin red ni base de datos): lo usan el motor de envío y la pantalla de
// opciones, y tiene sus pruebas y una simulación de varios días (src/test/lead-mix.test.ts).
// Hay copia idéntica en supabase/functions/_shared (shared-copies.test.ts vigila que no difieran).
//
// Reglas:
//  1. El TOTAL del día no cambia: mismos topes por buzón y misma subida gradual. Sólo cambia la mezcla.
//  2. Un seguimiento sale del buzón que envió el primer correo, así que el reparto se hace POR
//     BUZÓN: cada uno guarda sitio para sus seguimientos del día y el resto es para leads nuevos.
//  3. Nada se desperdicia: si faltan seguimientos, su parte pasa a leads nuevos, y al revés.
//  4. Si hay más seguimientos que sitio, se recorta por igual a todos los buzones (los que más
//     tienen ceden primero); lo que no cabe hoy sale mañana, primero los más antiguos.

export type MixMode = "off" | "auto" | "manual";

/** % mínimo de leads nuevos en automático: aunque haya cola de seguimientos, cada día salen primeros correos. */
export const AUTO_MIN_NEW_PCT = 15;

/**
 * % de leads nuevos que mantiene una secuencia EN EQUILIBRIO: cada lead nuevo trae después
 * (pasos − 1) seguimientos, así que de cada `pasos` correos sólo uno puede ser un primer correo.
 * Redondeado a múltiplos de 5: 1 paso → 100, 2 → 50, 3 → 35, 4 → 25, 5 → 20.
 */
export function balancedNewPct(steps: number): number {
  const n = Math.max(1, Math.floor(Number(steps) || 1));
  if (n === 1) return 100;
  return Math.max(10, Math.min(100, Math.ceil(100 / n / 5) * 5));
}

/**
 * El % de leads nuevos que se aplica HOY, o null si la campaña no reparte (comportamiento de siempre).
 *  · manual: el de la barra.
 *  · auto: el de equilibrio según los pasos; si hay más seguimientos pendientes de los que caben
 *    en su parte, baja los nuevos en proporción para ponerse al día, sin pasar del mínimo.
 */
export function resolveNewPct(input: {
  mode: MixMode | string | null | undefined; pct?: number | null; steps: number;
  dailyLimit?: number; followupsDueToday?: number;
}): number | null {
  const mode = input.mode;
  if (mode === "manual") return clampPct(input.pct ?? balancedNewPct(input.steps));
  if (mode !== "auto") return null;
  const base = balancedNewPct(input.steps);
  const limit = Math.max(0, Number(input.dailyLimit) || 0);
  const due = Math.max(0, Number(input.followupsDueToday) || 0);
  const fuShare = limit * (100 - base) / 100;
  if (limit <= 0 || fuShare <= 0 || due <= fuShare) return base;
  // Cola de seguimientos: los nuevos ceden en proporción (el doble de cola → la mitad de nuevos).
  return Math.max(Math.min(base, AUTO_MIN_NEW_PCT), Math.round(base * fuShare / due));
}

export function clampPct(p: number): number {
  const n = Math.round(Number(p));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

export interface MixAccount {
  id: string;
  /** Tope de envíos de HOY de este buzón (ya con la subida gradual). */
  limit: number;
  /** Seguimientos de esta campaña que le tocan hoy a este buzón y aún no han salido. */
  fuDue: number;
  /** Seguimientos de esta campaña que este buzón ya ha enviado hoy. */
  fuSent: number;
}

export interface MixInput {
  /** Tope de la campaña hoy (el menor entre su límite y lo que suman sus buzones). */
  dailyLimit: number;
  /** % de leads nuevos (0-100). */
  newPct: number;
  /** Primeros correos enviados hoy + leads que aún esperan el suyo (ya con el máximo diario aplicado). */
  newDemand: number;
  accounts: MixAccount[];
  /** Seguimientos de hoy de buzones que no están en la lista (desconectados): saldrán prestados. */
  extraFuDue?: number;
}

export interface MixPlan {
  /** Primeros correos que pueden salir hoy en total. */
  newQuota: number;
  /** Seguimientos que pueden salir hoy en total. */
  fuQuota: number;
  /** Por buzón: cuántos seguimientos puede enviar hoy (los ya enviados incluidos). */
  fuTarget: Record<string, number>;
}

/**
 * El reparto de hoy. Primero a nivel de campaña (con el traspaso de lo que una parte no usa) y
 * después por buzón, nivelando: si los seguimientos no caben, se busca el mismo "nivel" (fracción
 * del tope) para todos los buzones, de modo que el que tiene pocos los envía todos y los que
 * tienen muchos ceden.
 */
export function allocateMix(input: MixInput): MixPlan {
  const limit = Math.max(0, Math.floor(Number(input.dailyLimit) || 0));
  const pct = clampPct(input.newPct);
  const accounts = (input.accounts || []).map((a) => ({
    id: a.id,
    limit: Math.max(0, Math.floor(Number(a.limit) || 0)),
    fuDue: Math.max(0, Math.floor(Number(a.fuDue) || 0)),
    fuSent: Math.max(0, Math.floor(Number(a.fuSent) || 0)),
  }));
  const extraFu = Math.max(0, Math.floor(Number(input.extraFuDue) || 0));
  const newDemand = Math.max(0, Math.floor(Number(input.newDemand) || 0));

  // Lo máximo que cada buzón podría dedicar hoy a seguimientos: lo que le toca, sin pasar de su tope.
  const want = (a: { limit: number; fuDue: number; fuSent: number }) => Math.min(a.fuDue + a.fuSent, Math.max(a.limit, a.fuSent));
  const fuDemand = accounts.reduce((s, a) => s + want(a), 0) + extraFu;

  // Campaña: cada parte recibe lo suyo y lo que la otra no vaya a usar.
  const new0 = Math.round(limit * pct / 100);
  const fu0 = limit - new0;
  const fuQuotaC = Math.min(fuDemand, fu0 + Math.max(0, new0 - newDemand));

  // Por buzón. Si todo cabe, cada buzón envía todos sus seguimientos. Si no, se nivela.
  const fuTarget: Record<string, number> = {};
  const room = Math.max(0, fuQuotaC - Math.min(extraFu, fuQuotaC));  // los prestados cuentan en el total
  const at = (a: { limit: number; fuDue: number; fuSent: number }, level: number) =>
    Math.min(want(a), Math.max(a.fuSent, Math.round(a.limit * level)));
  const total = (level: number) => accounts.reduce((s, a) => s + at(a, level), 0);
  let level = 1;
  if (total(1) > room) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (total(mid) > room) hi = mid; else lo = mid; }
    level = lo;
  }
  let assigned = 0;
  for (const a of accounts) { fuTarget[a.id] = at(a, level); assigned += fuTarget[a.id]; }
  // El redondeo puede dejar algún hueco por debajo del total: se reparte de uno en uno entre los
  // buzones que aún tienen seguimientos pendientes y sitio (los de más cola primero).
  if (level < 1 && assigned < room) {
    const order = [...accounts].sort((x, y) => (want(y) - fuTarget[y.id]) - (want(x) - fuTarget[x.id]));
    for (const a of order) {
      if (assigned >= room) break;
      if (fuTarget[a.id] < want(a)) { fuTarget[a.id]++; assigned++; }
    }
  }

  const fuQuota = Math.min(fuQuotaC, assigned + Math.min(extraFu, fuQuotaC));
  const accountRoom = accounts.reduce((s, a) => s + Math.max(0, a.limit - fuTarget[a.id]), 0);
  const newQuota = Math.max(0, Math.min(newDemand, limit - fuQuota, accountRoom));
  return { newQuota, fuQuota, fuTarget };
}

/**
 * Cuántos correos de una parte pueden salir AHORA: su cupo del día repartido a lo largo de la
 * franja (misma fracción que usa el motor para el total), menos lo ya enviado. Un suelo pequeño
 * hace que las dos partes arranquen nada más abrir la franja.
 */
export function laneAllowance(quota: number, sentToday: number, paceFraction: number): number {
  const q = Math.max(0, Math.floor(Number(quota) || 0));
  const f = Math.max(0, Math.min(1, Number(paceFraction) || 0));
  const dueByNow = Math.min(q, Math.max(Math.min(q, 2), Math.ceil(q * f)));
  return Math.max(0, dueByNow - Math.max(0, Math.floor(Number(sentToday) || 0)));
}

/** ¿Puede este buzón coger un lead NUEVO ahora? Sí, si le queda sitio después de guardar el de sus seguimientos. */
export function roomForNewLead(acc: { limit: number; sentToday: number; fuSent: number }, fuTarget: number): boolean {
  const reserve = Math.max(0, (Number(fuTarget) || 0) - (Number(acc.fuSent) || 0));
  return (Number(acc.sentToday) || 0) + reserve < (Number(acc.limit) || 0);
}

/**
 * Mezcla dos listas en proporción a sus pesos (2 y 1 → a, a, b, a, a, b…). Así, dentro de una
 * misma pasada, seguimientos y primeros correos salen intercalados y ninguno se queda los buzones.
 */
export function interleave<T>(a: T[], b: T[], weightA: number, weightB: number): T[] {
  const wa = Math.max(0, Number(weightA) || 0), wb = Math.max(0, Number(weightB) || 0);
  if (wa <= 0 && wb <= 0) return [...a, ...b];
  if (wb <= 0) return [...a, ...b];
  if (wa <= 0) return [...b, ...a];
  const out: T[] = [];
  let i = 0, j = 0, acc = 0;
  const share = wa / (wa + wb);
  while (i < a.length && j < b.length) {
    acc += share;
    if (acc >= 0.5) { out.push(a[i++]); acc -= 1; } else { out.push(b[j++]); }
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}

/** Texto de ayuda de la barra: qué significa ese porcentaje para una secuencia de N pasos. */
export function mixAdvice(newPct: number, steps: number): { tone: "ok" | "warn" | "info"; text: string } {
  const pct = clampPct(newPct);
  const balance = balancedNewPct(steps);
  if (steps <= 1) return { tone: "info", text: "Esta campaña sólo tiene un paso: no hay seguimientos que repartir." };
  if (pct > balance + 5) {
    return { tone: "warn", text: `Con ${steps} pasos el equilibrio está en ${balance} % de nuevos. Por encima entran más primeros correos, pero los seguimientos se irán retrasando.` };
  }
  if (pct < balance - 5) {
    return { tone: "info", text: `Los seguimientos irán al día. Cuando no haya suficientes para llenar su parte, lo que sobre se usa en leads nuevos.` };
  }
  return { tone: "ok", text: `Equilibrado para ${steps} pasos: los seguimientos salen a su hora y cada día hay primeros correos.` };
}

/**
 * Estimación para la pantalla de opciones: con este porcentaje, cuántos primeros correos y
 * cuántos seguimientos saldrían HOY y cuántos seguimientos quedarían para otro día. Es el mismo
 * reparto del motor a nivel de campaña (sin el detalle por buzón).
 */
export function mixEstimate(input: {
  dailyLimit: number; newPct: number; newPending: number; followupsDueToday: number; maxNewPerDay?: number | null;
}): { nuevos: number; seguimientos: number; aplazados: number } {
  const limit = Math.max(0, Math.floor(Number(input.dailyLimit) || 0));
  const pct = clampPct(input.newPct);
  const cap = Number(input.maxNewPerDay);
  let newDemand = Math.max(0, Math.floor(Number(input.newPending) || 0));
  if (Number.isFinite(cap) && cap > 0) newDemand = Math.min(newDemand, Math.floor(cap));
  const fuDemand = Math.max(0, Math.floor(Number(input.followupsDueToday) || 0));
  const new0 = Math.round(limit * pct / 100);
  const fu0 = limit - new0;
  const seguimientos = Math.min(fuDemand, fu0 + Math.max(0, new0 - newDemand));
  const nuevos = Math.max(0, Math.min(newDemand, limit - seguimientos));
  return { nuevos, seguimientos, aplazados: Math.max(0, fuDemand - seguimientos) };
}

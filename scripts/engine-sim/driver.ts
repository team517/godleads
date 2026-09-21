// ─── ENGINE SIM · driver ───────────────────────────────────────────────────────────────────
// Se añade DETRÁS del código real del motor. Monta una plataforma de prueba y deja correr el
// motor minuto a minuto durante días de envío enteros:
//   · 1 campaña GRANDE: 400 buzones (400 dominios), slow-ramp por buzón 2/día +2 hasta 30,
//     40.000 leads, 2 pasos (el seguimiento a los 2 días)
//   · 6 campañas "de las de hoy": 40 buzones a 30/día cada una, de otros usuarios
// y comprueba lo que importa: cuánto envía cada día, que ningún buzón se pase de su rampa ni
// envíe dos veces en el mismo minuto ni antes de 6 min, que nadie reciba un paso repetido, y
// que las campañas pequeñas sigan enviando lo suyo con la grande al lado.

// deno-lint-ignore-file no-explicit-any
const BIG_ACCOUNTS = Number(Deno.env.get("SIM_BIG_ACCOUNTS") || 400);
const BIG_LEADS = Number(Deno.env.get("SIM_BIG_LEADS") || 40000);
const SMALL_CAMPAIGNS = 6, SMALL_ACCOUNTS = 40, SMALL_LEADS = 6000;
// Día de calendario → días de envío previos que "lleva" cada buzón de la grande (su rampa).
const ALL_DAYS: [string, number][] = [["2026-09-21", 0], ["2026-09-22", 1], ["2026-09-23", 2], ["2026-09-24", 7], ["2026-09-25", 14]];
// SIM_DAYS="0,4" → sólo esos días (por índice). Por defecto, los cinco.
const DAYS = Deno.env.get("SIM_DAYS") ? Deno.env.get("SIM_DAYS")!.split(",").map((i) => ALL_DAYS[Number(i)]) : ALL_DAYS;

const mkAccounts = (prefix: string, n: number, userId: string, tag: string, ramp: boolean) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-acc-${String(i).padStart(4, "0")}`, user_id: userId, email: `buzon@${prefix}-dominio-${i}.com`,
    first_name: "Ana", last_name: "Ruiz", status: "connected", tags: [tag],
    smtp_host: "smtp.ionos.es", smtp_port: 587, smtp_username: `buzon@${prefix}-dominio-${i}.com`, smtp_password: "x",
    daily_limit: 30, sent_today: 0, last_send_at: null,
    warmup_enabled: ramp, warmup_started_at: ramp ? "2026-09-20T00:00:00Z" : null, warmup_increment: 2, warmup_limit: 30, warmup_day: 2,
  }));
const mkCampaign = (id: string, userId: string, tag: string, leads: number) => {
  __load("campaigns", [{
    id, user_id: userId, name: id, status: "active", timezone: "UTC", send_start_hour: 9, send_end_hour: 18,
    send_days: ["mon", "tue", "wed", "thu", "fri"], daily_limit: 0, account_tags: [tag], stop_on_reply: true,
    include_unsubscribe: true, last_campaign_send_at: null,
  }]);
  __load("campaign_steps", [
    { id: `${id}-s0`, campaign_id: id, step_order: 0, delay_days: 0, subject: "Una idea para {{company_name}}", body: "Hola {{first_name}},\n\nOs escribo por {{company_name}}.\n\nUn saludo", variants: [], attachments: [] },
    { id: `${id}-s1`, campaign_id: id, step_order: 1, delay_days: 2, subject: "", body: "Hola {{first_name}}, ¿pudiste verlo?", variants: [], attachments: [] },
  ]);
  const leadRows = Array.from({ length: leads }, (_, i) => ({
    id: `${id}-lead-${String(i).padStart(6, "0")}`, user_id: userId, email: `persona${i}@${id}-empresa-${i}.es`,
    custom_fields: { first_name: "Luis", company_name: `Empresa ${i}` }, status: "active",
  }));
  __load("leads", leadRows);
  __load("campaign_leads", leadRows.map((l, i) => ({
    id: `${id}-cl-${String(i).padStart(6, "0")}`, campaign_id: id, lead_id: l.id, current_step: 0, status: "pending", last_sent_at: null, assigned_account_id: null,
  })));
};

__load("email_accounts", mkAccounts("big", BIG_ACCOUNTS, "user-big", "BIG", true));
mkCampaign("BIG", "user-big", "BIG", BIG_LEADS);
for (let c = 0; c < SMALL_CAMPAIGNS; c++) {
  __load("email_accounts", mkAccounts(`sm${c}`, SMALL_ACCOUNTS, `user-sm${c}`, `SM${c}`, false));
  mkCampaign(`SMALL${c}`, `user-sm${c}`, `SM${c}`, SMALL_LEADS);
}
// Una lista de bloqueados grande, como la de los usuarios reales (14.000 entradas).
__load("blocklist", Array.from({ length: 14000 }, (_, i) => ({ id: `bl-${String(i).padStart(6, "0")}`, user_id: "user-big", entry_type: "email", value: `baja${i}@fuera.es` })));
// Y 25 leads de la grande están bloqueados: no deben recibir nada.
const BLOCKED = new Set<string>();
for (let i = 0; i < 25; i++) { const e = `persona${i * 7}@BIG-empresa-${i * 7}.es`; BLOCKED.add(e.toLowerCase()); __load("blocklist", [{ id: `bl-x${i}`, user_id: "user-big", entry_type: "email", value: e }]); }

const problems: string[] = [];
const accById = new Map(__DB.email_accounts.map((a) => [a.email, a]));
const rampFor = (days: number) => Math.min(2 + days * 2, 30);
const quiet = console.log; console.log = () => {}; // el motor escribe una línea por campaña y pasada
const t0 = performance.now();
let prevSmtp = 0;

for (const [day, rampDays] of DAYS) {
  __SIM.accountDays = rampDays;
  const perTick: number[] = [];
  for (let m = 0; m < 9 * 60; m++) {
    const hh = String(9 + Math.floor(m / 60)).padStart(2, "0"), mm = String(m % 60).padStart(2, "0");
    __setClock(`${day}T${hh}:${mm}:07Z`);
    const before = __SIM.smtp.length;
    const res = await __handler!(new Request("http://sim/process-campaign-queue", { method: "POST", body: "{}" }));
    const body = await res.json().catch(() => ({}));
    if (body?.error) problems.push(`${day} ${hh}:${mm} el motor devolvió error: ${body.error}`);
    perTick.push(__SIM.smtp.length - before);
  }
  const today = __SIM.smtp.slice(prevSmtp); prevSmtp = __SIM.smtp.length;
  const byCampaign: Record<string, number> = {};
  const perAcc: Record<string, number[]> = {};
  for (const s of today) {
    const acc = accById.get(s.from)!; const camp = acc.tags[0];
    byCampaign[camp] = (byCampaign[camp] || 0) + 1;
    (perAcc[s.from] ||= []).push(s.at);
    if (BLOCKED.has(String(s.to).toLowerCase())) problems.push(`${day}: se envió a un BLOQUEADO (${s.to})`);
  }
  let worstGapMin = Infinity, maxAcc = 0;
  for (const [from, ats] of Object.entries(perAcc)) {
    const limit = accById.get(from)!.warmup_enabled ? rampFor(rampDays) : 30;
    maxAcc = Math.max(maxAcc, ats.length);
    if (ats.length > limit) problems.push(`${day}: ${from} envió ${ats.length} con límite ${limit}`);
    for (let i = 1; i < ats.length; i++) worstGapMin = Math.min(worstGapMin, (ats[i] - ats[i - 1]) / 60000);
  }
  if (worstGapMin < 6) problems.push(`${day}: un buzón envió dos correos con ${worstGapMin} min de separación (<6)`);
  const bigCap = BIG_ACCOUNTS * rampFor(rampDays);
  const big = byCampaign.BIG || 0;
  const smalls = Array.from({ length: SMALL_CAMPAIGNS }, (_, c) => byCampaign[`SM${c}`] || 0);
  if (big < bigCap) problems.push(`${day}: la campaña grande envió ${big} de ${bigCap} (${Math.round(100 * big / bigCap)} %)`);
  if (big > bigCap) problems.push(`${day}: la campaña grande se PASÓ: ${big} de ${bigCap}`);
  for (const s of smalls) if (s !== 1200) problems.push(`${day}: una campaña pequeña envió ${s} (esperado 1.200 exactos)`);
  quiet(`${day} · rampa ${rampFor(rampDays)}/buzón · GRANDE ${big}/${bigCap} · pequeñas ${Math.min(...smalls)}–${Math.max(...smalls)} de 1200 · total ${today.length} · pico/min ${Math.max(...perTick)} · máx por buzón ${maxAcc} · separación mínima ${worstGapMin === Infinity ? "—" : worstGapMin.toFixed(0) + " min"}`);
}

// Nadie recibe dos veces el mismo paso; los seguimientos salen del MISMO buzón que el primero.
const seen = new Map<string, number>(); const firstFrom = new Map<string, string>();
for (const r of __DB.sent_emails) {
  const k = `${r.campaign_id}|${r.lead_id}|${r.campaign_step_id}`;
  seen.set(k, (seen.get(k) || 0) + 1);
  const lk = `${r.campaign_id}|${r.lead_id}`;
  if (!firstFrom.has(lk)) firstFrom.set(lk, r.account_id); else if (firstFrom.get(lk) !== r.account_id) problems.push(`seguimiento desde OTRO buzón: ${lk}`);
}
const dups = [...seen.values()].filter((n) => n > 1).length;
if (dups) problems.push(`${dups} pasos enviados dos veces al mismo lead`);
const followups = __DB.sent_emails.filter((r) => String(r.campaign_step_id).endsWith("-s1")).length;
if (__DB.sent_emails.length !== __SIM.smtp.length) problems.push(`entregas ${__SIM.smtp.length} ≠ filas en sent_emails ${__DB.sent_emails.length}`);
if (followups === 0 && DAYS.length >= 3) problems.push("no salió ningún seguimiento (paso 2)");
if (__SIM.errors.length) problems.push(...new Set(__SIM.errors));

quiet(`\ntotal entregas ${__SIM.smtp.length} · seguimientos ${followups} · pasos repetidos ${dups} · mayor lista en un .in(): ${__SIM.maxInIds} ids · ${Math.round((performance.now() - t0) / 1000)} s`);
quiet(problems.length ? `\nFALLA (${problems.length}):\n  - ${[...new Set(problems)].slice(0, 25).join("\n  - ")}` : "\nTODO CORRECTO");
Deno.exit(problems.length ? 1 : 0);

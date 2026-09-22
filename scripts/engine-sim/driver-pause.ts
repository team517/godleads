// ─── ENGINE SIM · pausar → quitar leads → poner leads → activar ─────────────────────────────
// SIM_DRIVER=driver-pause.ts bash scripts/engine-sim/run.sh
// Una campaña activa envía toda la mañana; a las 12:00 se PAUSA; a las 13:00 se le quitan TODOS
// los leads (como el botón "Eliminar todos" de la pestaña Leads: borra campaign_leads), se le
// ponen 3.000 leads nuevos + 50 de los antiguos (ya contactados) y se ACTIVA. Se comprueba que:
//   · en pausa no envía nada;
//   · al activar retoma en la pasada siguiente y contacta a los nuevos (paso 1);
//   · a los 50 repetidos NO les repite el paso 1 (ya lo recibieron) y pasan al seguimiento;
//   · al tercer día salen los seguimientos de los nuevos, desde el MISMO buzón que el paso 1;
//   · nadie recibe un paso dos veces y ningún buzón pasa de su límite.

// deno-lint-ignore-any
const ACC = 40, OLD_LEADS = 3000, NEW_LEADS = 3000, REPEAT = 50;
const mkAccounts = (prefix: string, n: number, userId: string, tag: string) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-acc-${String(i).padStart(4, "0")}`, user_id: userId, email: `buzon@${prefix}-dominio-${i}.com`,
    first_name: "Ana", last_name: "Ruiz", status: "connected", tags: [tag],
    smtp_host: "smtp.ionos.es", smtp_port: 587, smtp_username: `buzon@${prefix}-dominio-${i}.com`, smtp_password: "x",
    daily_limit: 30, sent_today: 0, last_send_at: null, warmup_enabled: false,
  }));
const mkLeads = (campaign: string, from: number, n: number) => {
  const rows = Array.from({ length: n }, (_, k) => { const i = from + k; return {
    id: `${campaign}-lead-${String(i).padStart(6, "0")}`, user_id: "user-a", email: `persona${i}@${campaign}-empresa-${i}.es`,
    custom_fields: { first_name: "Luis", company_name: `Empresa ${i}` }, status: "active",
  }; });
  __load("leads", rows);
  return rows;
};
const link = (campaign: string, leads: any[], tagId: string) => __load("campaign_leads", leads.map((l, i) => ({
  id: `${campaign}-cl-${tagId}-${String(i).padStart(6, "0")}`, campaign_id: campaign, lead_id: l.id, current_step: 0, status: "pending", last_sent_at: null, assigned_account_id: null,
})));

__load("email_accounts", mkAccounts("a", ACC, "user-a", "A"));
__load("campaigns", [{ id: "CAMP", user_id: "user-a", name: "CAMP", status: "active", timezone: "UTC", send_start_hour: 9, send_end_hour: 18,
  send_days: ["mon", "tue", "wed", "thu", "fri"], daily_limit: 0, account_tags: ["A"], stop_on_reply: true, include_unsubscribe: true, last_campaign_send_at: null }]);
__load("campaign_steps", [
  { id: "CAMP-s0", campaign_id: "CAMP", step_order: 0, delay_days: 0, subject: "Una idea para {{company_name}}", body: "Hola {{first_name}},\n\nOs escribo por {{company_name}}.\n\nUn saludo", variants: [], attachments: [] },
  { id: "CAMP-s1", campaign_id: "CAMP", step_order: 1, delay_days: 2, subject: "", body: "Hola {{first_name}}, ¿pudiste verlo?", variants: [], attachments: [] },
]);
const oldLeads = mkLeads("CAMP", 0, OLD_LEADS);
link("CAMP", oldLeads, "v1");

const problems: string[] = [];
const quiet = console.log; console.log = () => {};
const campaignRow = __DB.campaigns[0];
const tick = async (day: string, m: number) => {
  const hh = String(9 + Math.floor(m / 60)).padStart(2, "0"), mm = String(m % 60).padStart(2, "0");
  __setClock(`${day}T${hh}:${mm}:07Z`);
  const before = __SIM.smtp.length;
  const res = await __handler!(new Request("http://sim/process-campaign-queue", { method: "POST", body: "{}" }));
  const body = await res.json().catch(() => ({}));
  if (body?.error) problems.push(`${day} ${hh}:${mm} error del motor: ${body.error}`);
  return __SIM.smtp.length - before;
};
const sentTo = (emails: Set<string>, from: number) => __SIM.smtp.slice(from).filter((s) => emails.has(String(s.to).toLowerCase())).length;

// ── Día 1 ──
const DAY1 = "2026-09-22";
let morning = 0;
for (let m = 0; m < 180; m++) morning += await tick(DAY1, m);            // 9:00–12:00 activa
quiet(`día 1 · 9:00–12:00 activa: ${morning} envíos`);
if (morning < 100) problems.push(`la campaña activa apenas envió por la mañana (${morning})`);

campaignRow.status = "paused";
let paused = 0;
for (let m = 180; m < 240; m++) paused += await tick(DAY1, m);            // 12:00–13:00 en pausa
quiet(`día 1 · 12:00–13:00 en PAUSA: ${paused} envíos`);
if (paused !== 0) problems.push(`en pausa envió ${paused}`);

// Quitar TODOS los leads (borra campaign_leads), poner nuevos + 50 repetidos, activar.
const contactedOld = new Set(__SIM.smtp.map((s) => String(s.to).toLowerCase()));
const repeated = oldLeads.filter((l) => contactedOld.has(l.email.toLowerCase())).slice(0, REPEAT);
__DB.campaign_leads.length = 0; __IDX.campaign_leads = {};
const newLeads = mkLeads("CAMP", OLD_LEADS, NEW_LEADS);
link("CAMP", newLeads, "v2");
link("CAMP", repeated, "v2r");
campaignRow.status = "active";
const markAfterResume = __SIM.smtp.length;
const firstTick = await tick(DAY1, 240);
quiet(`día 1 · 13:00 ACTIVADA con ${NEW_LEADS} leads nuevos + ${REPEAT} repetidos: primera pasada envía ${firstTick}`);
if (firstTick === 0) problems.push("tras activar, la primera pasada no envió nada");
let afternoon = firstTick;
for (let m = 241; m < 540; m++) afternoon += await tick(DAY1, m);
const newEmails = new Set(newLeads.map((l) => l.email.toLowerCase()));
const repEmails = new Set(repeated.map((l) => l.email.toLowerCase()));
quiet(`día 1 · 13:00–18:00: ${afternoon} envíos · a leads NUEVOS ${sentTo(newEmails, markAfterResume)} · a REPETIDOS ${sentTo(repEmails, markAfterResume)} (deben ser 0: ya recibieron el paso 1)`);
if (sentTo(newEmails, markAfterResume) < 100) problems.push("tras activar no contactó a los leads nuevos");
if (sentTo(repEmails, markAfterResume) !== 0) problems.push(`repitió el paso 1 a ${sentTo(repEmails, markAfterResume)} leads que ya lo tenían`);
const repRows = __DB.campaign_leads.filter((cl) => repEmails.has(String(__IDX.leads.id.get(cl.lead_id)?.[0]?.email).toLowerCase()));
const repAdvanced = repRows.filter((cl) => cl.current_step >= 1 && cl.status === "in_progress").length;
quiet(`   repetidos que el motor reconoció y pasó al seguimiento sin reenviar: ${repAdvanced}/${REPEAT}`);

// ── Días 2 y 3 (sin pausa): día 3 salen los seguimientos de los nuevos ──
for (const [day, label] of [["2026-09-23", "día 2"], ["2026-09-24", "día 3"]] as const) {
  const mark = __SIM.smtp.length;
  let n = 0; for (let m = 0; m < 540; m++) n += await tick(day, m);
  const fu = __DB.sent_emails.filter((r) => r.campaign_step_id === "CAMP-s1" && new Date(r.sent_at).toISOString().startsWith(day)).length;
  quiet(`${label}: ${n} envíos · seguimientos (paso 2) ${fu} · a nuevos ${sentTo(newEmails, mark)}`);
  if (label === "día 3" && fu === 0) problems.push("el día 3 no salió ningún seguimiento de los leads nuevos");
}

// ── Invariantes ──
const seen = new Map<string, number>(); const firstFrom = new Map<string, string>();
for (const r of __DB.sent_emails) {
  const k = `${r.campaign_id}|${String(r.to_email).toLowerCase()}|${r.campaign_step_id}`; seen.set(k, (seen.get(k) || 0) + 1);
  const lk = `${r.campaign_id}|${String(r.to_email).toLowerCase()}`;
  if (!firstFrom.has(lk)) firstFrom.set(lk, r.account_id); else if (firstFrom.get(lk) !== r.account_id) problems.push(`seguimiento desde OTRO buzón: ${lk}`);
}
const dups = [...seen.values()].filter((n) => n > 1).length;
if (dups) problems.push(`${dups} pasos enviados dos veces a la misma persona`);
const perAccDay = new Map<string, number>();
for (const s of __SIM.smtp) { const k = `${s.from}|${new Date(s.at).toISOString().slice(0, 10)}`; perAccDay.set(k, (perAccDay.get(k) || 0) + 1); }
const over = [...perAccDay.values()].filter((n) => n > 30).length;
if (over) problems.push(`${over} buzón-día por encima de 30`);

quiet(`\ntotal ${__SIM.smtp.length} entregas · pasos repetidos ${dups} · buzón-día >30: ${over}`);
quiet(problems.length ? `\nFALLA (${problems.length}):\n  - ${[...new Set(problems)].join("\n  - ")}` : "\nTODO CORRECTO");
Deno.exit(problems.length ? 1 : 0);

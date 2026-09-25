// ─── ENGINE SIM · driver-empresa ────────────────────────────────────────────────────────────
// Ritmo por EMPRESA: a una misma empresa no le pueden llegar muchos correos el mismo día.
// Un cliente con 3 campañas. Cada campaña tiene 20 personas de "bigcorp.com" (60 en total, como
// airbus) y 60 personas de empresas distintas. Durante 5 días comprobamos:
//   · bigcorp.com recibe como mucho 3 correos al día, sumando las 3 campañas;
//   · entre dos correos a bigcorp.com pasan al menos 90 minutos;
//   · las demás empresas no se ven frenadas;
//   · bigcorp.com se sigue contactando día tras día (nadie se queda fuera para siempre);
//   · el correo personal (gmail) NO se trata como una empresa.
//   SIM_DRIVER=driver-empresa.ts bash scripts/engine-sim/run.sh
// deno-lint-ignore-file no-explicit-any

const CAMPANAS = ["C1", "C2", "C3"];
const DIAS = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];
const GRANDE = "bigcorp.com";

for (const c of CAMPANAS) {
  __load("email_accounts", Array.from({ length: 15 }, (_, i) => ({
    id: `${c}-acc-${i}`, user_id: "u1", email: `buzon@${c}-dominio-${i}.com`, first_name: "Ana", last_name: "Ruiz",
    status: "connected", tags: [c], smtp_host: "smtp.ionos.es", smtp_port: 587,
    smtp_username: `buzon@${c}-dominio-${i}.com`, smtp_password: "x",
    daily_limit: 30, sent_today: 0, last_send_at: null, warmup_enabled: false,
  })));
  __load("campaigns", [{
    id: c, user_id: "u1", name: c, status: "active", timezone: "UTC", send_start_hour: 9, send_end_hour: 18,
    send_days: ["mon", "tue", "wed", "thu", "fri"], daily_limit: 0, account_tags: [c],
    stop_on_reply: true, include_unsubscribe: false, last_campaign_send_at: null,
  }]);
  __load("campaign_steps", [
    { id: `${c}-s0`, campaign_id: c, step_order: 0, delay_days: 0, subject: "Hola {{company_name}}", body: "Hola {{first_name}}", variants: [], attachments: [] },
  ]);
  const leads = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `${c}-big-${i}`, email: `persona${i}.${c}@${GRANDE}` })),
    ...Array.from({ length: 60 }, (_, i) => ({ id: `${c}-otra-${i}`, email: `jefe@${c}-empresa-${i}.es` })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `${c}-gm-${i}`, email: `alguien${i}.${c}@gmail.com` })),
  ].map((l) => ({ ...l, user_id: "u1", custom_fields: { first_name: "Luis", company_name: "Empresa" }, status: "active" }));
  __load("leads", leads);
  __load("campaign_leads", leads.map((l) => ({
    id: `cl-${l.id}`, campaign_id: c, lead_id: l.id, current_step: 0, status: "pending", last_sent_at: null, assigned_account_id: null,
  })));
}

// Caso extremo: campaña C4 con 450 personas de bigcorp.com y sólo 50 de otras empresas.
__load("email_accounts", Array.from({ length: 15 }, (_, i) => ({
  id: `C4-acc-${i}`, user_id: "u1", email: `buzon@C4-dominio-${i}.com`, first_name: "Ana", last_name: "Ruiz",
  status: "connected", tags: ["C4"], smtp_host: "smtp.ionos.es", smtp_port: 587,
  smtp_username: `buzon@C4-dominio-${i}.com`, smtp_password: "x",
  daily_limit: 30, sent_today: 0, last_send_at: null, warmup_enabled: false,
})));
__load("campaigns", [{
  id: "C4", user_id: "u1", name: "C4", status: "active", timezone: "UTC", send_start_hour: 9, send_end_hour: 18,
  send_days: ["mon", "tue", "wed", "thu", "fri"], daily_limit: 0, account_tags: ["C4"],
  stop_on_reply: true, include_unsubscribe: false, last_campaign_send_at: null,
}]);
__load("campaign_steps", [{ id: "C4-s0", campaign_id: "C4", step_order: 0, delay_days: 0, subject: "Hola", body: "Hola", variants: [], attachments: [] }]);
const leadsC4 = [
  ...Array.from({ length: 450 }, (_, i) => ({ id: `C4-big-${String(i).padStart(3, "0")}`, email: `x${i}.c4@${GRANDE}` })),
  ...Array.from({ length: 50 }, (_, i) => ({ id: `C4-zz-${i}`, email: `jefe@C4-otra-${i}.es` })),
].map((l) => ({ ...l, user_id: "u1", custom_fields: { first_name: "Luis" }, status: "active" }));
__load("leads", leadsC4);
__load("campaign_leads", leadsC4.map((l) => ({ id: `cl-${l.id}`, campaign_id: "C4", lead_id: l.id, current_step: 0, status: "pending", last_sent_at: null, assigned_account_id: null })));

const quiet = console.log; console.log = () => {};
const problemas: string[] = [];
let bigTotal = 0, otrasDia1 = 0, gmailDia1 = 0;

for (const [n, dia] of DIAS.entries()) {
  const antes = __SIM.smtp.length;
  for (let m = 0; m < 9 * 60; m++) {
    const hh = String(9 + Math.floor(m / 60)).padStart(2, "0"), mm = String(m % 60).padStart(2, "0");
    __setClock(`${dia}T${hh}:${mm}:07Z`);
    const res = await __handler!(new Request("http://sim/x", { method: "POST", body: "{}" }));
    const body = await res.json().catch(() => ({}));
    if (body?.error) problemas.push(`${dia}: el motor devolvió error: ${body.error}`);
  }
  const hoy = __SIM.smtp.slice(antes);
  const big = hoy.filter((s: any) => String(s.to).endsWith(`@${GRANDE}`)).sort((a: any, b: any) => a.at - b.at);
  const otras = hoy.filter((s: any) => /-empresa-/.test(String(s.to))).length;
  const otrasC4 = hoy.filter((s: any) => /C4-otra-/.test(String(s.to))).length;
  if (n === 0 && otrasC4 < 50) problemas.push(`${dia}: la campaña casi entera de bigcorp se atascó — sólo ${otrasC4} de 50 a otras empresas`);
  const gmail = hoy.filter((s: any) => String(s.to).endsWith("@gmail.com")).length;
  bigTotal += big.length;
  if (n === 0) { otrasDia1 = otras; gmailDia1 = gmail; }
  let huecoMin = Infinity;
  for (let i = 1; i < big.length; i++) huecoMin = Math.min(huecoMin, (big[i].at - big[i - 1].at) / 60000);
  if (big.length > 3) problemas.push(`${dia}: ${GRANDE} recibió ${big.length} correos (máximo 3)`);
  if (big.length > 1 && huecoMin < 90) problemas.push(`${dia}: dos correos a ${GRANDE} con ${huecoMin.toFixed(0)} min de diferencia (mínimo 90)`);
  if (big.length === 0) problemas.push(`${dia}: ${GRANDE} no recibió ninguno — se ha quedado fuera`);
  quiet(`${dia} · total ${hoy.length} · a ${GRANDE}: ${big.length}${big.length > 1 ? ` (hueco mínimo ${huecoMin.toFixed(0)} min)` : ""} · a otras empresas: ${otras} · otras de C4: ${otrasC4} · a gmail: ${gmail}`);
}

if (otrasDia1 < 180) problemas.push(`las demás empresas se vieron frenadas: ${otrasDia1} de 180 el primer día`);
if (gmailDia1 < 30) problemas.push(`el correo personal se trató como una empresa: ${gmailDia1} de 30 el primer día`);
quiet(`\n${GRANDE}: ${bigTotal} de 60 personas contactadas en ${DIAS.length} días (el resto, en los siguientes)`);
quiet(problemas.length ? `FALLA:\n  - ${problemas.join("\n  - ")}` : "TODO CORRECTO: la empresa grande se contacta poco a poco y el resto no se frena");
Deno.exit(problemas.length ? 1 : 0);

// ─── ENGINE SIM · driver-responde ───────────────────────────────────────────────────────────
// ¿De verdad para la secuencia cuando alguien contesta?
// Día 1: la campaña escribe a 200 leads. Después 40 de ellos "contestan": la respuesta se guarda
// de tres formas distintas, como pasa en la vida real:
//   · atada al lead (lo normal),
//   · SIN lead, sólo con la dirección (la respuesta llegó de un correo que no supimos enlazar),
//   · atada a OTRA fila del mismo lead (hay leads duplicados con el mismo correo).
// Día 2 y 3: ninguno de esos 40 puede recibir el seguimiento.
//   SIM_DRIVER=driver-responde.ts bash scripts/engine-sim/run.sh
// deno-lint-ignore-file no-explicit-any

const N_BUZONES = 20, N_LEADS = 200, QUE_CONTESTAN = 40;
const DIAS: [string, number][] = [["2026-09-21", 0], ["2026-09-22", 1], ["2026-09-23", 2]];

__load("email_accounts", Array.from({ length: N_BUZONES }, (_, i) => ({
  id: `acc-${i}`, user_id: "u1", email: `buzon@dominio-${i}.com`, first_name: "Ana", last_name: "Ruiz",
  status: "connected", tags: ["C1"], smtp_host: "smtp.ionos.es", smtp_port: 587,
  smtp_username: `buzon@dominio-${i}.com`, smtp_password: "x",
  daily_limit: 30, sent_today: 0, last_send_at: null, warmup_enabled: false,
})));

__load("campaigns", [{
  id: "C1", user_id: "u1", name: "C1", status: "active", timezone: "UTC", send_start_hour: 9, send_end_hour: 18,
  send_days: ["mon", "tue", "wed", "thu", "fri"], daily_limit: 0, account_tags: ["C1"],
  stop_on_reply: true, include_unsubscribe: false, last_campaign_send_at: null,
}]);
__load("campaign_steps", [
  { id: "s0", campaign_id: "C1", step_order: 0, delay_days: 0, subject: "Hola {{company_name}}", body: "Hola {{first_name}}", variants: [], attachments: [] },
  { id: "s1", campaign_id: "C1", step_order: 1, delay_days: 1, subject: "", body: "¿Lo viste?", variants: [], attachments: [] },
  { id: "s2", campaign_id: "C1", step_order: 2, delay_days: 1, subject: "", body: "Último aviso", variants: [], attachments: [] },
]);

const leads = Array.from({ length: N_LEADS }, (_, i) => ({
  id: `lead-${i}`, user_id: "u1", email: `persona${i}@empresa-${i}.es`,
  custom_fields: { first_name: "Luis", company_name: `Empresa ${i}` }, status: "active",
}));
__load("leads", leads);
__load("campaign_leads", leads.map((l, i) => ({
  id: `cl-${i}`, campaign_id: "C1", lead_id: l.id, current_step: 0, status: "pending", last_sent_at: null, assigned_account_id: null,
})));
// Filas duplicadas del mismo correo (mismo lead, otra fila en la tabla de leads).
__load("leads", Array.from({ length: QUE_CONTESTAN }, (_, i) => ({
  id: `lead-dup-${i}`, user_id: "u1", email: `persona${i}@empresa-${i}.es`,
  custom_fields: { first_name: "Luis", company_name: `Empresa ${i}` }, status: "active",
})));

const quiet = console.log; console.log = () => {};
const contestaron = new Set<string>();
let enviosTrasContestar = 0;
const problemas: string[] = [];

for (const [dia, indice] of DIAS) {
  const antes = __SIM.smtp.length;
  for (let m = 0; m < 9 * 60; m++) {
    const hh = String(9 + Math.floor(m / 60)).padStart(2, "0"), mm = String(m % 60).padStart(2, "0");
    __setClock(`${dia}T${hh}:${mm}:07Z`);
    const res = await __handler!(new Request("http://sim/x", { method: "POST", body: "{}" }));
    const body = await res.json().catch(() => ({}));
    if (body?.error) problemas.push(`${dia}: el motor devolvió error: ${body.error}`);
  }
  const hoy = __SIM.smtp.slice(antes);
  for (const s of hoy) if (contestaron.has(String(s.to).toLowerCase())) enviosTrasContestar++;
  quiet(`${dia} · envíos ${hoy.length} · a gente que ya contestó: ${hoy.filter((s: any) => contestaron.has(String(s.to).toLowerCase())).length}`);

  // Al terminar el primer día, 40 personas contestan (de las tres formas).
  if (indice === 0) {
    for (let i = 0; i < QUE_CONTESTAN; i++) {
      const correo = `persona${i}@empresa-${i}.es`;
      contestaron.add(correo);
      const comun = { id: `in-${i}`, user_id: "u1", account_id: "acc-0", campaign_id: "C1", from_email: correo, subject: "Re: hola", body_text: "me interesa", received_at: `${dia}T18:30:00Z`, created_at: `${dia}T18:31:00Z`, is_warmup: false, is_archived: false };
      if (i % 3 === 0) __load("inbox_messages", [{ ...comun, lead_id: `lead-${i}` }]);               // atada al lead
      else if (i % 3 === 1) __load("inbox_messages", [{ ...comun, lead_id: null }]);                 // sólo la dirección
      else __load("inbox_messages", [{ ...comun, lead_id: `lead-dup-${i}` }]);                       // otra fila del mismo correo
    }
  }
}

if (enviosTrasContestar > 0) problemas.push(`${enviosTrasContestar} correos salieron a gente que YA había contestado`);
quiet(`\ntotal entregas ${__SIM.smtp.length} · contestaron ${contestaron.size} · envíos tras contestar ${enviosTrasContestar}`);
quiet(problemas.length ? `FALLA:\n  - ${problemas.join("\n  - ")}` : "TODO CORRECTO: nadie que contestó recibió un seguimiento");
Deno.exit(problemas.length ? 1 : 0);

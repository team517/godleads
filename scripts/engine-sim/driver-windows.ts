// ─── ENGINE SIM · driver-windows ────────────────────────────────────────────────────────────
// ¿Reparte el motor los envíos en el horario que ponga CADA campaña (no sólo 9-18)?
// Varias campañas con franjas y zonas horarias distintas; el reloj corre las 24 h minuto a minuto.
//   SIM_DRIVER=driver-windows.ts bash scripts/engine-sim/run.sh
// deno-lint-ignore-file no-explicit-any
const CASES = [
  { id: "V8a14", tz: "UTC", start: 8, end: 14, ramp: false },
  { id: "V10a20MAD", tz: "Europe/Madrid", start: 10, end: 20, ramp: false },
  { id: "V15a17", tz: "UTC", start: 15, end: 17, ramp: false },
  { id: "V9a18RAMPA", tz: "UTC", start: 9, end: 18, ramp: true },
  { id: "V7a22", tz: "America/New_York", start: 7, end: 22, ramp: false },
  // Se ACTIVA a las 13:00 del segundo día (franja 9-18): debe repartir de 13 a 18, sin ráfaga.
  { id: "V9a18ACT13", tz: "UTC", start: 9, end: 18, ramp: false, activateAt: 13 },
  { id: "RAMPA13", tz: "UTC", start: 9, end: 18, ramp: true, activateAt: 13 },
] as { id: string; tz: string; start: number; end: number; ramp: boolean; activateAt?: number }[];
const N_ACC = 12, N_LEADS = 2000, DAY = "2026-09-23"; // miércoles y jueves
for (const c of CASES) {
  __load("email_accounts", Array.from({ length: N_ACC }, (_, i) => ({
    id: `${c.id}-acc-${i}`, user_id: `u-${c.id}`, email: `buzon@${c.id}-dom-${i}.com`, first_name: "Ana", last_name: "Ruiz",
    status: "connected", tags: [c.id], smtp_host: "smtp.ionos.es", smtp_port: 587, smtp_username: `buzon@${c.id}-dom-${i}.com`, smtp_password: "x",
    daily_limit: 30, sent_today: 0, last_send_at: null,
    warmup_enabled: c.ramp, warmup_started_at: c.ramp ? "2026-09-20T00:00:00Z" : null, warmup_increment: 2, warmup_limit: 30, warmup_day: 2,
  })));
  __load("campaigns", [{ id: c.id, user_id: `u-${c.id}`, name: c.id, status: c.activateAt != null ? "paused" : "active", timezone: c.tz, send_start_hour: c.start, send_end_hour: c.end,
    send_days: ["mon", "tue", "wed", "thu", "fri"], daily_limit: 0, account_tags: [c.id], stop_on_reply: true, include_unsubscribe: true, last_campaign_send_at: null }]);
  __load("campaign_steps", [{ id: `${c.id}-s0`, campaign_id: c.id, step_order: 0, delay_days: 0, subject: "Hola {{company_name}}", body: "Hola {{first_name}}", variants: [], attachments: [] }]);
  const leads = Array.from({ length: N_LEADS }, (_, i) => ({ id: `${c.id}-l-${i}`, user_id: `u-${c.id}`, email: `p${i}@${c.id}-e${i}.es`, custom_fields: { first_name: "Luis", company_name: `E${i}` }, status: "active" }));
  __load("leads", leads);
  __load("campaign_leads", leads.map((l, i) => ({ id: `${c.id}-cl-${i}`, campaign_id: c.id, lead_id: l.id, current_step: 0, status: "pending", last_sent_at: null, assigned_account_id: null })));
}
const quiet = console.log; console.log = () => {};
__SIM.accountDays = 0;
// Dos días seguidos; sólo se mide el SEGUNDO (el primero arranca a mitad de alguna franja).
const t0 = Date.parse(`${DAY}T00:00:07Z`);
let day2Start = 0;
for (let m = 0; m < 48 * 60; m++) {
  if (m === 24 * 60) day2Start = __SIM.smtp.length;
  for (const c of CASES) if (c.activateAt != null && m === 24 * 60 + c.activateAt * 60) {
    const row = __DB.campaigns.find((x) => x.id === c.id); if (row) row.status = "active";
  }
  __setClock(new Date(t0 + m * 60_000).toISOString());
  await __handler!(new Request("http://sim/x", { method: "POST", body: "{}" }));
}
const local = (ms: number, tz: string) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms)); return p; };
const mins = (ms: number, tz: string) => { const [h, mm] = local(ms, tz).split(":").map(Number); return h * 60 + mm; };
const hhmm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(Math.round(x % 60)).padStart(2, "0")}`;
let bad = 0;
for (const c of CASES) {
  const sends = __SIM.smtp.slice(day2Start).filter((s) => s.from.includes(`@${c.id}-dom-`));
  const per: Record<string, number[]> = {};
  for (const s of sends) (per[s.from] ||= []).push(s.at);
  const out = sends.filter((s) => { const x = mins(s.at, c.tz); return x < c.start * 60 || x >= c.end * 60; }).length;
  let minGap = Infinity; const firsts: number[] = [], lasts: number[] = [], gaps: number[] = [], counts: number[] = [];
  for (const ats of Object.values(per)) {
    ats.sort((a, b) => a - b); counts.push(ats.length); firsts.push(mins(ats[0], c.tz)); lasts.push(mins(ats[ats.length - 1], c.tz));
    for (let i = 1; i < ats.length; i++) { const g = (ats[i] - ats[i - 1]) / 60000; minGap = Math.min(minGap, g); gaps.push(g); }
  }
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const perHour: Record<number, number> = {};
  for (const s of sends) { const h = Math.floor(mins(s.at, c.tz) / 60); perHour[h] = (perHour[h] || 0) + 1; }
  if (out > 0 || minGap < 6) bad++;
  if (c.activateAt != null) {
    const hours = Object.entries(perHour).map(([h, n]) => [Number(h), n] as [number, number]);
    const early = hours.filter(([h]) => h < c.activateAt!).reduce((a, [, n]) => a + n, 0);
    const vals = hours.filter(([h]) => h >= c.activateAt!).map(([, n]) => n);
    if (early > 0) { bad++; quiet(`  ✗ ${c.id}: envió antes de activarse`); }
    if (!c.ramp && vals.length && Math.max(...vals) > 1.5 * Math.min(...vals)) { bad++; quiet(`  ✗ ${c.id}: reparto desigual tras activarse (${vals.join("/")})`); }
  }
  quiet(`${c.id.padEnd(11)} franja ${c.start}-${c.end} ${c.tz.padEnd(16)} envíos ${String(sends.length).padStart(4)} · por buzón ${Math.min(...counts)}–${Math.max(...counts)} · primero ${hhmm(avg(firsts))} · último ${hhmm(avg(lasts))} · hueco medio ${avg(gaps).toFixed(0)} min · mínimo ${minGap.toFixed(1)} · fuera de franja ${out}`);
  quiet(`            por hora: ${Object.entries(perHour).map(([h, n]) => `${h}h ${n}`).join(" · ")}`);
}
quiet(bad ? `\nFALLA en ${bad} campañas` : "\nTODO CORRECTO: cada campaña envía sólo en su franja y con ≥6 min por buzón");
Deno.exit(bad ? 1 : 0);

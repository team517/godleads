// ─── ENGINE SIM · prelude ──────────────────────────────────────────────────────────────────
// Se antepone al código REAL de process-campaign-queue (ver run.sh). Sustituye sólo los bordes:
//   · serve()        → guarda el handler para llamarlo a mano, una vez por "minuto"
//   · createClient() → base de datos en memoria que imita a PostgREST (tope de 1.000 filas,
//                      URL demasiado larga → error, count/head, embed leads(*))
//   · sendSmtpEmail  → "servidor de correo" falso que apunta cada entrega
//   · Date           → reloj controlable (el motor decide ventana, esperas y rampa con la hora)
// Nada sale de la máquina y no se toca ninguna base de datos real.

// deno-lint-ignore-file no-explicit-any
const __RealDate = Date;
let __fakeNow = __RealDate.now();
class __FakeDate extends __RealDate {
  constructor(...a: any[]) { if (a.length === 0) super(__fakeNow); else super(...(a as [any])); }
  static now() { return __fakeNow; }
}
(globalThis as any).Date = __FakeDate;
const __setClock = (iso: string) => { __fakeNow = new __RealDate(iso).getTime(); };

// Puerta del cron: en la simulación siempre autorizada.
const cronOrServiceAuthorised = (_req: Request, _body: any) => true;
const unauthorized = (h: Record<string, string>) => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: h });

let __handler: ((req: Request) => Promise<Response>) | null = null;
const serve = (h: (req: Request) => Promise<Response>) => { __handler = h; };

// ── Base de datos en memoria ──
const __DB: Record<string, any[]> = {
  campaigns: [], campaign_steps: [], campaign_accounts: [], campaign_leads: [], leads: [],
  email_accounts: [], sent_emails: [], blocklist: [], inbox_messages: [], processing_locks: [],
};
const __INDEXED: Record<string, string[]> = {
  sent_emails: ["lead_id", "campaign_id", "to_email"], campaign_leads: ["id", "campaign_id"], leads: ["id"], email_accounts: ["id"],
  inbox_messages: ["lead_id"], blocklist: ["user_id"], campaign_steps: ["campaign_id"],
};
const __IDX: Record<string, Record<string, Map<any, any[]>>> = {};
const __indexRow = (t: string, row: any) => {
  for (const col of __INDEXED[t] || []) {
    ((__IDX[t] ||= {})[col] ||= new Map());
    const m = __IDX[t][col]; const k = col === "to_email" ? String(row[col] || "").toLowerCase() : row[col];
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(row);
  }
};
const __load = (t: string, rows: any[]) => { for (const r of rows) { __DB[t].push(r); __indexRow(t, r); } };
const __SIM = { maxUrlIds: 700, rowCap: 1000, inCalls: 0, maxInIds: 0, smtp: [] as any[], accountDays: 0, errors: [] as string[] };
let __uuidN = 0;
const __uuid = () => `00000000-0000-4000-8000-${String(++__uuidN).padStart(12, "0")}`;

class __Q {
  private filters: ((r: any) => boolean)[] = [];
  private eqs: [string, any][] = [];
  private orders: [string, boolean, boolean][] = [];
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: any = null;
  private wantCount = false; private head = false; private one: "maybe" | "single" | null = null;
  private embedLeads = false; private returning = false; private err: string | null = null;
  constructor(private t: string) {}
  select(cols = "*", opts: any = {}) {
    if (this.op !== "select") { this.returning = true; return this; }
    this.embedLeads = /leads\(\*\)/.test(cols);
    this.wantCount = !!opts.count; this.head = !!opts.head; return this;
  }
  insert(p: any) { this.op = "insert"; this.payload = p; return this; }
  update(p: any) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.eqs.push([c, v]); this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vals: any[]) {
    __SIM.inCalls++; __SIM.maxInIds = Math.max(__SIM.maxInIds, vals.length);
    if (vals.length > __SIM.maxUrlIds) this.err = `HTTP 400: URI too long (${vals.length} ids)`;
    const s = new Set(vals); this.filters.push((r) => s.has(r[c])); return this;
  }
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] >= v); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] <= v); return this; }
  ilike(c: string, v: string) { const x = v.replace(/\\/g, "").toLowerCase();
    if (__IDX[this.t]?.[c]) this.eqs.push([c, x]); // índice en minúsculas, como lower(to_email)
    this.filters.push((r) => String(r[c] || "").toLowerCase() === x); return this; }
  overlaps(c: string, vals: any[]) { this.filters.push((r) => (r[c] || []).some((x: any) => vals.includes(x))); return this; }
  order(c: string, o: any = {}) { this.orders.push([c, o.ascending !== false, !!o.nullsFirst]); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.rng = [a, b]; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }
  private candidates(): any[] {
    // El índice que deje MENOS candidatos (como haría el planificador).
    let best: any[] | null = null;
    for (const [c, v] of this.eqs) {
      const m = __IDX[this.t]?.[c]; if (!m) continue;
      const rows = m.get(v) || [];
      if (!best || rows.length < best.length) best = rows;
    }
    return best ?? __DB[this.t];
  }
  private run(): any {
    if (this.err) return { data: null, error: { message: this.err }, count: null };
    if (!__DB[this.t]) return { data: null, error: { message: `relation ${this.t} does not exist` }, count: null };
    if (this.op === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: any) => ({ id: __uuid(), created_at: new Date().toISOString(), ...p }));
      __load(this.t, rows);
      return { data: this.returning ? rows : null, error: null };
    }
    let rows = this.candidates().filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of rows) Object.assign(r, this.payload);
      const out = this.returning ? rows : null;
      return { data: this.one ? (rows[0] ?? null) : out, error: null };
    }
    if (this.op === "delete") { return { data: null, error: { message: "delete not expected in the engine" } }; }
    const total = rows.length;
    for (const [c, asc, nf] of [...this.orders].reverse()) {
      const cmp = (a: any, b: any) => {
        const x = a[c], y = b[c];
        if (x == null && y == null) return 0;
        if (x == null) return nf ? -1 : 1;
        if (y == null) return nf ? 1 : -1;
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      };
      let sorted = true;
      for (let i = 1; i < rows.length; i++) if (cmp(rows[i - 1], rows[i]) > 0) { sorted = false; break; }
      if (!sorted) rows = [...rows].sort(cmp);
    }
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    rows = rows.slice(0, __SIM.rowCap); // PostgREST corta aquí sin avisar
    if (this.embedLeads) rows = rows.map((r) => ({ ...r, leads: (__IDX.leads.id.get(r.lead_id) || [null])[0] }));
    rows = rows.map((r) => ({ ...r })); // la API devuelve copias, nunca la fila viva
    if (this.one) return { data: rows[0] ?? null, error: null };
    return { data: this.head ? null : rows, error: null, count: this.wantCount ? total : null };
  }
  then(res: (v: any) => any, rej?: (e: any) => any) { try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } }
}

const createClient = (_u?: string, _k?: string) => ({
  from: (t: string) => new __Q(t),
  storage: { from: () => ({ download: async () => ({ data: null, error: { message: "no storage in sim" } }) }) },
  rpc: async (name: string, args: any) => {
    if (name === "acquire_job_lock") return { data: true, error: null };
    if (name === "release_job_lock") return { data: null, error: null };
    if (name === "account_sending_days") return { data: (args.p_account_ids as string[]).map((id) => ({ account_id: id, days: __SIM.accountDays })), error: null };
    if (name === "increment_account_sent") {
      const a = __IDX.email_accounts.id.get(args.p_account_id)?.[0];
      if (a) { a.sent_today = (a.sent_today || 0) + 1; a.last_send_at = new Date().toISOString(); }
      return { data: null, error: null };
    }
    if (name === "suppress_email_global") return { data: null, error: null };
    if (name === "user_company_sends_today") {
      // Lo que ya recibió hoy cada empresa de este cliente (todas sus campañas).
      const porDom = new Map<string, { n: number; ultimo: string }>();
      for (const r of __DB.sent_emails) {
        if (r.user_id !== args.p_user || r.status !== "sent" || !r.sent_at || r.sent_at < args.p_since) continue;
        const d = String(r.to_email || "").split("@")[1]?.toLowerCase() || "";
        if (!d) continue;
        const e = porDom.get(d) || { n: 0, ultimo: "" };
        porDom.set(d, { n: e.n + 1, ultimo: r.sent_at > e.ultimo ? r.sent_at : e.ultimo });
      }
      return { data: [...porDom].map(([dom, e]) => ({ dom, n: e.n, ultimo: e.ultimo })), error: null };
    }
    __SIM.errors.push(`rpc desconocida: ${name}`);
    return { data: null, error: { message: `unknown rpc ${name}` } };
  },
});

// "Servidor de correo" falso: apunta quién envía a quién y en qué minuto.
async function sendSmtpEmail(_host: string, _port: number, user: string, _pass: string, from: string, to: string, subject: string, ..._rest: any[]) {
  __SIM.smtp.push({ at: __fakeNow, from: from || user, to, subject });
  return { ok: true, messageId: `<sim-${__SIM.smtp.length}@${(from || user).split("@")[1]}>` };
}

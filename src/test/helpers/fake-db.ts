// Base de datos en memoria con lo justo de la API de supabase-js que usa el agente de PulseBot
// (supabase/functions/ia-modificaciones/agente.ts). Sirve para ejecutar el código REAL del
// servidor en las pruebas sin tocar la base de datos de producción.
export type Fila = Record<string, any>;

export function crearDb(inicial: Record<string, Fila[]>, bloqueados: string[] = [], rpcs: Record<string, any> = {}) {
  const t: Record<string, Fila[]> = {};
  for (const [k, v] of Object.entries(inicial)) t[k] = v.map((x) => ({ ...x }));
  const tabla = (n: string) => (t[n] ||= []);
  let sec = 0;
  const nuevoId = () => `id-${++sec}`;

  class Q {
    filtros: ((f: Fila) => boolean)[] = [];
    op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    payload: any; cols = "*"; opts: any = {}; unico: "" | "single" | "maybe" = ""; lim = Infinity;
    constructor(public nombre: string) {}
    select(cols = "*", opts: any = {}) { if (this.op === "select") { this.cols = cols; this.opts = opts; } return this; }
    insert(p: any) { this.op = "insert"; this.payload = Array.isArray(p) ? p : [p]; return this; }
    upsert(p: any, o: any) { this.op = "upsert"; this.payload = Array.isArray(p) ? p : [p]; this.opts = o || {}; return this; }
    update(p: any) { this.op = "update"; this.payload = p; return this; }
    delete() { this.op = "delete"; return this; }
    campo(f: Fila, c: string) { return c.includes(".") ? c.split(".").reduce((o: any, k) => o?.[k], f) : f[c]; }
    eq(c: string, v: any) { this.filtros.push((f) => this.campo(f, c) === v); return this; }
    in(c: string, v: any[]) { this.filtros.push((f) => v.includes(this.campo(f, c))); return this; }
    lte(c: string, v: any) { this.filtros.push((f) => this.campo(f, c) <= v); return this; }
    gte(c: string, v: any) { this.filtros.push((f) => this.campo(f, c) >= v); return this; }
    is(c: string, v: any) { this.filtros.push((f) => (this.campo(f, c) ?? null) === v); return this; }
    or(expr: string) { if (/is_warmup/.test(expr)) this.filtros.push((f) => !f.is_warmup); return this; }
    not() { return this; }
    contains(c: string, v: any[]) { this.filtros.push((f) => v.every((x) => (f[c] || []).includes(x))); return this; }
    order(c?: string, o?: { ascending?: boolean }) {
      if (c) this.orden = { c, asc: o?.ascending !== false };
      return this;
    }
    orden: { c: string; asc: boolean } | null = null;
    limit(n: number) { this.lim = n; return this; }
    single() { this.unico = "single"; return this; }
    maybeSingle() { this.unico = "maybe"; return this; }
    filas(): Fila[] {
      let base = tabla(this.nombre);
      if (this.nombre === "campaign_leads" && this.cols.includes("leads!inner")) {
        base = base.map((cl) => ({ ...cl, leads: tabla("leads").find((l) => l.id === cl.lead_id) })).filter((x) => x.leads);
      }
      let out = base.filter((f) => this.filtros.every((p) => p(f)));
      if (this.orden) {
        const { c, asc } = this.orden;
        out = [...out].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      return out;
    }
    ejecutar() {
      if (this.op === "insert") {
        const hechas: Fila[] = [];
        for (const p of this.payload) {
          if (this.nombre === "leads" && bloqueados.includes(p.email)) continue; // trigger de la blocklist
          const f: Fila = { id: nuevoId(), created_at: new Date().toISOString(), ...p };
          if (this.nombre === "campaign_leads") Object.assign(f, { current_step: 0, status: "pending" }, p);
          tabla(this.nombre).push(f); hechas.push(f);
        }
        return { data: this.unico ? hechas[0] : hechas, error: null };
      }
      if (this.op === "upsert") {
        for (const p of this.payload) {
          const ya = tabla(this.nombre).find((f) => f.campaign_id === p.campaign_id && f.lead_id === p.lead_id);
          if (!ya) tabla(this.nombre).push({ id: nuevoId(), current_step: 0, status: "pending", ...p });
        }
        return { data: null, error: null };
      }
      if (this.op === "update") { for (const f of this.filas()) Object.assign(f, this.payload); return { data: null, error: null }; }
      if (this.op === "delete") { const fuera = new Set(this.filas()); t[this.nombre] = tabla(this.nombre).filter((f) => !fuera.has(f)); return { data: null, error: null }; }
      // Como la base de datos real: se devuelven COPIAS, no los objetos guardados.
      const filas = this.filas().slice(0, this.lim).map((f) => JSON.parse(JSON.stringify(f)));
      if (this.opts?.head) return { data: null, count: filas.length, error: null };
      if (this.unico) return { data: filas[0] ?? null, error: null };
      return { data: filas, count: filas.length, error: null };
    }
    then(ok: any, ko: any) { return Promise.resolve(this.ejecutar()).then(ok, ko); }
  }
  return {
    t,
    from: (n: string) => new Q(n),
    // Una RPC simulada puede ser un dato fijo o una función (args, tablas) → dato.
    rpc: async (n: string, args: any) => {
      if (!(n in rpcs)) return { data: null, error: { message: "rpc no simulada" } };
      const r = rpcs[n];
      return { data: typeof r === "function" ? r(args, t) : r, error: null };
    },
  };
}

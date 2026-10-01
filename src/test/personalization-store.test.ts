import { describe, expect, it } from "vitest";
import { TANDA_BYTES, crearTrabajo, leerResultados, leerTrabajo, trocear, type Fila } from "@/lib/personalization-store";

/* Un CSV de miles de leads ya no viaja en una sola petición ("Failed to fetch"): se sube por
   tandas pequeñas y se lee por páginas. Base de datos de mentira, lo justo para estas consultas. */

function fakeDb(opts: { failRows?: boolean } = {}) {
  const jobs: any[] = [];
  const filas: any[] = [];
  const peticiones: { tabla: string; op: string; bytes: number; n: number }[] = [];
  const from = (tabla: string) => {
    const st: any = { tabla, filtros: [] as [string, any][], rango: null as null | [number, number] };
    const q: any = {
      insert(row: any) { st.op = "insert"; st.payload = row; return q; },
      upsert(rows: any[]) { st.op = "upsert"; st.payload = rows; return q; },
      update(v: any) { st.op = "update"; st.payload = v; return q; },
      delete() { st.op = "delete"; return q; },
      select(cols: string) { st.cols = cols; st.op = st.op || "select"; return q; },
      eq(k: string, v: any) { st.filtros.push([k, v]); return q; },
      order() { return q; },
      range(a: number, b: number) { st.rango = [a, b]; return q; },
      single() { return q.then((r: any) => r); },
      maybeSingle() { return q.then((r: any) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data })); },
      then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej); },
    };
    const pasa = (r: any) => st.filtros.every(([k, v]: [string, any]) => r[k] === v);
    const run = () => {
      const data = tabla === "personalization_csv_jobs" ? jobs : filas;
      if (st.op === "insert") { const row = { id: `job-${jobs.length + 1}`, ...st.payload }; jobs.push(row); peticiones.push({ tabla, op: "insert", bytes: JSON.stringify(st.payload).length, n: 1 }); return { data: row, error: null }; }
      if (st.op === "upsert") {
        peticiones.push({ tabla, op: "upsert", bytes: JSON.stringify(st.payload).length, n: st.payload.length });
        if (opts.failRows) return { data: null, error: { message: "Failed to fetch" } };
        for (const r of st.payload) if (!filas.some((f) => f.job_id === r.job_id && f.idx === r.idx)) filas.push({ message: null, error: null, done: false, ...r });
        return { data: null, error: null };
      }
      if (st.op === "update") { data.filter(pasa).forEach((r: any) => Object.assign(r, st.payload)); return { data: null, error: null }; }
      if (st.op === "delete") { for (let i = data.length - 1; i >= 0; i--) if (pasa(data[i])) data.splice(i, 1); return { data: null, error: null }; }
      let out = data.filter(pasa).sort((a: any, b: any) => (a.idx ?? 0) - (b.idx ?? 0));
      if (st.rango) out = out.slice(st.rango[0], st.rango[1] + 1);
      return { data: out, error: null };
    };
    return q;
  };
  return { db: { from }, jobs, filas, peticiones };
}

const csv = (n: number): Fila[] => Array.from({ length: n }, (_, i) => ({
  __idx: i, first_name: `Lead ${i}`, organization_name: `Empresa ${i}`, descripcion: "x".repeat(3000),
} as unknown as Fila));
const base = { user_id: "u1", filename: "leads.csv", prompt: "Hola {first_name}", provider: "deepseek", email_column: "email", columns: ["first_name"] };

describe("personalización: subida y lectura de CSV grandes", () => {
  it("trocea sin pasarse de tamaño ni de filas y sin perder ni desordenar nada", () => {
    const filas = csv(1000);
    const tandas = trocear(filas);
    expect(tandas.flat()).toEqual(filas);
    for (const t of tandas) {
      expect(t.length).toBeLessThanOrEqual(300);
      expect(JSON.stringify(t).length).toBeLessThan(TANDA_BYTES * 1.1);
    }
    expect(trocear([{ a: "y".repeat(2_000_000) }, { a: "z" }])).toHaveLength(2); // una fila enorme va sola
  });

  it("13.000 leads suben en peticiones pequeñas y el trabajo queda listo para generarse", async () => {
    const { db, jobs, filas, peticiones } = fakeDb();
    const progreso: number[] = [];
    const id = await crearTrabajo(db, base, csv(13000), (h) => progreso.push(h));
    expect(jobs[0]).toMatchObject({ id, storage: "rows", status: "pending", total: 13000, rows: [], results: {} });
    expect(filas).toHaveLength(13000);
    expect(new Set(filas.map((f) => f.idx)).size).toBe(13000);
    expect(filas[42]).toMatchObject({ job_id: id, idx: 42, done: false });
    expect(filas[42].data.first_name).toBe("Lead 42");
    expect(filas[42].data.__idx).toBeUndefined();
    expect(Math.max(...peticiones.map((p) => p.bytes))).toBeLessThan(700_000);   // ninguna de 40 MB
    expect(progreso[progreso.length - 1]).toBe(13000);
  });

  it("si la subida falla del todo, no deja un trabajo a medias", async () => {
    const { db, jobs } = fakeDb({ failRows: true });
    await expect(crearTrabajo(db, base, csv(50))).rejects.toThrow(/Failed to fetch/);
    expect(jobs).toHaveLength(0);
  }, 20000);

  it("lee el trabajo por páginas y junta cada mensaje con su lead", async () => {
    const { db, filas } = fakeDb();
    const id = await crearTrabajo(db, base, csv(2500));
    filas.filter((f) => f.idx < 2100).forEach((f) => Object.assign(f, { done: true, message: `Hola Lead ${f.idx}` }));
    filas[7].error = "DeepSeek 500"; filas[7].message = "";
    const { rows, results } = await leerTrabajo(db, id);
    expect(rows).toHaveLength(2500);
    expect(rows[2400].__idx).toBe(2400);
    expect(Object.keys(results)).toHaveLength(2100);
    expect(results["1234"]).toEqual({ message: "Hola Lead 1234" });
    expect(results["7"]).toEqual({ message: "", error: "DeepSeek 500" });
    expect(await leerResultados(db, id)).toEqual(results);
  });

  it("los trabajos antiguos (todo dentro del trabajo) se siguen leyendo", async () => {
    const { db, jobs } = fakeDb();
    jobs.push({ id: "viejo", storage: "json", total: 1, rows: [{ __idx: 0, first_name: "Ana" }], results: { "0": { message: "Hola Ana" } } });
    expect(await leerTrabajo(db, "viejo")).toEqual({ rows: [{ __idx: 0, first_name: "Ana" }], results: { "0": { message: "Hola Ana" } } });
    expect(await leerResultados(db, "viejo")).toEqual({ "0": { message: "Hola Ana" } });
  });
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { cronOrServiceAuthorised, userFromRequest, unauthorized } from "../_shared/cron-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PERSONALIZE_SYSTEM, promptForLead, generatePersonalized } from "../_shared/personalize-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Cuántas personalizaciones lleva a la vez una misma pasada (cada una con 5 leads en vuelo). */
const MAX_JOBS = 4;
const CONCURRENCY = 5;
const MAX_MS = 90_000;
const MAX_ROWS = 120;
/** Un trabajo "running" sin avanzar en este tiempo se da por parado y se puede retomar. Un grupo de
 *  5 leads puede tardar más de un minuto si la IA va lenta; con 60 s otro proceso lo daba por
 *  muerto y se ponía a generar los mismos leads a la vez. */
const STALE_MS = 120_000;
/** Pasadas en las que se reintenta un lead al que le falla la IA antes de darlo por error. Cada
 *  pasada ya hace 3 intentos seguidos, así que un lead sólo queda en error tras 12 intentos. */
const MAX_INTENTOS = 4;
/** Lo que hace falta del trabajo para procesarlo — SIN sus celdas pesadas (rows / results). */
const JOB_COLS = "id, user_id, prompt, provider, storage, total, done, ok, failed";

type Results = Record<string, { message: string; error?: string }>;
type Fila = { idx: number; data: Record<string, any>; attempts?: number };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const reqBody = await req.json().catch(() => ({}));
  let onlyUser: string | null = null;
  if (!cronOrServiceAuthorised(req, reqBody)) {
    const user = await userFromRequest(req);
    if (!user) return unauthorized(corsHeaders);
    onlyUser = user.id; // el botón de Personalización empuja SUS trabajos, no los de otros
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY");
  const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
  const jobs = () => db.from("personalization_csv_jobs");
  const ahora = () => new Date().toISOString();

  /** Una tanda de UN trabajo: hasta 120 leads o 90 s. Devuelve cómo ha quedado. */
  const procesar = async (job: any) => {
    const provider = job.provider === "claude" && claudeKey ? "claude" : "deepseek";
    if (provider === "deepseek" && !deepseekKey) {
      await jobs().update({ status: "error", updated_at: ahora() }).eq("id", job.id);
      return { job_id: job.id, error: "DEEPSEEK_API_KEY missing" };
    }
    const system = PERSONALIZE_SYSTEM;
    const gen = (p: string) => generatePersonalized({ provider: provider as "claude" | "deepseek", deepseekKey, claudeKey, system, userPrompt: p, temperature: 0.7, retries: 2 });
    const porFilas = job.storage === "rows";

    // ── De dónde salen los leads pendientes y dónde se guarda cada mensaje ──
    let pendientes: Fila[] = [];
    let total = Number(job.total) || 0;
    const results: Results = {};              // sólo trabajos antiguos (todo en una celda)
    let done = Number(job.done) || 0, ok = Number(job.ok) || 0, failed = Number(job.failed) || 0;

    if (porFilas) {
      // Cada lead es una fila: se piden sólo los que faltan, y sólo los de esta tanda.
      // Primero los que nunca se han intentado; los que fallaron, después (no frenan al resto).
      const { data, error } = await db.from("personalization_csv_rows").select("idx, data, attempts")
        .eq("job_id", job.id).eq("done", false)
        .order("attempts", { ascending: true }).order("idx", { ascending: true }).limit(MAX_ROWS);
      if (error) throw new Error(error.message);
      pendientes = (data || []) as Fila[];
    } else {
      const { data: pesado } = await jobs().select("rows, results").eq("id", job.id).maybeSingle();
      const rows: { __idx: number; [k: string]: any }[] = Array.isArray((pesado as any)?.rows) ? (pesado as any).rows : [];
      Object.assign(results, (pesado as any)?.results || {});
      total = rows.length;
      pendientes = rows.filter((r) => !(String(r.__idx) in results)).map(({ __idx, ...data }) => ({ idx: __idx, data }));
    }

    /** Recuento exacto (trabajos por filas: se cuenta en la tabla; antiguos: en la celda). */
    const recontar = async () => {
      if (!porFilas) {
        done = Object.keys(results).length;
        ok = Object.values(results).filter((x) => x.message && !x.error).length;
        failed = Object.values(results).filter((x) => x.error).length;
        return;
      }
      const cuenta = async (q: any) => (await q).count || 0;
      const base = () => db.from("personalization_csv_rows").select("idx", { count: "exact", head: true }).eq("job_id", job.id);
      [total, done, failed] = await Promise.all([cuenta(base()), cuenta(base().eq("done", true)), cuenta(base().eq("done", true).not("error", "is", null))]);
      ok = done - failed;
    };

    const startMs = Date.now();
    let processed = 0;
    for (let i = 0; i < pendientes.length && processed < MAX_ROWS && (Date.now() - startMs) < MAX_MS; i += CONCURRENCY) {
      // Respect a Stop pressed mid-run: re-read status each group (~5 rows apart) and, if the
      // user cancelled, save whatever is done and BAIL — without ever writing "running" again.
      // This clobber (progress write resurrecting a cancelled job) was why "Parar" no paraba.
      const { data: cur } = await jobs().select("status").eq("id", job.id).maybeSingle();
      if (!cur) return { job_id: job.id, deleted: true }; // lo han borrado del registro a mitad
      if ((cur as any).status === "cancelled") {
        await recontar();
        await jobs().update({ ...(porFilas ? {} : { results }), done, ok, failed, updated_at: ahora() }).eq("id", job.id).eq("status", "cancelled");
        return { job_id: job.id, cancelled: true };
      }
      const chunk = pendientes.slice(i, i + CONCURRENCY);
      // UN lead = UNA llamada a la IA con SUS datos; el resultado se guarda en SU fila / su idx.
      const settled = await Promise.allSettled(chunk.map((r) => gen(promptForLead(job.prompt, r.data))));
      const salidas = settled.map((s, j) => {
        const intentos = (chunk[j].attempts || 0) + 1;
        const error = s.status === "fulfilled" ? null : String((s as PromiseRejectedResult).reason).slice(0, 200);
        return {
          idx: chunk[j].idx, intentos,
          message: s.status === "fulfilled" ? s.value : "",
          error,
          // Un fallo NO cierra el lead: se queda pendiente y se reintenta en otra pasada.
          cerrado: !error || intentos >= MAX_INTENTOS,
        };
      });
      if (porFilas) {
        await Promise.all(salidas.map((o) =>
          db.from("personalization_csv_rows").update({ message: o.message, error: o.error, done: o.cerrado, attempts: o.intentos }).eq("job_id", job.id).eq("idx", o.idx)));
        done += salidas.filter((o) => o.cerrado).length;
        failed += salidas.filter((o) => o.cerrado && o.error).length;
        ok = done - failed;
      } else {
        for (const o of salidas) results[String(o.idx)] = o.error ? { message: "", error: o.error } : { message: o.message };
        await recontar();
      }
      processed += chunk.length;
      // Progreso tras cada grupo → se ve en vivo y aguanta una caída.
      // `.neq(cancelled)` so a Stop that lands during the await above is never overwritten.
      await jobs().update({
        ...(porFilas ? {} : { results }), done, ok, failed, total,
        status: done >= total ? "completed" : "running",
        updated_at: ahora(),
      }).eq("id", job.id).neq("status", "cancelled");
    }

    await recontar(); // el número exacto, por si otro proceso tocó el mismo trabajo
    if (total > 0 && done >= total) {
      await jobs().update({ status: "completed", done, ok, failed, total, updated_at: ahora() }).eq("id", job.id).neq("status", "cancelled");
    } else {
      // Tanda terminada y quedan leads: se SUELTA el trabajo (pending) para que la siguiente pasada
      // lo coja ya. Si se quedara en "running" habría que esperar a que se diera por parado.
      await jobs().update({ status: "pending", done, ok, failed, total, updated_at: ahora() }).eq("id", job.id).eq("status", "running");
    }
    return { job_id: job.id, processed, done, total };
  };

  try {
    // Candidatos: pendientes, o "running" que llevan parados demasiado (→ se retoman). Se miran
    // primero los que más llevan esperando, así varias personalizaciones avanzan a la par.
    // ("uploading" = todavía se están subiendo sus leads: no se toca.)
    const staleIso = new Date(Date.now() - STALE_MS).toISOString();
    const disponible = `status.eq.pending,and(status.eq.running,updated_at.lt.${staleIso})`;
    let q = jobs().select("id").or(disponible).order("updated_at", { ascending: true }).limit(MAX_JOBS);
    if (onlyUser) q = q.eq("user_id", onlyUser);
    const { data: candidatos } = await q;
    if (!candidatos?.length) return json({ ok: true, idle: true });

    // La reserva es ATÓMICA: cada trabajo lo consigue UN solo proceso (el cron y el botón de la
    // página pueden llegar a la vez). Los que ya tiene otro proceso se dejan pasar.
    const tandas = await Promise.all(candidatos.map(async ({ id }: { id: string }) => {
      const { data: claimed } = await jobs()
        .update({ status: "running", updated_at: ahora() })
        .eq("id", id).or(disponible)
        .select(JOB_COLS);
      const job = claimed?.[0];
      if (!job) return null;
      try { return await procesar(job); }
      catch (e) {
        // Que un fallo no deje el trabajo "running" dos minutos: se suelta para reintentar.
        await jobs().update({ status: "pending", updated_at: ahora() }).eq("id", id).eq("status", "running");
        return { job_id: id, error: e instanceof Error ? e.message : "error" };
      }
    }));
    const hechas = tandas.filter(Boolean);
    if (!hechas.length) return json({ ok: true, idle: true, taken: true });
    return json({ ok: true, jobs: hechas, ...(hechas.length === 1 ? hechas[0] : {}) });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" });
  }
});

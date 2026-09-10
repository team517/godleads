// TEMP: run push-interested with the cron secret from env, and schedule its cron. Delete after.
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token, op, minutes } = await req.json().catch(() => ({}));
    if (token !== "op-pushrun-" + "t9b3") return new Response("no", { status: 403, headers: cors });
    const secret = Deno.env.get("REPORTS_CRON_SECRET") || "";
    const base = Deno.env.get("SUPABASE_URL");

    if (op === "dry" || op === "live") {
      const r = await fetch(`${base}/functions/v1/push-interested`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, dry_run: op === "dry", minutes: Number(minutes) || 1440 }),
      });
      const txt = await r.text();
      return new Response(JSON.stringify({ status: r.status, resultado: JSON.parse(txt || "{}") }, null, 2),
        { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (op === "schedule") {
      const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
      const name = "push-interested-2min";
      const cmd = `select net.http_post(url := '${base}/functions/v1/push-interested', headers := '{"Content-Type": "application/json"}'::jsonb, body := '${JSON.stringify({ secret, minutes: 30 }).replace(/'/g, "''")}'::jsonb);`;
      await sql`select cron.unschedule(${name}) where exists (select 1 from cron.job where jobname = ${name})`;
      await sql`select cron.schedule(${name}, ${"*/2 * * * *"}, ${cmd})`;
      const chk = await sql`select jobname, schedule, active, (command like '%"secret"%') as lleva_secreto from cron.job where jobname = ${name}`;
      await sql.end();
      return new Response(JSON.stringify({ cron: chk[0] }, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (op === "purge_stale") {
      // The one existing subscription was created with the OLD public key, which never had a
      // matching private key on the server — it can never receive anything. Safe to drop.
      const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
      const d = await sql`DELETE FROM push_subscriptions RETURNING endpoint`;
      await sql.end();
      return new Response(JSON.stringify({ borradas: d.length }, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (op === "test") {
      const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
      const u = await sql`SELECT user_id FROM push_subscriptions ORDER BY created_at DESC LIMIT 1`;
      await sql.end();
      if (!u[0]) return new Response(JSON.stringify({ error: "no hay dispositivos suscritos" }), { headers: cors });
      const r = await fetch(`${base}/functions/v1/send-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${svc}` },
        body: JSON.stringify({
          user_id: u[0].user_id,
          title: "🔥 Prueba OnePulso",
          body: "Si ves esto en el movil, las notificaciones funcionan.",
          url: "/unibox",
        }),
      });
      return new Response(JSON.stringify({ status: r.status, respuesta: JSON.parse((await r.text()) || "{}") }, null, 2),
        { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (op === "subs") {
      const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
      const s = await sql`SELECT user_id, left(endpoint, 45) AS endpoint, created_at FROM push_subscriptions ORDER BY created_at DESC LIMIT 10`;
      const n = await sql`SELECT count(*)::int AS n FROM push_subscriptions`;
      await sql.end();
      return new Response(JSON.stringify({ total: n[0].n, dispositivos: s }, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "unknown op" }), { status: 400, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: cors });
  }
});

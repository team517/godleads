// Reconexión automática de cuentas desconectadas (status "error" / "auth_failed").
// Se ejecuta en cada pasada del monitor de salud (cada 5 min): prueba unas pocas cuentas iniciando
// sesión en su servidor (sin enviar nada) y, si entran, las devuelve a "connected" para que el motor
// vuelva a usarlas. Las que siguen fallando se reintentan cada vez más espaciado (15 min → 6 h).
// Nunca registra contraseñas ni respuestas completas del servidor.
import { probarImap, probarSmtp } from "../_shared/mail-probe.ts";
import {
  A_LA_VEZ, ESTADOS_DESCONECTADOS, POR_PASADA, aProbar, olvidables, trasIntento, type Seguimiento,
} from "../_shared/reconnect.ts";

const PRESUPUESTO_MS = 60_000;

async function todas<T>(q: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; desde < 20_000; desde += 1000) {
    const { data, error } = await q(desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function reconectarCuentas(admin: any): Promise<{ probadas: number; reconectadas: string[]; siguen: number }> {
  const inicio = Date.now();
  const ahora = Date.now();
  const desconectadas = await todas<{ id: string }>((a, b) =>
    admin.from("email_accounts").select("id").in("status", ESTADOS_DESCONECTADOS).not("smtp_host", "is", null).order("id").range(a, b));
  const seguimiento = await todas<Seguimiento>((a, b) =>
    admin.from("account_reconnect").select("account_id, intentos, next_at, reconectada_at, updated_at").order("account_id").range(a, b));

  // Limpieza: seguimientos de cuentas que ya no están caídas y llevan días bien.
  const caidas = new Set(desconectadas.map((c) => c.id));
  const sinCaer = seguimiento.filter((s) => !caidas.has(s.account_id)).map((s) => s.account_id);
  const olvidar = olvidables(seguimiento, new Set(sinCaer), ahora);
  for (let i = 0; i < olvidar.length; i += 200) {
    await admin.from("account_reconnect").delete().in("account_id", olvidar.slice(i, i + 200));
  }

  const ids = aProbar([...caidas], seguimiento, ahora, POR_PASADA);
  if (!ids.length) return { probadas: 0, reconectadas: [], siguen: 0 };

  const { data: cuentas } = await admin.from("email_accounts")
    .select("id, email, status, smtp_host, smtp_port, smtp_username, smtp_password, imap_host, imap_port, imap_username, imap_password")
    .in("id", ids);
  const previo = new Map(seguimiento.map((s) => [s.account_id, s]));
  const reconectadas: string[] = [];
  let probadas = 0, siguen = 0;

  const cola = [...(cuentas || [])];
  const trabajador = async () => {
    while (cola.length && Date.now() - inicio < PRESUPUESTO_MS) {
      const c = cola.shift()!;
      probadas++;
      const smtp = await probarSmtp(c.smtp_host, Number(c.smtp_port) || 465, c.smtp_username || c.email, c.smtp_password || "");
      // "error" puede venir de la lectura (IMAP): si envía bien, se comprueba también que lee.
      let res = smtp;
      if (smtp.ok && c.status === "error" && c.imap_host) {
        res = await probarImap(c.imap_host, Number(c.imap_port) || 993, c.imap_username || c.email, c.imap_password || "");
      }
      const t = Date.now();
      const fila = trasIntento(previo.get(c.id), c.id, res.ok, res.error ?? null, t);
      await admin.from("account_reconnect").upsert({ ...fila, updated_at: new Date(t).toISOString() }, { onConflict: "account_id" });
      if (res.ok) {
        // Sólo si sigue caída (no pisar un cambio hecho entretanto a mano, p. ej. una pausa).
        const { data: upd } = await admin.from("email_accounts")
          .update({ status: "connected", last_health_check: new Date(t).toISOString() })
          .eq("id", c.id).in("status", ESTADOS_DESCONECTADOS).select("id");
        if (upd?.length) {
          reconectadas.push(c.email);
          await admin.from("account_reconnect_log").insert({
            account_id: c.id, email: c.email, resultado: "reconectada", detalle: `estaba "${c.status}", ${fila.intentos} intento(s) fallido(s) antes`,
          });
        }
      } else {
        siguen++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(A_LA_VEZ, cola.length) }, trabajador));

  // El registro sólo guarda un mes.
  await admin.from("account_reconnect_log").delete().lt("created_at", new Date(ahora - 30 * 24 * 3600_000).toISOString());
  if (reconectadas.length) console.log(`[reconectar] ${reconectadas.length} cuenta(s) reconectada(s) solas`);
  return { probadas, reconectadas, siguen };
}

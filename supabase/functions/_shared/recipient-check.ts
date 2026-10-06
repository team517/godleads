// Antes de escribir a un lead (06-10-2026): ¿su dominio puede recibir correo?
//
// Un dominio sin registro MX (ni A, que es el MX implícito del RFC 5321) o con el "MX nulo" del
// RFC 7505 no acepta correo: escribirle sólo produce un rebote que daña la reputación del buzón.
// En las últimas 24 h, 8 de los 294 dominios que rebotaron estaban así.
// Con dudas (DNS que no contesta, error raro) se responde null y el motor envía como siempre.

export type DnsResolver = (domain: string, type: "MX" | "A" | "AAAA") => Promise<unknown[]>;

/** ¿Es un "no existe" del DNS (NXDOMAIN / sin datos), no un fallo pasajero? */
export function isDnsNotFound(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name || "";
  const msg = String((e as { message?: string } | null)?.message || e || "");
  return name === "NotFound" || /not ?found|nxdomain|no record|no data|no such host|name or service not known/i.test(msg);
}

/** true = acepta correo · false = seguro que no · null = no se sabe (se envía). */
export async function domainAcceptsMail(domain: string, resolve: DnsResolver): Promise<boolean | null> {
  const d = String(domain || "").trim().toLowerCase().replace(/\.$/, "");
  if (!d || !d.includes(".")) return false;
  try {
    const mx = await resolve(d, "MX") as { exchange?: string }[];
    if (Array.isArray(mx) && mx.length > 0) {
      // MX nulo (RFC 7505): un único registro "." = "este dominio no recibe correo".
      const real = mx.filter((r) => String(r?.exchange ?? "").replace(/\.$/, "") !== "");
      return real.length > 0;
    }
  } catch (e) {
    if (!isDnsNotFound(e)) return null;
  }
  // Sin MX: el correo va al registro A/AAAA del propio dominio (MX implícito).
  for (const t of ["A", "AAAA"] as const) {
    try {
      const a = await resolve(d, t);
      if (Array.isArray(a) && a.length > 0) return true;
    } catch (e) {
      if (!isDnsNotFound(e)) return null;
    }
  }
  return false;
}

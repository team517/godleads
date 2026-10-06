// Hosts de correo configurables por el usuario (smtp_host / imap_host): sólo servidores públicos.
//
// Auditoría 06-10-2026 (SSRF): cualquier host/puerto guardado en email_accounts se conectaba tal
// cual desde las funciones del servidor, así que un usuario podía apuntar su cuenta a direcciones
// internas (169.254.169.254, 10.x, localhost…) y leer lo que respondían en el mensaje de error.
// Aquí se rechazan: nombres internos, IPs privadas/loopback/link-local/CGNAT/multicast (también
// tras resolver el nombre por DNS) y puertos que no son de correo.

export const MAIL_PORTS = new Set([25, 465, 587, 2525, 993, 143, 995, 110]);

const BAD_NAME = /(^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home$|\.corp$|^metadata(\.|$)|\.svc(\.|$)|\.cluster\.local$)/i;

/** ¿Es una IPv4 o IPv6 no pública? */
export function isPrivateIp(ip: string): boolean {
  const s = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  const m4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) {
    const [a, b] = [Number(m4[1]), Number(m4[2])];
    if ([a, b, Number(m4[3]), Number(m4[4])].some((n) => n > 255)) return true;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && Number(m4[3]) === 0)
      || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (s.includes(":")) {
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd)/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return false;
}

/** Comprobación sin red: nombre y puerto. Devuelve el motivo del rechazo o null. */
export function mailHostProblem(host: string, port: number | string): string | null {
  const h = String(host || "").trim().toLowerCase();
  const p = Number(port);
  if (!h) return "Falta el servidor";
  if (!Number.isInteger(p) || !MAIL_PORTS.has(p)) return `Puerto ${port} no permitido (usa 465, 587, 25, 993 o 143)`;
  if (BAD_NAME.test(h)) return "Ese servidor no está permitido";
  if (isPrivateIp(h)) return "Ese servidor no está permitido (dirección interna)";
  if (!/^[a-z0-9.-]+$/.test(h) && !h.includes(":")) return "Nombre de servidor no válido";
  return null;
}

/** Comprobación completa: además resuelve el nombre y rechaza si apunta a una IP no pública. */
export async function assertPublicMailHost(host: string, port: number | string): Promise<string | null> {
  const quick = mailHostProblem(host, port);
  if (quick) return quick;
  const h = String(host).trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return null; // IP pública literal ya comprobada
  // Deno sólo existe en las funciones del servidor (en las pruebas de vitest no): se toma de globalThis.
  const resolveDns = (globalThis as { Deno?: { resolveDns: (h: string, t: string) => Promise<unknown[]> } }).Deno?.resolveDns;
  if (!resolveDns) return null;
  try {
    const ips: string[] = [];
    for (const type of ["A", "AAAA"] as const) {
      try { ips.push(...((await resolveDns(h, type)) as string[])); } catch { /* sin registros de ese tipo */ }
    }
    if (ips.length > 0 && ips.some(isPrivateIp)) return "Ese servidor no está permitido (resuelve a una dirección interna)";
  } catch { /* si el DNS falla, la conexión fallará igual con su propio error */ }
  return null;
}

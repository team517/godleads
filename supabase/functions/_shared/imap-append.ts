// Copia en la carpeta "Enviados" del buzón el correo que acabamos de mandar por SMTP.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hasta el 24-09-2026 las respuestas del Unibox salían por SMTP y no quedaban en el buzón: quien
// abría esa cuenta desde Outlook, el móvil o el correo de IONOS no veía lo que había respondido.
// Esto lo arregla con un APPEND de IMAP. Nunca hace fallar el envío: si algo va mal, se devuelve
// el motivo y el correo ya está enviado igualmente.

export interface Buzon {
  host: string;
  port: number | null;
  user: string;
  pass: string;
}

export type ResultadoCopia =
  | { ok: true; carpeta: string }
  | { ok: false; motivo: "sin_datos" | "login" | "sin_carpeta" | "append" | "error"; detalle?: string };

/** Nombres habituales de la carpeta de enviados, por orden de preferencia. */
const NOMBRES = [
  "Sent", "INBOX.Sent", "Sent Items", "INBOX.Sent Items",
  "Enviados", "INBOX.Enviados", "Elementos enviados", "INBOX.Elementos enviados",
  "Elementos Enviados", "Objets envoyés", "Gesendet", "Posta inviata",
];

/**
 * Elige la carpeta de enviados a partir de la respuesta del comando LIST.
 * Primero mira la marca \Sent (que es la forma correcta, RFC 6154) y, si el servidor no la da,
 * cae a los nombres conocidos en varios idiomas. Devuelve null si no hay ninguna.
 */
export function elegirCarpetaEnviados(respuestaList: string): string | null {
  const lineas = respuestaList.split(/\r?\n/).filter((l) => l.startsWith("* LIST"));
  const carpetas: { nombre: string; marcas: string }[] = [];
  for (const l of lineas) {
    const m = l.match(/^\* LIST \(([^)]*)\)\s+(?:"[^"]*"|NIL)\s+(?:"([^"]+)"|(\S+))\s*$/);
    if (!m) continue;
    carpetas.push({ nombre: m[2] ?? m[3] ?? "", marcas: m[1] || "" });
  }
  const conMarca = carpetas.find((c) => /\\Sent\b/i.test(c.marcas));
  if (conMarca?.nombre) return conMarca.nombre;
  for (const n of NOMBRES) {
    const hit = carpetas.find((c) => c.nombre.toLowerCase() === n.toLowerCase());
    if (hit) return hit.nombre;
  }
  return null;
}

/** Fecha en el formato que pide APPEND: "24-Sep-2026 17:13:02 +0000". */
export function fechaImap(d: Date): string {
  const meses = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${dd}-${meses[d.getUTCMonth()]}-${d.getUTCFullYear()} ${hh}:${mi}:${ss} +0000`;
}

const conTiempo = <T,>(p: Promise<T>, ms: number, que: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, r) => setTimeout(() => r(new Error(`timeout ${que}`)), ms))]);

export async function copiarAEnviados(box: Buzon, raw: string, cuando = new Date()): Promise<ResultadoCopia> {
  if (!box?.host || !box?.user || !box?.pass || !raw) return { ok: false, motivo: "sin_datos" };
  let conn: Deno.Conn | null = null;
  try {
    const port = box.port || 993;
    conn = port === 993
      ? await conTiempo(Deno.connectTls({ hostname: box.host, port }), 15000, "conectar")
      : await conTiempo(Deno.connect({ hostname: box.host, port }), 15000, "conectar");
    const c = conn;
    const enc = new TextEncoder();
    const dec = new TextDecoder("utf-8", { fatal: false });

    const leerHasta = async (fin: RegExp, ms = 20000) => {
      let salida = "";
      const buf = new Uint8Array(1 << 15);
      const empezo = Date.now();
      while (Date.now() - empezo < ms) {
        const n = await conTiempo(c.read(buf), Math.max(1000, ms - (Date.now() - empezo)), "leer");
        if (n === null) break;
        salida += dec.decode(buf.subarray(0, n));
        if (fin.test(salida)) break;
      }
      return salida;
    };

    let n = 0;
    const cmd = async (texto: string, ms = 20000) => {
      const tag = `c${++n}`;
      await c.write(enc.encode(`${tag} ${texto}\r\n`));
      return await leerHasta(new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)`, "i"), ms);
    };

    await leerHasta(/^\* (OK|PREAUTH)/i, 10000);
    const login = await cmd(`LOGIN "${box.user}" "${String(box.pass).replace(/(["\\])/g, "\\$1")}"`);
    if (!/(^|\r\n)c\d+ OK/i.test(login)) return { ok: false, motivo: "login" };

    const lista = await cmd('LIST "" "*"');
    const carpeta = elegirCarpetaEnviados(lista);
    if (!carpeta) { try { await cmd("LOGOUT", 4000); } catch { /* da igual */ } return { ok: false, motivo: "sin_carpeta" }; }

    // El correo se guarda como YA LEÍDO: es nuestro, no tiene sentido que aparezca sin leer.
    const cuerpo = raw.replace(/\r?\n/g, "\r\n");
    const bytes = new TextEncoder().encode(cuerpo).length;
    const tag = `c${++n}`;
    await c.write(enc.encode(`${tag} APPEND "${carpeta}" (\\Seen) "${fechaImap(cuando)}" {${bytes}}\r\n`));
    const listo = await leerHasta(/\+ |(^|\r\n)c\d+ (OK|NO|BAD)/i, 15000);
    if (!listo.includes("+")) { try { await cmd("LOGOUT", 4000); } catch { /* da igual */ } return { ok: false, motivo: "append", detalle: listo.slice(0, 120) }; }
    await c.write(enc.encode(cuerpo + "\r\n"));
    const fin = await leerHasta(new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)`, "i"), 25000);
    try { await cmd("LOGOUT", 4000); } catch { /* da igual */ }
    if (!new RegExp(`(^|\\r\\n)${tag} OK`, "i").test(fin)) {
      return { ok: false, motivo: "append", detalle: fin.slice(0, 120) };
    }
    return { ok: true, carpeta };
  } catch (e) {
    return { ok: false, motivo: "error", detalle: (e as Error).message };
  } finally {
    try { conn?.close(); } catch { /* ya cerrada */ }
  }
}

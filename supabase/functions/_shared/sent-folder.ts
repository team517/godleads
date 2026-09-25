// Elegir la carpeta de "Enviados" de un buzón y dar la fecha en el formato de IMAP.
// Parte PURA de imap-append.ts (sin red ni Deno), para poder probarla desde el frontend.

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

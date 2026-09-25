// Ritmo por EMPRESA: a una misma empresa se le puede escribir a varias personas, pero repartido
// en días y sin juntar correos.
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 25-09-2026: airbus.com recibió 107 correos en un solo día desde 6 campañas del mismo cliente
// (105 personas distintas). Para el filtro de airbus eso es un bombardeo desde nuestros dominios,
// y bloquea a todos. Con estas reglas esas 105 personas se contactan igual, pero a razón de unas
// pocas al día y con horas entre medias, como lo haría un comercial.
//
//   · CUPO: como mucho N correos al día a la misma empresa, sumando TODAS las campañas del
//     cliente (primeros correos y seguimientos).
//   · HUECO: al menos M minutos entre dos correos a la misma empresa.
//   · Los correos gratuitos (gmail, hotmail…) NO son una empresa: allí cada dirección es una
//     persona distinta y no se aplica nada.
// Lo que no cabe hoy no se pierde: el lead sigue en cola y sale otro día.

export const CUPO_EMPRESA_DIA = 3;
export const HUECO_EMPRESA_MIN = 90;

/** Dominios de correo personal: una dirección es una persona, no una empresa. Lista EXACTA
 *  (no por prefijo): orange.com es la empresa Orange, orange.fr es el correo de sus clientes. */
const PERSONALES = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.es", "hotmail.fr", "hotmail.it", "hotmail.co.uk",
  "outlook.com", "outlook.es", "outlook.fr", "outlook.it", "live.com", "live.es", "live.fr", "msn.com",
  "yahoo.com", "yahoo.es", "yahoo.fr", "yahoo.it", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me", "gmx.com", "gmx.es", "gmx.de", "gmx.net", "zoho.com", "yandex.com",
  "yandex.ru", "mail.ru", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr", "laposte.net", "libero.it", "virgilio.it",
  "tiscali.it", "telefonica.net", "movistar.es", "terra.es", "ono.com", "hey.com", "fastmail.com", "tutanota.com",
  "qq.com", "163.com", "126.com", "web.de", "t-online.de", "sapo.pt",
]);

export function esEmpresa(dominio: string | null | undefined): boolean {
  const d = String(dominio || "").trim().toLowerCase();
  return !!d && d.includes(".") && !PERSONALES.has(d);
}

export type EstadoEmpresa = { n: number; ultimoMs: number };

/** ¿Se le puede escribir AHORA a esta empresa?
 *  "si" → adelante · "cupo" → hoy ya recibió N · "espera" → el último fue hace menos de M minutos. */
export function puedeEscribirEmpresa(
  estado: EstadoEmpresa | undefined,
  ahoraMs: number,
  cupo = CUPO_EMPRESA_DIA,
  huecoMin = HUECO_EMPRESA_MIN,
): "si" | "cupo" | "espera" {
  if (!estado) return "si";
  if (estado.n >= cupo) return "cupo";
  if (estado.ultimoMs && ahoraMs - estado.ultimoMs < huecoMin * 60_000) return "espera";
  return "si";
}

/** Apunta un correo más a esa empresa (se llama al ENCOLAR el envío, no al terminarlo, para que
 *  dos envíos en paralelo nunca se salten el cupo). */
export function apuntarEnvioEmpresa(mapa: Map<string, EstadoEmpresa>, clave: string, ahoraMs: number): void {
  const e = mapa.get(clave) || { n: 0, ultimoMs: 0 };
  mapa.set(clave, { n: e.n + 1, ultimoMs: Math.max(e.ultimoMs, ahoraMs) });
}

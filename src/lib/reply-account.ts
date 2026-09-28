// Responder desde otra cuenta cuando la del hilo no puede enviar (p. ej. IONOS bloquea su envío
// con "535" aunque siga leyendo el correo). Parte pura: qué cuentas proponer y en qué orden.

export interface CuentaEnvio { id: string; email: string; status?: string | null; first_name?: string | null }

/** El motor y send-email sólo envían con cuentas "connected". */
export const cuentaPuedeEnviar = (c: Pick<CuentaEnvio, "status"> | null | undefined) => !!c && (c.status ?? "connected") === "connected";

/** ¿El error de envío es de la CUENTA (no de la red ni del destinatario)? Entonces vale la pena
 *  ofrecer otra cuenta. */
export const esErrorDeCuenta = (msg: string | null | undefined) =>
  /\b535\b|\b534\b|auth(entication)? failed|credentials invalid|not connected|no est[aá] conectad|desconectad/i.test(String(msg || ""));

/** "seoinnova-agency.com" → "seoinnova"; "kingofleadboost.es" → "kingofleadboost". */
export const marcaDeDominio = (email: string) => (String(email || "").split("@")[1] || "").toLowerCase().split(".")[0].split("-")[0];

/**
 * Cuentas que pueden enviar en lugar de la original, las más parecidas primero: la misma persona
 * (nombre del remitente) y la misma marca de dominio, luego sólo la persona, luego sólo la marca,
 * y el resto por orden alfabético. Nunca la propia cuenta original.
 */
export function cuentasAlternativas(originalId: string, cuentas: CuentaEnvio[], max = 60): CuentaEnvio[] {
  const orig = cuentas.find((c) => c.id === originalId);
  const nombre = String(orig?.first_name || "").trim().toLowerCase();
  const marca = orig ? marcaDeDominio(orig.email) : "";
  const puntos = (c: CuentaEnvio) =>
    (nombre && String(c.first_name || "").trim().toLowerCase() === nombre ? 2 : 0) + (marca && marcaDeDominio(c.email) === marca ? 1 : 0);
  return cuentas
    .filter((c) => c.id !== originalId && cuentaPuedeEnviar(c))
    .sort((a, b) => puntos(b) - puntos(a) || a.email.localeCompare(b.email))
    .slice(0, max);
}

/**
 * Desde qué cuenta sale la respuesta: SIEMPRE la original del hilo si puede enviar (p. ej. porque
 * se ha reconectado sola), aunque antes se hubiera elegido otra; si no, la elegida.
 */
export function cuentaParaResponder(originalId: string, estadoOriginal: string | null | undefined, elegidaId: string | null): string {
  if (cuentaPuedeEnviar({ status: estadoOriginal })) return originalId;
  return elegidaId || originalId;
}

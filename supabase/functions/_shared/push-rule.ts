/**
 * ¿Hace sonar el móvil esta respuesta? Sólo si es DE CAMPAÑA (inbox_campaign_match +
 * campaignMatchCounts: lead de una campaña, su dominio de empresa o cita un envío nuestro; nunca
 * warm-up) y es de interés, o una pregunta que ha juzgado el modelo.
 * Antes bastaba con que el correo tuviera campaign_id, y el warm-up pegado a una campaña sonaba
 * ("Lucy - coffee? | KK5XRDN 0396QKE", 03-10-2026: 88 de 273 avisos en 14 días).
 * Lo usa push-interested; los tests viven en src/test/push-rule.test.ts.
 */
export type PushVerdict = "interested" | "question" | string;
export function shouldPushReply(input: {
  inCampaign: boolean; verdict: PushVerdict; via: "ia" | "reglas" | string;
  alreadyPushed: boolean; stale: boolean; notify?: boolean;
}): boolean {
  if (input.notify === false) return false;
  if (input.inCampaign !== true) return false;       // no es de ninguna campaña
  if (input.alreadyPushed || input.stale) return false;
  if (input.verdict === "interested") return true;
  return input.verdict === "question" && input.via === "ia";
}

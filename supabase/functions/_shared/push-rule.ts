/**
 * ¿Hace sonar el móvil esta respuesta? Sólo si está en "Campaigns" del Unibox (tiene campaña) y es
 * de interés, o una pregunta que ha juzgado el modelo. Lo de Global/"Todos" nunca avisa.
 * Lo usa push-interested; los tests viven en src/test/push-rule.test.ts.
 */
export type PushVerdict = "interested" | "question" | string;
export function shouldPushReply(input: {
  campaignId: unknown; verdict: PushVerdict; via: "ia" | "reglas" | string;
  alreadyPushed: boolean; stale: boolean; notify?: boolean;
}): boolean {
  if (input.notify === false) return false;
  if (!input.campaignId) return false;               // no está en Campaigns
  if (input.alreadyPushed || input.stale) return false;
  if (input.verdict === "interested") return true;
  return input.verdict === "question" && input.via === "ia";
}

// Plan a medida (11-11-2026): la tabla de niveles vive en supabase/functions/_shared/custom-plan.ts
// (la misma que usan create-checkout y el webhook). Aquí sólo se reexporta para la app.
export {
  CUSTOM_LEVELS, CUSTOM_MAX_LEVEL, CUSTOM_MIN_LEVEL, CUSTOM_PRODUCT_ID, customByMetadata, customByPaymentLink, customByPriceId,
  customLevel, customPaymentLink, customPerMonth, customPriceId, customYearSavings, fmtVolume, parseCustomLevel,
  type CustomInterval, type CustomLevel,
} from "../../supabase/functions/_shared/custom-plan.ts";

/** Nivel con el que arranca la barra cuando nadie ha elegido otro. */
export const CUSTOM_DEFAULT_LEVEL = 3;

/** "Todo lo de Scale incluido": lo que lleva cualquier nivel. */
export const CUSTOM_FEATURES = [
  "Buzones y warm-up ilimitados",
  "Respuestas y agentes con IA",
  "A/B testing y seguimientos",
  "Unibox centralizado",
  "Analíticas avanzadas",
  "Soporte 1:1",
];

/** Cifras en español: 1.500.000 */
export const fmtNum = (n: number) => n.toLocaleString("es-ES");

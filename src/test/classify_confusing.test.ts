import { describe, it, expect } from "vitest";
import { classifyMessage, type MessageCategory } from "@/lib/classify";

// Deliberately CONFUSING + multilingual cases to prove the Unibox filters
// (Interesado / No interesado / Fuera / No contactar / Derivado / Pregunta) hold up
// against mixed signals, negations, and languages beyond Spanish. Each case lists the
// acceptable category(ies); a "hard fail" is returning the OPPOSITE intent (e.g. a clear
// rejection read as Interested, or an unsubscribe read as Interested).
type Case = { t: string; ok: MessageCategory[]; why: string };

const CASES: Case[] = [
  // ── mixed signals: engagement must WIN over a soft "we already have someone" ──
  { t: "Ya trabajamos con otra agencia, pero cuéntame más sobre los precios.", ok: ["interested", "question"], why: "ES engagement beats 'ya trabajamos'" },
  { t: "We already have a provider, but I'm curious — can you send me more info?", ok: ["interested"], why: "EN engagement beats 'already have'" },
  { t: "On a déjà une équipe en interne, mais envoyez-moi la proposition.", ok: ["interested"], why: "FR engagement beats in-house" },

  // ── confusing: the word 'interesado' inside an UNSUBSCRIBE — la baja manda ──
  { t: "Estoy interesado en darme de baja de vuestra lista.", ok: ["no_contactar"], why: "unsubscribe wins over the word interesado" },
  { t: "Bórrame de la base de datos, no me interesa.", ok: ["no_contactar"], why: "remove-from-db wins" },
  { t: "Please remove me from your list, not interested.", ok: ["no_contactar"], why: "EN unsubscribe wins over not-interested" },

  // ── clear rejections across languages ──
  { t: "No me interesa, gracias.", ok: ["not_interested"], why: "ES" },
  { t: "Not interested, thank you.", ok: ["not_interested"], why: "EN" },
  { t: "Merci mais nous ne sommes pas intéressés.", ok: ["not_interested"], why: "FR" },
  { t: "Grazie, non ci interessa al momento.", ok: ["not_interested"], why: "IT" },
  { t: "Kein Interesse, danke.", ok: ["not_interested"], why: "DE" },
  { t: "We're all set for now, thanks.", ok: ["not_interested"], why: "EN soft 'all set'" },

  // ── clear interest across languages ──
  { t: "Me encaja, ¿cuándo podemos hablar esta semana?", ok: ["interested"], why: "ES fit + meeting" },
  { t: "Sounds great, can you send me pricing and a demo?", ok: ["interested"], why: "EN" },
  { t: "Ça m'intéresse, envoyez-moi plus d'informations.", ok: ["interested"], why: "FR" },
  { t: "Mi interessa, quando possiamo parlare?", ok: ["interested"], why: "IT" },
  { t: "Klingt interessant, senden Sie mir bitte mehr Infos.", ok: ["interested"], why: "DE" },

  // ── out-of-office that MENTIONS interest words — OOO must win ──
  { t: "Gracias por tu interés. Estoy fuera de la oficina hasta el 3 de septiembre.", ok: ["out_of_office"], why: "OOO wins over 'interés'" },
  { t: "Automatic reply: I'm on holiday until Monday. Your message is important to me.", ok: ["out_of_office"], why: "EN OOO" },

  // ── referral / not-the-decision-maker ──
  { t: "Yo no llevo esto, te paso con Marta que es la responsable.", ok: ["derivado"], why: "ES referral" },
  { t: "You should reach out to our procurement team instead.", ok: ["derivado", "neutral"], why: "EN referral" },

  // ── questions ──
  { t: "¿Cuánto cuesta el servicio y qué incluye exactamente?", ok: ["question", "interested"], why: "ES price question" },
  { t: "How exactly does the onboarding work?", ok: ["question"], why: "EN question" },

  // ── genuinely neutral / low-signal ──
  { t: "Ok, gracias.", ok: ["neutral", "not_interested"], why: "bare ack" },
  { t: "Recibido, lo reviso y te digo.", ok: ["neutral"], why: "will-review, no commitment" },
  { t: "No dudes en escribirme si hay novedades.", ok: ["neutral", "interested"], why: "soft-open, NOT an unsubscribe" },

  // ── tricky negations that should NOT flip to interested ──
  { t: "No, gracias.", ok: ["not_interested"], why: "bare no-thanks" },
  { t: "Ahora mismo no es el momento, quizá más adelante.", ok: ["not_interested", "question"], why: "not now" },

  // ── Portuguese (market-adjacent) — surface any gap ──
  { t: "Tenho interesse, podem enviar mais informação?", ok: ["interested", "neutral", "question"], why: "PT interest (may be a gap)" },
  { t: "Não temos interesse, obrigado.", ok: ["not_interested", "neutral"], why: "PT rejection (may be a gap)" },
];

describe("classify — confusing & multilingual battery", () => {
  it("never returns the OPPOSITE intent", () => {
    const fails: string[] = [];
    for (const c of CASES) {
      const got = classifyMessage(null, c.t);
      const status = c.ok.includes(got) ? "OK  " : "FAIL";
      // eslint-disable-next-line no-console
      console.log(`${status} got=${got.padEnd(14)} ok=[${c.ok.join("/")}] | ${c.t}`);
      if (!c.ok.includes(got)) fails.push(`${got} (want ${c.ok.join("/")}) :: ${c.t}`);
    }
    if (fails.length) console.log("\nFAILS:\n" + fails.join("\n"));
    expect(fails, `\n${fails.join("\n")}`).toHaveLength(0);
  });
});

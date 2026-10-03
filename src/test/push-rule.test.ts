import { describe, expect, it } from "vitest";
import { shouldPushReply } from "../../supabase/functions/_shared/push-rule";

const base = { inCampaign: true, verdict: "interested", via: "ia", alreadyPushed: false, stale: false };
describe("shouldPushReply — sólo lo que es de campaña", () => {
  it("interesado de campaña → avisa", () => expect(shouldPushReply(base)).toBe(true));
  it("pregunta de campaña juzgada por la IA → avisa", () => expect(shouldPushReply({ ...base, verdict: "question" })).toBe(true));
  it("pregunta sólo por reglas → no avisa", () => expect(shouldPushReply({ ...base, verdict: "question", via: "reglas" })).toBe(false));
  it("no es de campaña (ni lead, ni su dominio, ni cita un envío nuestro) → NO avisa", () => expect(shouldPushReply({ ...base, inCampaign: false })).toBe(false));
  it("warm-up pegado a una campaña ('Lucy - coffee? | KK5XRDN 0396QKE') → NO avisa", () => expect(shouldPushReply({ ...base, inCampaign: false })).toBe(false));
  it("ya avisado → no repite", () => expect(shouldPushReply({ ...base, alreadyPushed: true })).toBe(false));
  it("viejo (barrido) → no avisa", () => expect(shouldPushReply({ ...base, stale: true })).toBe(false));
  it("no interesado / fuera de oficina → no avisa", () => {
    expect(shouldPushReply({ ...base, verdict: "not_interested" })).toBe(false);
    expect(shouldPushReply({ ...base, verdict: "ooo" })).toBe(false);
  });
  it("notify=false (repaso manual) → no avisa", () => expect(shouldPushReply({ ...base, notify: false })).toBe(false));
});

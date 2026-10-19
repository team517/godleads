import { describe, expect, it } from "vitest";
import { isAuthStorm, isIonosHost, pauseActive, pauseUntilIso, STORM_PAUSE_MIN } from "../../supabase/functions/_shared/auth-storm";

/* Freno ante un bloqueo de login de IONOS (19-10-2026). */
describe("auth-storm", () => {
  it("reconoce los servidores de IONOS", () => {
    for (const h of ["smtp.ionos.es", "smtp.ionos.com", "SMTP.IONOS.DE", "smtp.1and1.com", "smtp.ionos.co.uk"]) expect(isIonosHost(h)).toBe(true);
    for (const h of ["smtp.gmail.com", "smtp.office365.com", "mail.ionosfera.es", "", null]) expect(isIonosHost(h as string)).toBe(false);
  });

  it("19-10 a las 9:00: muchos buzones de varios clientes = bloqueo de IONOS", () => {
    const fails = [
      ...Array.from({ length: 4 }, (_, i) => ({ account_id: `s${i}`, user_id: "support" })),
      { account_id: "e1", user_id: "energika" },
    ];
    expect(isAuthStorm(fails)).toBe(true);
  });

  it("un cliente con 60 contraseñas malas NO es un bloqueo (se marcan como siempre)", () => {
    expect(isAuthStorm(Array.from({ length: 60 }, (_, i) => ({ account_id: `c${i}`, user_id: "coco" })))).toBe(false);
  });

  it("pocos fallos o repetidos del mismo buzón no disparan el freno", () => {
    expect(isAuthStorm([{ account_id: "a", user_id: "u1" }, { account_id: "b", user_id: "u2" }])).toBe(false);
    expect(isAuthStorm(Array.from({ length: 9 }, () => ({ account_id: "a", user_id: "u1" })).concat([{ account_id: "b", user_id: "u2" }]))).toBe(false);
  });

  it("pausa de 15 minutos", () => {
    const now = Date.parse("2026-10-19T07:00:00Z");
    const until = pauseUntilIso(now);
    expect(Date.parse(until) - now).toBe(STORM_PAUSE_MIN * 60_000);
    expect(pauseActive(until, now + 60_000)).toBe(true);
    expect(pauseActive(until, now + 16 * 60_000)).toBe(false);
    expect(pauseActive(null, now)).toBe(false);
  });
});

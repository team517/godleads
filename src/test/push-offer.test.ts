import { describe, expect, it } from "vitest";
import { isIosDevice, pushOfferState } from "@/lib/push-offer";

const base = { supported: true, permission: "default" as NotificationPermission, standalone: false, isIos: false };

describe("pushOfferState", () => {
  it("navegador de ordenador o Android sin decidir → se ofrece activar", () => {
    expect(pushOfferState(base)).toBe("ask");
  });
  it("app instalada sin decidir → se ofrece activar", () => {
    expect(pushOfferState({ ...base, standalone: true })).toBe("ask");
  });
  it("ya activados → no se molesta", () => {
    expect(pushOfferState({ ...base, permission: "granted" })).toBe("hidden");
  });
  it("bloqueados en el navegador → no se molesta (sólo se arregla en los ajustes)", () => {
    expect(pushOfferState({ ...base, permission: "denied" })).toBe("hidden");
  });
  it("iPhone en una pestaña → se explica cómo instalar la app", () => {
    expect(pushOfferState({ ...base, isIos: true, supported: false })).toBe("install");
  });
  it("iPhone con la app instalada → se ofrece activar", () => {
    expect(pushOfferState({ ...base, isIos: true, standalone: true })).toBe("ask");
  });
  it("iPhone que ya los tiene activados → no se molesta", () => {
    expect(pushOfferState({ ...base, isIos: true, permission: "granted" })).toBe("hidden");
  });
  it("navegador sin soporte → no se ofrece nada", () => {
    expect(pushOfferState({ ...base, supported: false })).toBe("hidden");
  });
  it("aplazado una semana → no se ofrece hasta que pase", () => {
    const ahora = 1_000_000;
    expect(pushOfferState({ ...base, snoozedUntil: ahora + 60_000, now: ahora })).toBe("hidden");
    expect(pushOfferState({ ...base, snoozedUntil: ahora - 60_000, now: ahora })).toBe("ask");
  });
});

describe("isIosDevice", () => {
  it("iPhone y iPad", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
  });
  it("iPad que se hace pasar por Mac", () => {
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
  });
  it("Mac de verdad y Android no", () => {
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe(false);
  });
});

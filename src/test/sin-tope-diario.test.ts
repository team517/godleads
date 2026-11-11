import { describe, expect, it } from "vitest";
import { effectiveDailyLimit, DEFAULT_DAILY_LIMIT } from "@/lib/warmup";

/* 11-11-2026, decisión del dueño: "que puedan haber más de 15 envíos al día, que no haya tope".
   El límite diario de cada buzón manda tal cual; el warm-up sigue subiendo hasta su objetivo. */
describe("límite diario por buzón sin techo de plataforma", () => {
  it("una cuenta con 40 al día envía 40 (antes se recortaba a 15)", () => {
    expect(effectiveDailyLimit({ daily_limit: 40 }, 0).limit).toBe(40);
  });
  it("sin límite puesto, el valor por defecto sigue siendo 15", () => {
    expect(DEFAULT_DAILY_LIMIT).toBe(15);
    expect(effectiveDailyLimit({ daily_limit: null }, 0).limit).toBe(15);
  });
  it("el warm-up sigue mandando: sube cada día de envío hasta su objetivo, también por encima de 15", () => {
    const acc = { daily_limit: 50, warmup_enabled: true, warmup_started_at: "2026-11-01T00:00:00Z", warmup_day: 2, warmup_increment: 3, warmup_limit: 30 };
    expect(effectiveDailyLimit(acc, 0).limit).toBe(2);
    expect(effectiveDailyLimit(acc, 5).limit).toBe(17);
    expect(effectiveDailyLimit(acc, 20).limit).toBe(30);
  });
});

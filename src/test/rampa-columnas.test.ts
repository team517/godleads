import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { effectiveDailyLimit } from "@/lib/warmup";

/* 11-11-2026: Opciones de la campaña cargaba las cuentas sin warmup_day (el envío del día 1 de la
   rampa) y calculaba "capacidad 7" con 7 buzones que empiezan en 29. Toda consulta que traiga los
   datos de la rampa para calcular el límite debe traer también warmup_day. */
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? archivos(p) : /\.(tsx?)$/.test(f) ? [p] : [];
  });
}

describe("la rampa de cada cuenta se calcula con su día 1", () => {
  it("sin warmup_day, una rampa que empieza en 29 se vería como 1 al día (el fallo)", () => {
    const acc = { daily_limit: 30, warmup_enabled: true, warmup_started_at: "2026-11-11T10:00:00Z", warmup_increment: 1, warmup_limit: 30 };
    expect(effectiveDailyLimit(acc, 0).limit).toBe(1);
    expect(effectiveDailyLimit({ ...acc, warmup_day: 29 }, 0).limit).toBe(29);
  });

  it("toda consulta del frontend que pide warmup_increment pide también warmup_day", () => {
    const malas: string[] = [];
    for (const f of archivos("src")) {
      if (f.includes(`${join("src", "test")}`)) continue;
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/\.select\(\s*["'`]([^"'`]*warmup_increment[^"'`]*)["'`]/g)) {
        if (!/\bwarmup_day\b/.test(m[1])) malas.push(f);
      }
    }
    expect(malas).toEqual([]);
  });
});

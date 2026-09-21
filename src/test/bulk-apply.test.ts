import { describe, expect, it, vi } from "vitest";
import { applyInChunks, BULK_CHUNK, chunk } from "@/lib/bulk-apply";

/* Activar el slow ramp en 400 buzones era un UPDATE por cuenta, en fila y sin barra.
 * Ahora va por tandas en paralelo y cada tanda mueve el progreso. */

const ids = (n: number) => Array.from({ length: n }, (_, i) => `acc-${i}`);

describe("applyInChunks", () => {
  it("400 cuentas = 16 peticiones (no 400), y no se pierde ni se repite ninguna", async () => {
    const seen: string[] = [];
    const apply = vi.fn(async (batch: string[]) => { seen.push(...batch); return { error: null }; });
    const res = await applyInChunks(ids(400), apply);
    expect(apply).toHaveBeenCalledTimes(16);
    expect(apply.mock.calls.every(([b]) => b.length <= BULK_CHUNK)).toBe(true);
    expect(seen.sort()).toEqual(ids(400).sort());
    expect(res).toEqual({ done: 400, total: 400, failed: 0 });
  });

  it("la barra empieza en 0, sólo avanza y acaba en el total", async () => {
    const steps: number[] = [];
    await applyInChunks(ids(950), async () => ({}), (p) => steps.push(p.done));
    expect(steps[0]).toBe(0);
    expect(steps[steps.length - 1]).toBe(950);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(steps.length).toBe(39); // 0 + 38 tandas
  });

  it("nunca hay más de 5 tandas a la vez", async () => {
    let inFlight = 0, peak = 0;
    await applyInChunks(ids(1200), async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBe(5);
  });

  it("una tanda que falla se cuenta como fallida y NO corta las demás", async () => {
    let call = 0;
    const res = await applyInChunks(ids(300), async () => {
      call++;
      if (call === 2) return { error: { message: "timeout" } };
      if (call === 3) throw new Error("red caída");
      return { error: null };
    });
    expect(res).toEqual({ done: 300, total: 300, failed: 50 });
  });

  it("ids repetidos cuentan una vez; lista vacía no llama a nada", async () => {
    const apply = vi.fn(async () => ({}));
    expect(await applyInChunks(["a", "a", "b"], apply)).toEqual({ done: 2, total: 2, failed: 0 });
    apply.mockClear();
    expect(await applyInChunks([], apply)).toEqual({ done: 0, total: 0, failed: 0 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("chunk respeta el tamaño", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

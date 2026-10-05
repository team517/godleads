import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSharedQueries, sharedQuery } from "@/lib/boot-queries";

describe("sharedQuery — una sola petición por usuario al arrancar", () => {
  beforeEach(() => { clearSharedQueries(); vi.useRealTimers(); });

  it("dos lectores en el mismo arranque comparten la misma petición", async () => {
    const run = vi.fn(async () => ({ data: { role: "admin" }, error: null }));
    const [a, b] = await Promise.all([sharedQuery("k", run), sharedQuery("k", run)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("un resultado con error no se reparte: el siguiente vuelve a preguntar", async () => {
    let n = 0;
    const run = vi.fn(async () => (++n === 1 ? { data: null, error: { message: "boom" } } : { data: { ok: true }, error: null }));
    const first = await sharedQuery("k", run);
    expect(first.error).toBeTruthy();
    const second = await sharedQuery("k", run);
    expect(second.data).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("una promesa rechazada tampoco se queda cacheada", async () => {
    let n = 0;
    const run = vi.fn(async () => { if (++n === 1) throw new Error("red"); return { data: 1, error: null }; });
    await expect(sharedQuery("k", run)).rejects.toThrow("red");
    expect((await sharedQuery("k", run)).data).toBe(1);
  });

  it("fresh: true salta la caché (p. ej. tras guardar el perfil)", async () => {
    const run = vi.fn(async () => ({ data: 1, error: null }));
    await sharedQuery("k", run);
    await sharedQuery("k", run, { fresh: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("pasado el ttl se vuelve a preguntar", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => ({ data: 1, error: null }));
    await sharedQuery("k", run, { ttlMs: 1000 });
    vi.advanceTimersByTime(1500);
    await sharedQuery("k", run, { ttlMs: 1000 });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("claves distintas no se mezclan", async () => {
    const run = vi.fn(async () => ({ data: 1, error: null }));
    await Promise.all([sharedQuery("a", run), sharedQuery("b", run)]);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

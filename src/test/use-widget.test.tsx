import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWidget } from "@/hooks/useWidget";
import { bindCacheUser, cacheSet } from "@/lib/instant-cache";

/* Un widget carga por su cuenta, pinta la caché al instante, conserva lo bueno si falla y se
   reintenta solo él: la base de que Estadísticas / Dashboard no se queden nunca en blanco. */
describe("useWidget", () => {
  it("pinta lo cacheado de inmediato y lo sustituye cuando llega la carga", async () => {
    bindCacheUser("u1");
    cacheSet("test:w1", { sent: 5 });
    const load = vi.fn(async () => ({ data: { sent: 9 }, error: null }));
    const { result } = renderHook(() => useWidget<{ sent: number }>({ cacheKey: "test:w1", load, deps: [] }));
    expect(result.current.data).toEqual({ sent: 5 });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ sent: 9 });
    expect(result.current.error).toBeNull();
  });

  it("un { error } conserva el dato anterior y Reintentar vuelve a cargar", async () => {
    let fail = true;
    const load = vi.fn(async () => (fail ? { data: null, error: { message: "statement timeout" } } : { data: [1, 2, 3], error: null }));
    const { result } = renderHook(() => useWidget<number[]>({ load, deps: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("statement timeout");
    expect(result.current.data).toBeUndefined();
    fail = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toEqual([1, 2, 3]));
    expect(result.current.error).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("una excepción síncrona de la carga acaba en error, no tumba el componente", async () => {
    const load = vi.fn(() => { throw new TypeError("supabase.rpc is not a function"); });
    const { result } = renderHook(() => useWidget<number>({ load: load as any, deps: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/not a function/);
  });

  it("enabled=false no carga hasta que se active", async () => {
    const load = vi.fn(async () => ({ data: 1, error: null }));
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useWidget<number>({ enabled: on, load, deps: [] }), { initialProps: { on: false } });
    expect(load).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

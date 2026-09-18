import { describe, expect, it, vi } from "vitest";
import { isAuthFailure, isGuardedUrl, withFreshToken, announceSessionExpired, makeGuardedFetch, SESSION_EXPIRED_EVENT } from "@/lib/auth-retry";

const URL_BASE = "https://iqhhybmhlkmulwhizpzi.supabase.co";

describe("qué peticiones se reintentan", () => {
  it("las de datos y funciones sí", () => {
    expect(isGuardedUrl(`${URL_BASE}/rest/v1/campaigns?select=*`)).toBe(true);
    expect(isGuardedUrl(`${URL_BASE}/rest/v1/rpc/campaign_metrics_for_user`)).toBe(true);
    expect(isGuardedUrl(`${URL_BASE}/functions/v1/send-email`)).toBe(true);
  });
  it("las de autenticación no (son las que renuevan el token)", () => {
    expect(isGuardedUrl(`${URL_BASE}/auth/v1/token?grant_type=refresh_token`)).toBe(false);
    expect(isGuardedUrl(`${URL_BASE}/storage/v1/object/logos/x.png`)).toBe(false);
    expect(isGuardedUrl("")).toBe(false);
  });
});

describe("qué respuesta significa «tu token no vale»", () => {
  it("un 401 siempre", () => {
    expect(isAuthFailure(401)).toBe(true);
    expect(isAuthFailure(401, "")).toBe(true);
  });
  it("un 403 sólo si habla del token; un 403 de permisos NO se reintenta", () => {
    expect(isAuthFailure(403, '{"message":"JWT expired"}')).toBe(true);
    expect(isAuthFailure(403, '{"code":"PGRST301"}')).toBe(true);
    expect(isAuthFailure(403, '{"error":"no autorizado para este dominio"}')).toBe(false);
  });
  it("el resto de errores no se tocan", () => {
    for (const st of [200, 400, 404, 409, 429, 500, 502, 546]) expect(isAuthFailure(st, "boom")).toBe(false);
  });
});

describe("la petición repetida", () => {
  it("lleva el token nuevo y conserva método y cuerpo", () => {
    const init = { method: "POST", body: '{"a":1}', headers: { Authorization: "Bearer viejo", apikey: "anon" } };
    const out = withFreshToken(init, "nuevo");
    expect(new Headers(out.headers).get("Authorization")).toBe("Bearer nuevo");
    expect(new Headers(out.headers).get("apikey")).toBe("anon");
    expect(out.method).toBe("POST");
    expect(out.body).toBe('{"a":1}');
    // La original no se toca (podría reutilizarse).
    expect(init.headers.Authorization).toBe("Bearer viejo");
  });
  it("funciona sin cabeceras previas", () => {
    expect(new Headers(withFreshToken(undefined, "t").headers).get("Authorization")).toBe("Bearer t");
  });
});

describe("aviso de sesión caducada", () => {
  it("se emite para que la interfaz lo diga en vez de enseñar listas vacías", () => {
    const seen = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, seen);
    announceSessionExpired();
    expect(seen).toHaveBeenCalledOnce();
    window.removeEventListener(SESSION_EXPIRED_EVENT, seen);
  });
});

describe("el interceptor completo (makeGuardedFetch)", () => {
  const REST = `${URL_BASE}/rest/v1/campaigns?select=*`;
  const ok = (body: string) => new Response(body, { status: 200 });
  const fail = (status: number, body = "") => new Response(body, { status });

  it("token caducado → renueva y REPITE la petición: el llamante recibe sus filas", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_i: any, init?: RequestInit) => {
      const auth = new Headers(init?.headers || {}).get("Authorization") || "";
      calls.push(auth);
      return auth === "Bearer nuevo" ? ok('[{"id":"c1"}]') : fail(401, '{"code":"PGRST301"}');
    });
    const onExpired = vi.fn();
    const g = makeGuardedFetch({ fetchImpl: fetchImpl as any, refresh: async () => "nuevo", onExpired });
    const res = await g(REST, { headers: { Authorization: "Bearer viejo" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[{"id":"c1"}]');
    expect(calls).toEqual(["Bearer viejo", "Bearer nuevo"]);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("si no se puede renovar: avisa UNA vez y devuelve la respuesta original legible", async () => {
    const onExpired = vi.fn();
    const g = makeGuardedFetch({ fetchImpl: async () => fail(401, '{"message":"JWT expired"}'), refresh: async () => null, onExpired });
    const res = await g(REST, {});
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("JWT expired"); // el cuerpo no se consumió por dentro
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it("varias consultas a la vez comparten UNA sola renovación", async () => {
    let n = 0;
    const refresh = vi.fn(async () => { n++; return "nuevo"; });
    const fetchImpl = async (_i: any, init?: RequestInit) =>
      new Headers(init?.headers || {}).get("Authorization") === "Bearer nuevo" ? ok("[]") : fail(401);
    const g = makeGuardedFetch({ fetchImpl: fetchImpl as any, refresh, onExpired: () => {} });
    const all = await Promise.all([g(REST, {}), g(REST, {}), g(REST, {})]);
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(n).toBe(1);
  });

  it("un 403 de permisos NO se reintenta (no es problema de token)", async () => {
    const refresh = vi.fn(async () => "nuevo");
    const fetchImpl = vi.fn(async () => fail(403, '{"error":"no autorizado para este dominio"}'));
    const g = makeGuardedFetch({ fetchImpl: fetchImpl as any, refresh, onExpired: () => {} });
    const res = await g(`${URL_BASE}/functions/v1/configure-dns`, {});
    expect(res.status).toBe(403);
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("no toca el login: un 401 de /auth/v1 se devuelve tal cual", async () => {
    const refresh = vi.fn(async () => "nuevo");
    const g = makeGuardedFetch({ fetchImpl: async () => fail(401), refresh, onExpired: () => {} });
    expect((await g(`${URL_BASE}/auth/v1/token?grant_type=password`, {})).status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
  });
});

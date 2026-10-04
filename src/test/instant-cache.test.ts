import { beforeEach, describe, expect, it } from "vitest";
import { bindCacheUser, cacheGet, cacheSet } from "@/lib/instant-cache";

describe("instant-cache: la caché es de UN usuario", () => {
  beforeEach(() => {
    bindCacheUser(null);
    localStorage.clear();
  });

  it("cambiar de usuario (sin pasar por null) vacía memoria y disco", () => {
    bindCacheUser("u1");
    cacheSet("dash:summary", { sent: 41013 });
    cacheSet("campaigns:list", [{ id: "c1" }]);
    expect(localStorage.getItem("op_cache:dash:summary")).not.toBeNull();
    bindCacheUser("u2");
    expect(cacheGet("dash:summary")).toBeUndefined();
    expect(cacheGet("campaigns:list")).toBeUndefined();
    expect(Object.keys(localStorage).filter((k) => k.startsWith("op_cache:"))).toEqual([]);
  });

  it("el mismo usuario conserva lo suyo y vuelve a hidratar desde el disco", () => {
    bindCacheUser("u1");
    cacheSet("stats:summary", { sent: 1 });
    bindCacheUser("u1");
    expect(cacheGet("stats:summary")).toEqual({ sent: 1 });
  });

  it("borra la clave vieja dash:stats al entrar", () => {
    localStorage.setItem("op_cache:dash:stats", JSON.stringify({ uid: "u1", v: { sent: 0 } }));
    localStorage.setItem("op_cache:dash:campaigns", JSON.stringify({ uid: "u1", v: [] }));
    bindCacheUser("u1");
    expect(localStorage.getItem("op_cache:dash:stats")).toBeNull();
    expect(localStorage.getItem("op_cache:dash:campaigns")).not.toBeNull();
  });
});

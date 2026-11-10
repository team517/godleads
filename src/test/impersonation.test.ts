import { describe, expect, it } from "vitest";
import {
  AGENCY_EMAILS, IMPERSONATION_ACTORS, canImpersonate, coincideCliente, decideStart, isStaffTarget, nombreCuenta,
  ordenarClientes, tipoDeCuenta,
} from "../../supabase/functions/_shared/impersonation-rules";
import {
  canUseAccountSwitcher, needsRefresh, parseImpersonationState, realAccountEmail, stateMatchesUser,
  type ImpersonationState,
} from "@/lib/impersonation";
import { isStaleImpersonation, ENTERING_GRACE_SEC } from "@/lib/impersonation";

/* Cambio de cuenta del equipo (10-11-2026): sólo hello@ y equipo@ entran en las cuentas de los
   clientes, nunca en las del equipo, y para el resto de usuarios no existe. */

describe("quién puede entrar en otras cuentas", () => {
  it("sólo hello@onepulso.blog y equipo@onepulso.online (sin importar mayúsculas ni espacios)", () => {
    expect([...IMPERSONATION_ACTORS].sort()).toEqual(["equipo@onepulso.online", "hello@onepulso.blog"]);
    expect(canImpersonate("hello@onepulso.blog")).toBe(true);
    expect(canImpersonate("  EQUIPO@onepulso.online ")).toBe(true);
  });
  it("support@, un admin cualquiera o un cliente: no", () => {
    for (const e of ["support@onepulso.online", "info@seoinnova.es", "ray@dialogfy.com", "", null, undefined]) {
      expect(canImpersonate(e as string)).toBe(false);
    }
  });
});

describe("decideStart — lo que comprueba el servidor antes de abrir la sesión", () => {
  const hello = { id: "a1", email: "hello@onepulso.blog" };
  const cliente = { id: "c1", email: "info@seoinnova.es", role: "client", isClientManager: false };
  it("hello@ entra en un cliente", () => expect(decideStart(hello, cliente)).toEqual({ ok: true }));
  it("un usuario normal no puede (403), aunque apunte a otro cliente", () => {
    const r = decideStart({ id: "x", email: "info@seoinnova.es" }, { ...cliente, id: "c2", email: "ray@dialogfy.com" });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });
  it("support@ tampoco (no está en la lista, aunque sea del equipo)", () => {
    expect(decideStart({ id: "s", email: "support@onepulso.online" }, cliente)).toMatchObject({ ok: false, status: 403 });
  });
  it("nunca a una cuenta del equipo: admin por rol, gestor de clientes o correo de la agencia", () => {
    expect(decideStart(hello, { ...cliente, role: "admin" })).toMatchObject({ ok: false, status: 403 });
    expect(decideStart(hello, { ...cliente, isClientManager: true })).toMatchObject({ ok: false, status: 403 });
    for (const e of AGENCY_EMAILS) expect(decideStart(hello, { ...cliente, email: e })).toMatchObject({ ok: false, status: 403 });
  });
  it("cuenta inexistente, la propia o sin correo", () => {
    expect(decideStart(hello, null)).toMatchObject({ ok: false, status: 404 });
    expect(decideStart(hello, { ...cliente, id: "a1" })).toMatchObject({ ok: false, status: 400 });
    expect(decideStart(hello, { ...cliente, email: "" })).toMatchObject({ ok: false, status: 400 });
  });
  it("isStaffTarget", () => {
    expect(isStaffTarget({ id: "1", email: "support@onepulso.online" })).toBe(true);
    expect(isStaffTarget({ id: "1", email: "info@seoinnova.es" })).toBe(false);
  });
});

describe("lista de clientes", () => {
  it("tipo de cuenta", () => {
    expect(tipoDeCuenta({ allowed_routes: ["/campaigns"] })).toBe("cliente");
    expect(tipoDeCuenta({ allowed_routes: [], client_login_of: "x" })).toBe("acceso_cliente");
    expect(tipoDeCuenta({})).toBe("registro");
  });
  it("nombre: empresa > nombre > correo", () => {
    expect(nombreCuenta({ company_name: " Seo Innova ", full_name: "Juanjo", email: "a@b.es" })).toBe("Seo Innova");
    expect(nombreCuenta({ company_name: "", full_name: "Juanjo", email: "a@b.es" })).toBe("Juanjo");
    expect(nombreCuenta({ email: "A@B.es" })).toBe("a@b.es");
  });
  it("orden por empresa sin acentos y búsqueda sin acentos", () => {
    const xs = [{ company_name: "Énergika", email: "s@e.es" }, { company_name: "dekano", email: "j@d.es" }, { company_name: null, full_name: "Ana", email: "a@x.es" }];
    expect(ordenarClientes(xs).map((c) => c.email)).toEqual(["a@x.es", "j@d.es", "s@e.es"]);
    expect(coincideCliente(xs[0], "energ")).toBe(true);
    expect(coincideCliente(xs[1], "J@D")).toBe(true);
    expect(coincideCliente(xs[1], "zzz")).toBe(false);
    expect(coincideCliente(xs[1], "  ")).toBe(true);
  });
});

describe("estado guardado en el navegador", () => {
  const valido: ImpersonationState = {
    actor: { userId: "a1", email: "hello@onepulso.blog", accessToken: "at", refreshToken: "rt", expiresAt: 2_000_000_000 },
    target: { userId: "c1", email: "info@seoinnova.es", company: "Seo Innova" },
    startedAt: "2026-11-10T10:00:00Z",
    logId: "l1",
  };
  it("se lee bien lo que se guardó", () => {
    expect(parseImpersonationState(JSON.stringify(valido))).toEqual(valido);
  });
  it("cualquier cosa rara = sin cambio de cuenta", () => {
    expect(parseImpersonationState(null)).toBeNull();
    expect(parseImpersonationState("no-json")).toBeNull();
    expect(parseImpersonationState(JSON.stringify({ ...valido, actor: { ...valido.actor, refreshToken: "" } }))).toBeNull();
    expect(parseImpersonationState(JSON.stringify({ ...valido, target: undefined }))).toBeNull();
  });
  it("un estado cuyo 'actor' no es hello@ ni equipo@ se ignora (no se puede fabricar a mano)", () => {
    expect(parseImpersonationState(JSON.stringify({ ...valido, actor: { ...valido.actor, email: "info@seoinnova.es" } }))).toBeNull();
  });
  it("sólo vale para la sesión del cliente en el que se entró", () => {
    expect(stateMatchesUser(valido, "c1")).toBe(true);
    expect(stateMatchesUser(valido, "a1")).toBe(false);
    expect(stateMatchesUser(null, "c1")).toBe(false);
  });
  it("la cuenta real y el menú 'Clientes'", () => {
    expect(realAccountEmail(valido, "info@seoinnova.es")).toBe("hello@onepulso.blog");
    expect(canUseAccountSwitcher(valido, "info@seoinnova.es")).toBe(true);   // dentro de un cliente: sigue
    expect(canUseAccountSwitcher(null, "hello@onepulso.blog")).toBe(true);
    expect(canUseAccountSwitcher(null, "info@seoinnova.es")).toBe(false);    // usuario normal: no existe
    expect(canUseAccountSwitcher(null, "support@onepulso.online")).toBe(false);
  });
  it("renovar el token guardado con margen de 90 s", () => {
    const now = Date.parse("2026-11-10T10:00:00Z");
    expect(needsRefresh(Math.floor(now / 1000) + 30, now)).toBe(true);
    expect(needsRefresh(Math.floor(now / 1000) + 600, now)).toBe(false);
    expect(needsRefresh(0, now)).toBe(true);
  });
});


/* 10-11-2026: al entrar, el estado se escribe con la sesión del equipo aún abierta; el aviso lo borraba
   en ese instante y, ya dentro del cliente, no salía "Volver a mi cuenta". */
describe("isStaleImpersonation — no borrar el estado mientras se entra", () => {
  const ahora = Date.parse("2026-11-10T18:00:00Z");
  const st = (startedAt: string) => ({
    actor: { userId: "equipo", email: "hello@onepulso.blog", accessToken: "a", refreshToken: "r", expiresAt: 9e9 },
    target: { userId: "cliente", email: "c@x.es", company: "X" },
    startedAt, logId: null,
  });
  it("dentro del cliente: nunca es un resto", () => {
    expect(isStaleImpersonation(st("2026-11-01T00:00:00Z"), "cliente", ahora)).toBe(false);
  });
  it("sesión del equipo justo al entrar: se conserva", () => {
    expect(isStaleImpersonation(st("2026-11-10T17:59:58Z"), "equipo", ahora)).toBe(false);
  });
  it("sesión del equipo pasado el margen: es un resto (se volvió por otro lado)", () => {
    const viejo = new Date(ahora - (ENTERING_GRACE_SEC + 5) * 1000).toISOString();
    expect(isStaleImpersonation(st(viejo), "equipo", ahora)).toBe(true);
  });
  it("otra cuenta distinta (cerró sesión y entró otro): es un resto", () => {
    expect(isStaleImpersonation(st("2026-11-10T17:59:58Z"), "otro", ahora)).toBe(true);
  });
  it("sin estado o sin usuario: nada que borrar", () => {
    expect(isStaleImpersonation(null, "equipo", ahora)).toBe(false);
    expect(isStaleImpersonation(st("2026-11-10T17:59:58Z"), null, ahora)).toBe(false);
  });
});

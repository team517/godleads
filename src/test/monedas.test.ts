import { describe, expect, it } from "vitest";
import { monedasDeSesion, quienPaga, PACKS_MONEDAS, COSTE_PERSONALIZAR, COSTE_VERIFICAR } from "../../supabase/functions/_shared/coins";
import { alcanza, coinPackUrl, parseCoinStatus, precioPorVerificacion, queHacerCon } from "@/lib/coins";

// Tienda de monedas (13-11-2026): sólo verificar (1) y personalizar con IA (2) gastan monedas.
describe("packs y costes", () => {
  it("cinco packs, el más caro 99 €, y cada vez más baratos por moneda", () => {
    expect(PACKS_MONEDAS.map((p) => p.coins)).toEqual([1000, 5000, 10000, 25000, 50000]);
    expect(Math.max(...PACKS_MONEDAS.map((p) => p.cents))).toBe(9900);
    const porMoneda = PACKS_MONEDAS.map((p) => p.cents / p.coins);
    for (let i = 1; i < porMoneda.length; i++) expect(porMoneda[i]).toBeLessThan(porMoneda[i - 1]);
  });
  it("más barato que Smartlead (~0,005 €) e Instantly (~0,007 €) por correo verificado", () => {
    for (const p of PACKS_MONEDAS) expect(p.cents / 100 / p.coins).toBeLessThanOrEqual(0.004);
    expect(precioPorVerificacion(PACKS_MONEDAS[4])).toBe("0,002 €");
  });
  it("qué se hace con 100 y con 500 monedas", () => {
    expect(COSTE_VERIFICAR).toBe(1);
    expect(COSTE_PERSONALIZAR).toBe(0.75);
    expect(queHacerCon(100)).toEqual({ verificaciones: 100, personalizaciones: 133 });
    expect(queHacerCon(500)).toEqual({ verificaciones: 500, personalizaciones: 666 });
  });
});

describe("compra confirmada por Stripe", () => {
  it("el enlace del pack decide las monedas", () => {
    expect(monedasDeSesion({ mode: "payment", payment_status: "paid", payment_link: PACKS_MONEDAS[1].linkId })).toBe(5000);
  });
  it("por metadata sólo si el importe cuadra con el pack (no se pueden inventar monedas)", () => {
    expect(monedasDeSesion({ mode: "payment", payment_status: "paid", metadata: { kind: "coins", coins: "50000" }, amount_total: 9900 })).toBe(50000);
    expect(monedasDeSesion({ mode: "payment", payment_status: "paid", metadata: { kind: "coins", coins: "50000" }, amount_total: 400 })).toBe(0);
  });
  it("sin cobrar, suscripciones u otros pagos: nada", () => {
    expect(monedasDeSesion({ mode: "payment", payment_status: "unpaid", payment_link: PACKS_MONEDAS[0].linkId })).toBe(0);
    expect(monedasDeSesion({ mode: "subscription", payment_status: "paid", payment_link: PACKS_MONEDAS[0].linkId })).toBe(0);
    expect(monedasDeSesion({ mode: "payment", payment_status: "paid", payment_link: "plink_otro" })).toBe(0);
    expect(monedasDeSesion(null)).toBe(0);
  });
});

describe("quién paga", () => {
  const base = { userId: "u1", email: "ana@acme.test" };
  it("un usuario normal paga él", () => expect(quienPaga(base)).toEqual({ gratis: false, payer: "u1" }));
  it("el acceso de un cliente de una agencia paga con las monedas de la agencia", () => {
    expect(quienPaga({ ...base, agenciaDelCliente: "ag1" })).toEqual({ gratis: false, payer: "ag1" });
  });
  it("equipo, admins, gestores y clientes gestionados por la agencia: gratis", () => {
    expect(quienPaga({ ...base, email: "hello@onepulso.blog" })).toEqual({ gratis: true });
    expect(quienPaga({ ...base, role: "admin" })).toEqual({ gratis: true });
    expect(quienPaga({ ...base, isClientManager: true })).toEqual({ gratis: true });
    expect(quienPaga({ ...base, allowedRoutes: ["/campaigns"] })).toEqual({ gratis: true });
  });
});

describe("en el navegador", () => {
  it("el enlace de pago lleva la cuenta y el correo", () => {
    const u = new URL(coinPackUrl(PACKS_MONEDAS[0], { id: "11111111-2222-3333-4444-555555555555", email: "ana@acme.test" }));
    expect(u.searchParams.get("client_reference_id")).toBe("11111111-2222-3333-4444-555555555555");
    expect(u.searchParams.get("prefilled_email")).toBe("ana@acme.test");
  });
  it("saldo del servidor y si alcanza", () => {
    const st = parseCoinStatus([{ coins: 120, free: false, own_ai_key: false, payer_is_agency: false }]);
    expect(st).toEqual({ coins: 120, free: false, ownAiKey: false, payerIsAgency: false });
    expect(alcanza(st, 100)).toBe(true);
    expect(alcanza(st, 200)).toBe(false);
    expect(alcanza({ ...st!, free: true }, 1e9)).toBe(true);
    expect(alcanza(null, 1)).toBe(false);
  });
});

describe("personalizar a 0,75 por lead, la lista entera al empezar (13-11-2026)", () => {
  it("lo que cuesta una lista (redondeado hacia arriba)", async () => {
    const { costePersonalizar } = await import("../../supabase/functions/_shared/coins");
    expect(costePersonalizar(1)).toBe(1);
    expect(costePersonalizar(4)).toBe(3);
    expect(costePersonalizar(100)).toBe(75);
    expect(costePersonalizar(1000)).toBe(750);
    expect(costePersonalizar(0)).toBe(0);
  });
  it("al terminar se devuelve lo que no salió bien", async () => {
    const { devolucionPersonalizar } = await import("../../supabase/functions/_shared/coins");
    expect(devolucionPersonalizar(75, 100)).toBe(0);   // todo bien
    expect(devolucionPersonalizar(75, 90)).toBe(7);    // 10 fallos → se devuelven 7 (75 − 68)
    expect(devolucionPersonalizar(75, 0)).toBe(75);    // parada antes de empezar
  });
});

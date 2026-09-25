import { describe, expect, it } from "vitest";
import { destinoChoose, planesEnTexto, textoDeTarjeta } from "@/lib/landing-links";

describe("planesEnTexto", () => {
  it("reconoce el plan y el periodo por el precio", () => {
    expect(planesEnTexto("Starter $17 /month")).toEqual([{ tier: "starter", periodo: "month" }]);
    expect(planesEnTexto("Growth $54 per month, billed yearly")).toEqual([{ tier: "growth", periodo: "year" }]);
    expect(planesEnTexto("Scale $170")).toEqual([{ tier: "scale", periodo: "month" }]);
  });
  it("no confunde otras cifras ni cantidades como 180,000", () => {
    expect(planesEnTexto("180,000 emails · $15 per extra client · $1,700")).toEqual([]);
  });
});

describe("destinoChoose", () => {
  it("sin enlace de pago creado todavía → registro con el plan anotado", () => {
    expect(destinoChoose("Growth $65 /month Choose")).toEqual({ kind: "route", to: "/auth?mode=signup&plan=growth&periodo=month" });
    expect(destinoChoose("Scale $141 /month billed yearly Choose")).toEqual({ kind: "route", to: "/auth?mode=signup&plan=scale&periodo=year" });
  });
  it("una zona con precios de varios planes no es una tarjeta", () => {
    expect(destinoChoose("Starter $17 Growth $65 Scale $170")).toBeNull();
    expect(destinoChoose("Start free today")).toBeNull();
  });
});

describe("textoDeTarjeta (DOM como el de la landing)", () => {
  document.body.innerHTML = `
    <section id="pricing">
      <div class="card"><h3>Starter</h3><p>$14</p><p>billed yearly</p><a id="c1" href="#signup">Choose</a></div>
      <div class="card"><h3>Growth</h3><p>$54</p><p>billed yearly</p><a id="c2" href="#signup">Choose</a></div>
      <div class="card"><h3>Scale</h3><p>$141</p><p>billed yearly</p><a id="c3" href="#signup">Choose</a></div>
    </section>
    <header><a id="hero" href="#signup">Start free</a></header>`;
  it("cada Choose lee SU tarjeta", () => {
    expect(destinoChoose(textoDeTarjeta(document.getElementById("c1")))).toEqual({ kind: "route", to: "/auth?mode=signup&plan=starter&periodo=year" });
    expect(destinoChoose(textoDeTarjeta(document.getElementById("c3")))).toEqual({ kind: "route", to: "/auth?mode=signup&plan=scale&periodo=year" });
  });
  it("el botón de registro de arriba sigue yendo al registro normal", () => {
    expect(destinoChoose(textoDeTarjeta(document.getElementById("hero")))).toBeNull();
  });
});

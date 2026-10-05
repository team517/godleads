import { describe, expect, it } from "vitest";
import { disableA, enableSlot, promotableSlot, removeA, versionsOf, type VariantState } from "@/lib/step-variants";

/* Apagar o borrar la versión A (05-10-2026, petición del dueño: "que me deje desactivar la A, o
 * borrarla, y la B se vuelva la A"). El motor siempre envía el texto del paso, así que la B pasa a
 * ser ese texto; la A apagada se guarda donde estaba la B. */

const st = (variants: any[], off: any[] = []): VariantState => ({ variants, off });
const A = { subject: "Asunto A", body: "cuerpo A" };
const B = { subject: "Asunto B", body: "cuerpo B" };
const C = { subject: "Asunto C", body: "cuerpo C" };

describe("apagar la A", () => {
  it("la B pasa a ser la A y la A queda apagada en el sitio de la B", () => {
    const r = disableA(st([B, C]), A)!;
    expect(r.base).toEqual({ subject: "Asunto B", body: "cuerpo B" });
    expect(r.promoted).toBe(1);
    expect(r.state.variants).toEqual([C]);                       // lo que se envía: A(=B) y C
    const v = versionsOf(r.state);
    expect(v.map((x) => [x.label, x.enabled, x.variant?.body ?? null])).toEqual([
      ["A", true, null], ["B", false, "cuerpo A"], ["C", true, "cuerpo C"],
    ]);
  });

  it("se puede volver a encender la antigua A (como B)", () => {
    const r = disableA(st([B]), A)!;
    const back = enableSlot(r.state, 1);
    expect(back.variants).toEqual([{ subject: "Asunto A", body: "cuerpo A", tag_filter: null }]);
    expect(back.off).toEqual([]);
  });

  it("sin ninguna otra versión encendida no se puede (el paso se quedaría sin nada que enviar)", () => {
    expect(disableA(st([]), A)).toBeNull();
    expect(disableA(st([], [{ ...B, off_slot: 1 }]), A)).toBeNull();
  });

  it("una variante con filtro de etiqueta no puede ser la A: pasa la siguiente sin filtro", () => {
    const Bt = { ...B, tag_filter: "es" };
    expect(promotableSlot(st([Bt, C]))).toBe(2);
    const r = disableA(st([Bt, C]), A)!;
    expect(r.base.body).toBe("cuerpo C");
    expect(versionsOf(r.state).map((x) => [x.label, x.enabled, x.variant?.body ?? null])).toEqual([
      ["A", true, null], ["B", true, "cuerpo B"], ["C", false, "cuerpo A"],
    ]);
    expect(disableA(st([Bt]), A)).toBeNull();
  });

  it("una B sin asunto hereda el asunto de la A (como al enviarla)", () => {
    const r = disableA(st([{ subject: "", body: "cuerpo B" }]), A)!;
    expect(r.base).toEqual({ subject: "Asunto A", body: "cuerpo B" });
  });

  it("si la B está apagada, la C pasa a ser la A", () => {
    const r = disableA(st([C], [{ ...B, off_slot: 1 }]), A)!;
    expect(r.base.body).toBe("cuerpo C");
    expect(r.promoted).toBe(2);
    expect(r.state.variants).toEqual([]);
    expect(versionsOf(r.state).map((x) => [x.label, x.enabled, x.variant?.body ?? null])).toEqual([
      ["A", true, null], ["B", false, "cuerpo B"], ["C", false, "cuerpo A"],
    ]);
  });
});

describe("borrar la A", () => {
  it("la B pasa a ser la A y la C pasa a ser la B", () => {
    const r = removeA(st([B, C]), A)!;
    expect(r.base).toEqual({ subject: "Asunto B", body: "cuerpo B" });
    expect(r.state.variants).toEqual([C]);
    expect(versionsOf(r.state).map((x) => x.label)).toEqual(["A", "B"]);
  });

  it("las apagadas de detrás suben una letra", () => {
    const r = removeA(st([B], [{ ...C, off_slot: 2 }]), A)!;
    expect(r.state.off).toEqual([{ ...C, off_slot: 1 }]);
    expect(versionsOf(r.state).map((x) => [x.label, x.enabled])).toEqual([["A", true], ["B", false]]);
  });

  it("sin otra versión encendida no se borra", () => {
    expect(removeA(st([]), A)).toBeNull();
  });
});

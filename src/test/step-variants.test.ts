import { describe, expect, it } from "vitest";
import {
  addVariantTo, disableAll, disableSlot, enableAll, enableSlot, hasLiveVariants,
  removeSlot, versionsOf, writeSlot, type VariantState,
} from "@/lib/step-variants";

/* Apagar una variante NO la borra: se guarda en otra columna que el motor de envío no lee,
 * así que deja de enviarse sin perder lo escrito. Esto fija esa promesa. */

const st = (variants: any[], off: any[] = []): VariantState => ({ variants, off });
const B = { subject: "B", body: "cuerpo B" };
const C = { subject: "C", body: "cuerpo C" };

describe("versiones de un correo", () => {
  it("siempre hay una A, y es el propio correo", () => {
    const v = versionsOf(st([]));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ slot: 0, label: "A", enabled: true, variant: null });
  });

  it("las variantes son B, C… en orden", () => {
    expect(versionsOf(st([B, C])).map((v) => v.label)).toEqual(["A", "B", "C"]);
  });
});

describe("apagar y encender", () => {
  it("apagar la B la saca de lo que se envía, pero no la pierde", () => {
    const next = disableSlot(st([B, C]), 1);
    expect(next.variants).toEqual([C]);                       // el motor ya no la ve
    expect(next.off).toEqual([{ ...B, off_slot: 1 }]);        // el texto sigue ahí
    const v = versionsOf(next);
    expect(v.map((x) => x.label)).toEqual(["A", "B", "C"]);   // la letra no baila
    expect(v[1]).toMatchObject({ label: "B", enabled: false });
    expect(v[1].variant).toMatchObject({ subject: "B" });
    expect(v[2]).toMatchObject({ label: "C", enabled: true });
  });

  it("encenderla otra vez la devuelve a su sitio", () => {
    const apagada = disableSlot(st([B, C]), 1);
    const back = enableSlot(apagada, 1);
    expect(back.off).toEqual([]);
    expect(back.variants).toEqual([B, C]);                    // sin el off_slot y en su orden
  });

  it("el interruptor de la A apaga y enciende todas de golpe", () => {
    const todas = disableAll(st([B, C]));
    expect(todas.variants).toEqual([]);
    expect(hasLiveVariants(todas)).toBe(false);               // sólo se envía la A
    expect(versionsOf(todas).map((v) => v.label)).toEqual(["A", "B", "C"]);
    const vuelta = enableAll(todas);
    expect(vuelta.variants).toEqual([B, C]);
    expect(vuelta.off).toEqual([]);
  });

  it("apagar dos veces no duplica nada", () => {
    const uno = disableSlot(st([B]), 1);
    expect(disableSlot(uno, 1)).toEqual(uno);
    expect(enableSlot(st([B]), 1)).toEqual(st([B]));          // encender lo ya encendido no toca nada
  });
});

describe("escribir y borrar", () => {
  it("se puede seguir escribiendo en una variante apagada", () => {
    const apagada = disableSlot(st([B, C]), 1);
    const escrita = writeSlot(apagada, 1, { body: "cuerpo B corregido" });
    expect(escrita.off[0]).toMatchObject({ off_slot: 1, body: "cuerpo B corregido" });
    expect(escrita.variants).toEqual([C]);                    // lo que se envía no se toca
  });

  it("escribir en una encendida cambia lo que se envía", () => {
    expect(writeSlot(st([B, C]), 2, { subject: "C2" }).variants[1]).toMatchObject({ subject: "C2" });
  });

  it("la papelera sí borra, y las letras de detrás suben", () => {
    const conApagada = disableSlot(st([B, C]), 2);            // C apagada
    const sinB = removeSlot(conApagada, 1);                   // se borra la B
    expect(sinB.variants).toEqual([]);
    expect(sinB.off).toEqual([{ ...C, off_slot: 1 }]);        // la C pasa a ser la B
    expect(versionsOf(sinB).map((v) => v.label)).toEqual(["A", "B"]);
  });

  it("la A no se puede borrar: es el correo", () => {
    expect(removeSlot(st([B]), 0)).toEqual(st([B]));
  });
});

describe("añadir", () => {
  it("la nueva entra encendida y en el hueco siguiente", () => {
    const { state, slot } = addVariantTo(st([B]), { subject: "s", body: "b" });
    expect(slot).toBe(2);
    expect(state.variants).toHaveLength(2);
    expect(versionsOf(state).map((v) => v.label)).toEqual(["A", "B", "C"]);
  });

  it("cuenta también las apagadas para no pisar su letra", () => {
    const apagada = disableSlot(st([B]), 1);
    expect(addVariantTo(apagada, {}).slot).toBe(2);
  });
});

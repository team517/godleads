// Presentación del consumo del plan. Son cifras que el dueño lee para decidir si
// sube de plan, así que el redondeo y el umbral del aviso están fijados.
import { describe, expect, it } from "vitest";
import { familyNote, mailboxLine, monthlyEmailsLine, usagePct, usageTone } from "@/lib/plan-usage";
import { PLAN_CONFIG } from "@/contexts/SubscriptionContext";

const GROWTH = PLAN_CONFIG.growth.emailsPerMonth; // 180.000

describe("usageTone — el aviso salta al 80 % y se pone en rojo al 100 %", () => {
  it("por debajo del 80 % no avisa", () => {
    expect(usageTone(0, GROWTH)).toBe("ok");
    expect(usageTone(143_999, GROWTH)).toBe("ok");
  });
  it("del 80 % al 99 % avisa (ámbar)", () => {
    expect(usageTone(144_000, GROWTH)).toBe("warn"); // exactamente el 80 %
    expect(usageTone(179_999, GROWTH)).toBe("warn");
  });
  it("al llegar al tope, y pasándose, es destructivo", () => {
    expect(usageTone(180_000, GROWTH)).toBe("over");
    expect(usageTone(250_000, GROWTH)).toBe("over");
  });
  it("un plan sin tope nunca avisa", () => {
    expect(usageTone(9_999_999, Infinity)).toBe("ok");
    expect(usageTone(10, 0)).toBe("ok");
  });
});

describe("usagePct — la barra no se sale", () => {
  it("redondea al entero", () => {
    expect(usagePct(90_000, GROWTH)).toBe(50);
    expect(usagePct(1, GROWTH)).toBe(0);
  });
  it("se queda en 100 aunque se haya pasado", () => {
    expect(usagePct(400_000, GROWTH)).toBe(100);
  });
  it("sin tope no hay barra que llenar", () => {
    expect(usagePct(5, Infinity)).toBe(0);
  });
});

describe("las líneas que se leen en pantalla", () => {
  it("correos: cifra, tope y mes, con separador de miles español", () => {
    expect(monthlyEmailsLine(12_345, GROWTH)).toBe("12.345 de 180.000 correos este mes");
  });
  it("correos sin tope: sólo lo enviado", () => {
    expect(monthlyEmailsLine(12_345, Infinity)).toBe("12.345 correos este mes");
  });
  it("buzones: conectados contra los del plan", () => {
    expect(mailboxLine(37, PLAN_CONFIG.growth.maxAccounts)).toBe("37 de 200 buzones conectados");
    expect(mailboxLine(37, Infinity)).toBe("37 buzones conectados");
  });
});

describe("familyNote — de dónde sale la cifra", () => {
  it("con una sola cuenta no hay nada que explicar", () => {
    expect(familyNote(1)).toBeNull();
    expect(familyNote(0)).toBeNull();
  });
  it("con clientes lo dice, en singular y en plural", () => {
    expect(familyNote(2)).toBe("Incluye lo que envía la cuenta de tu cliente.");
    expect(familyNote(6)).toBe("Incluye lo que envían las 5 cuentas de tus clientes.");
  });
});

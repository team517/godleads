import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { isPaymentConfirmed } from "@/hooks/usePaymentConfirmation";
import { PlanSlider } from "@/components/pricing/PlanSlider";
import { PaymentProgress } from "@/components/pricing/PaymentProgress";

/* Pagos sin trampas (11-11-2026): el plan sólo cuenta cuando el SERVIDOR lo confirma (fila de
   user_entitlements escrita por el webhook firmado de Stripe); nunca un botón ni una URL. Y la barra
   nueva del plan a medida (píldoras de zona, pomo con la estrella, cifras debajo). */

describe("¿la fila del servidor confirma el pago?", () => {
  it("plan a medida: sólo con el nivel pedido y activo", () => {
    const want = { kind: "custom" as const, level: 5 };
    expect(isPaymentConfirmed(want, null, null)).toBe(false);
    expect(isPaymentConfirmed(want, { status: "active", custom_level: 4 }, null)).toBe(false);
    expect(isPaymentConfirmed(want, { status: "past_due", custom_level: 5 }, null)).toBe(false);
    expect(isPaymentConfirmed(want, { status: "incomplete", custom_level: 5 }, null)).toBe(false);
    expect(isPaymentConfirmed(want, { status: "active", custom_level: 5 }, null)).toBe(true);
  });
  it("cambio de plan: si ya tenía ese nivel antes de pagar, no cuenta (la fila tiene que CAMBIAR)", () => {
    const want = { kind: "custom" as const, level: 5 };
    expect(isPaymentConfirmed(want, { status: "active", custom_level: 5 }, { status: "active", custom_level: 5 })).toBe(false);
    expect(isPaymentConfirmed(want, { status: "active", custom_level: 5 }, { status: "active", custom_level: 3 })).toBe(true);
  });
  it("planes con prueba: trialing/active; con acceso previo sólo vale una suscripción distinta", () => {
    const want = { kind: "plan" as const };
    expect(isPaymentConfirmed(want, { status: "trialing" }, null)).toBe(true);
    expect(isPaymentConfirmed(want, { status: "canceled" }, null)).toBe(false);
    const antes = { status: "active", tier: "starter", stripe_subscription_id: null, custom_level: null };
    expect(isPaymentConfirmed(want, { ...antes }, antes)).toBe(false); // nada ha cambiado
    expect(isPaymentConfirmed(want, { ...antes, stripe_subscription_id: "sub_1", tier: "growth" }, antes)).toBe(true);
  });
});

describe("pantalla de pago por fases", () => {
  it("esperando: sin botón de 'ya he pagado'; si tarda, ofrece escribirnos", () => {
    render(<PaymentProgress stage="esperando" slow reopenUrl="https://buy.stripe.com/x" doneTitle="¡Listo!" />);
    expect(screen.getByText("Esperando tu pago en Stripe…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("payment-slow").textContent).toMatch(/Escríbenos/);
    expect(screen.getByRole("link", { name: /Volver a abrir el pago/ })).toHaveAttribute("href", "https://buy.stripe.com/x");
  });
  it("procesando y listo son fases distintas", async () => {
    const { rerender } = render(<PaymentProgress stage="procesando" doneTitle="¡Listo! Tu plan" />);
    expect(screen.getByText("Pago recibido · Procesando tu plan…")).toBeTruthy();
    expect(screen.queryByText("¡Listo! Tu plan")).toBeNull();
    rerender(<PaymentProgress stage="listo" doneTitle="¡Listo! Tu plan" />);
    expect(await screen.findByText("¡Listo! Tu plan")).toBeTruthy();
  });
});

describe("barra del plan a medida", () => {
  const VALUES = [250_000, 400_000, 600_000, 800_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000];
  const ZONES = [{ label: "Básico", from: 1, to: 3 }, { label: "Profesional", from: 4, to: 6 }, { label: "Empresarial", from: 7, to: 10 }];
  const fmt = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);
  function Harness({ start = 3, onChange = vi.fn() }: { start?: number; onChange?: (n: number) => void }) {
    const [lv, setLv] = useState(start);
    return <PlanSlider level={lv} onChange={(n) => { setLv(n); onChange(n); }} zones={ZONES} values={VALUES} format={fmt} ariaLabel="Envíos al mes" valueText={(n) => `nivel ${n}`} />;
  }

  it("teclado: ← → Inicio Fin y nunca sale de 1–10", () => {
    render(<Harness />);
    const k = screen.getByRole("slider");
    expect(k).toHaveAttribute("aria-valuenow", "3");
    fireEvent.keyDown(k, { key: "ArrowRight" });
    expect(k).toHaveAttribute("aria-valuenow", "4");
    fireEvent.keyDown(k, { key: "End" });
    expect(k).toHaveAttribute("aria-valuenow", "10");
    fireEvent.keyDown(k, { key: "ArrowRight" });
    expect(k).toHaveAttribute("aria-valuenow", "10");
    fireEvent.keyDown(k, { key: "Home" });
    expect(k).toHaveAttribute("aria-valuenow", "1");
  });
  it("la píldora de la zona elegida se rellena; pulsar otra zona salta a ella", () => {
    render(<Harness start={2} />);
    expect(screen.getByTestId("zone-0")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("zone-1")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("zone-2"));
    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toMatch(/^(8|9)$/);
    expect(screen.getByTestId("zone-2")).toHaveAttribute("aria-pressed", "true");
  });
  it("cifra elegida resaltada debajo y las de referencia no se solapan con ella", () => {
    render(<Harness start={1} />);
    expect(screen.getByTestId("plan-slider-value").textContent).toBe("250K");
    // La de referencia del nivel 1 se esconde (la elegida ocupa su sitio); quedan la del medio y la última.
    expect(screen.getAllByText("250K")).toHaveLength(1);
    expect(screen.getByText("5M")).toBeTruthy();
  });
});

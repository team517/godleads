import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/* Aviso del 80 / 95 / 100 % en el panel (12-11-2026): sólo lo ve el DUEÑO del plan con
   suscripción; la cuenta de un cliente no pregunta nada (lo gestiona su agencia). */

const st = vi.hoisted(() => ({
  invoke: vi.fn(),
  profile: { client_login_of: null as string | null },
  status: "active",
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: st.invoke } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: `u-${st.status}-${st.profile.client_login_of}` } }) }));
vi.mock("@/contexts/ProfileContext", () => ({ useProfile: () => ({ profile: st.profile }) }));
vi.mock("@/contexts/SubscriptionContext", () => ({ useSubscription: () => ({ status: st.status, loading: false }) }));

import { PlanUsageBanner } from "@/components/PlanUsageBanner";
import { __resetPlanAlertCache } from "@/hooks/usePlanUsageAlert";

const pintar = () => render(<MemoryRouter><PlanUsageBanner /></MemoryRouter>);

describe("aviso de consumo del plan", () => {
  beforeEach(() => {
    __resetPlanAlertCache(); localStorage.clear(); st.invoke.mockReset();
    st.profile = { client_login_of: null }; st.status = "active";
    st.invoke.mockResolvedValue({ data: { level: 95, pct: 96, sent: 14400, limit: 15000, plan: "Starter", period_start: "2026-11-01", accounts: 2 }, error: null });
  });

  it("el dueño con plan ve el aviso con «Mejorar plan» y lo puede cerrar", async () => {
    pintar();
    expect(await screen.findByText("Llevas el 95 % de tus envíos de este mes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mejorar plan/ })).toHaveAttribute("href", "/settings?tab=plan");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar el aviso" }));
    await waitFor(() => expect(screen.queryByText(/Llevas el 95 %/)).toBeNull());
    expect(localStorage.getItem("fl_plan_alert_dismissed:2026-11-01:95")).toBe("1");
  });

  it("la cuenta de un cliente no pregunta ni ve avisos de plan", async () => {
    st.profile = { client_login_of: "cliente-1" };
    pintar();
    await new Promise((r) => setTimeout(r, 20));
    expect(st.invoke).not.toHaveBeenCalled();
    expect(screen.queryByText(/envíos de este mes/)).toBeNull();
  });

  it("sin suscripción de pago (equipo, cuentas gratis) tampoco", async () => {
    st.status = "free";
    pintar();
    await new Promise((r) => setTimeout(r, 20));
    expect(st.invoke).not.toHaveBeenCalled();
  });

  it("por debajo del 80 % no sale nada", async () => {
    st.invoke.mockResolvedValue({ data: { level: null, pct: 40, sent: 6000, limit: 15000 }, error: null });
    pintar();
    await waitFor(() => expect(st.invoke).toHaveBeenCalledWith("plan-usage-alerts", { body: {} }));
    expect(screen.queryByText(/envíos de este mes/)).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/* Alta con tarjeta (11-11-2026): un registro nuevo sin prueba con tarjeta inicia sesión y NO ve el
   panel, sino "Activa tu prueba gratuita". Con la suscripción en prueba, entra normal. */
const st = vi.hoisted(() => ({ needsCard: true, subscribed: false }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "nuevo@acme.com" }, loading: false, signOut: vi.fn() }) }));
vi.mock("@/contexts/SubscriptionContext", async () => {
  const real = await vi.importActual<any>("@/contexts/SubscriptionContext");
  return { ...real, useSubscription: () => ({ loading: false, trialExpired: false, subscribed: st.subscribed, paymentProblem: null, needsCard: st.needsCard, status: st.needsCard ? "needs_card" : "trialing", refreshSubscription: vi.fn() }) };
});
vi.mock("@/contexts/ProfileContext", () => ({ useProfile: () => ({ profile: { allowed_routes: null, is_client_manager: false, paused_by_admin_at: null }, loading: false }) }));
vi.mock("@/hooks/useWelcomeGate", () => ({ useWelcomeGate: () => "done" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, auth: { signUp: vi.fn() }, from: vi.fn() } }));

import { ProtectedRoute } from "@/components/ProtectedRoute";

const pinta = () => render(<MemoryRouter initialEntries={["/dashboard"]}><ProtectedRoute><p>PANEL</p></ProtectedRoute></MemoryRouter>);

describe("ProtectedRoute — alta con tarjeta", () => {
  it("sin prueba con tarjeta: 'Activa tu prueba gratuita', nunca el panel", () => {
    st.needsCard = true; st.subscribed = false;
    pinta();
    expect(screen.getByText("Activa tu prueba gratuita")).toBeTruthy();
    expect(screen.queryByText("PANEL")).toBeNull();
  });
  it("con la prueba de Stripe activa: entra al panel", () => {
    st.needsCard = false; st.subscribed = true;
    pinta();
    expect(screen.getByText("PANEL")).toBeTruthy();
  });
});

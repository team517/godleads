import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  alertEmailHtml, alertSubject, crossedThresholds, madridDate, monthlyLimitFor, thresholdToEmail, usagePct,
} from "../../supabase/functions/plan-usage-alerts/rules";
import { planAlertCopy, planAlertDismissKey, toPlanAlert } from "@/lib/plan-alerts";
import { agencyLoginUrl, slugify } from "@/lib/client-access";
import { decideAccess } from "@/lib/access";

/* Clientes con marca propia y avisos del plan (12-11-2026):
   · cada agencia tiene su entrada /acceso/<slug> con SU logo, y sólo entran sus clientes;
   · la cuenta de un cliente nunca ve el muro de pago (paga su agencia);
   · el dueño recibe avisos al 80 / 95 / 100 % de los envíos del mes, un correo por umbral. */

const sb = vi.hoisted(() => ({
  rpc: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  session: { value: null as any },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: sb.rpc,
    auth: {
      signInWithPassword: sb.signIn,
      signOut: sb.signOut,
      getSession: vi.fn(async () => ({ data: { session: sb.session.value } })),
    },
  },
}));

import AccesoCliente, { withAlpha } from "@/pages/AccesoCliente";

function Donde() { const l = useLocation(); return <p data-testid="donde">{l.pathname}</p>; }
const pintar = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/acceso/:slug" element={<AccesoCliente />} />
      <Route path="/acceso-cliente" element={<AccesoCliente />} />
      <Route path="/dashboard" element={<Donde />} />
    </Routes>
  </MemoryRouter>,
);

const BRAND = { agency_name: "Agencia Norte", logo_url: "https://cdn.test/norte.png", brand_color: "#0EA5E9" };
const rpcRoutes = (r: Record<string, unknown>) => sb.rpc.mockImplementation(async (fn: string) => ({ data: r[fn] ?? null, error: null }));

describe("avisos del plan (servidor, reglas puras)", () => {
  it("tope del plan: Starter/Growth/Scale, a medida y sin plan de pago", () => {
    expect(monthlyLimitFor({ tier: "starter", status: "active" })).toEqual({ limit: 15000, label: "Starter" });
    expect(monthlyLimitFor({ tier: "growth", status: "trialing" })?.limit).toBe(180000);
    expect(monthlyLimitFor({ tier: "scale", status: "active", plan_emails_month: 1000000, custom_level: 5 })).toEqual({ limit: 1000000, label: "a medida (nivel 5)" });
    expect(monthlyLimitFor({ tier: "scale", status: "canceled" })).toBeNull();
    expect(monthlyLimitFor(null)).toBeNull();
  });
  it("el mes del aviso es el de Madrid (el 1 a las 00:00 de allí no es el 31 en UTC)", () => {
    expect(madridDate(new Date("2026-10-31T23:00:00Z"))).toBe("2026-11-01");
  });
  it("umbrales: 80, 95 y 100 %", () => {
    expect(usagePct(12000, 15000)).toBe(80);
    expect(crossedThresholds(11999, 15000)).toEqual([]);
    expect(crossedThresholds(12000, 15000)).toEqual([80]);
    expect(crossedThresholds(14300, 15000)).toEqual([80, 95]);
    expect(crossedThresholds(16000, 15000)).toEqual([80, 95, 100]);
  });
  it("un solo correo por salto (el umbral más alto nuevo) y nunca repetido", () => {
    expect(thresholdToEmail([80, 95, 100], [])).toBe(100);
    expect(thresholdToEmail([80, 95], [80])).toBe(95);
    expect(thresholdToEmail([80, 95], [80, 95])).toBeNull();
  });
  it("el correo: cifras, aviso de clientes y botón a mejorar plan", () => {
    const html = alertEmailHtml({ level: 95, sent: 14300, limit: 15000, planLabel: "Starter", link: "https://www.funnyleads.com/settings?tab=plan", clientAccounts: 3 });
    expect(html).toContain("Llevas el 95 % de tus envíos de este mes");
    expect(html).toContain("14.300");
    expect(html).toContain("cuentas de tus clientes (2)");
    expect(html).toContain('href="https://www.funnyleads.com/settings?tab=plan"');
    expect(alertSubject(100)).toMatch(/límite/);
  });
});

describe("avisos del plan (pantalla)", () => {
  it("de la respuesta al aviso, con texto y tono por nivel", () => {
    expect(toPlanAlert({ limit: null })).toBeNull();
    expect(toPlanAlert({ level: null, limit: 15000 })).toBeNull();
    const a = toPlanAlert({ level: 95, pct: 95.3, sent: 14300, limit: 15000, plan: "Starter", period_start: "2026-11-01", accounts: 2 })!;
    expect(planAlertCopy(a)).toMatchObject({ title: "Llevas el 95 % de tus envíos de este mes", tone: "warning" });
    expect(planAlertCopy(a).text).toMatch(/Deberías aumentar el plan/);
    expect(planAlertCopy(a).text).toMatch(/tus clientes/);
    expect(planAlertCopy({ ...a, level: 100 }).tone).toBe("danger");
    // Cerrar el aviso del 80 % no oculta el del 95 %.
    expect(planAlertDismissKey({ periodStart: "2026-11-01", level: 80 })).not.toBe(planAlertDismissKey({ periodStart: "2026-11-01", level: 95 }));
  });
});

describe("cuenta de cliente y acceso", () => {
  it("una cuenta de cliente nunca ve el muro de pago, aunque no tenga secciones", () => {
    const base = { email: "c@x.com", role: "client", isClientManager: false, allowedRoutes: [], contactEmail: null, createdAt: "2026-11-12T10:00:00Z", stripeSubscribed: false, entitlement: null };
    expect(decideAccess({ ...base } as any).kind).toBe("needs_card");
    expect(decideAccess({ ...base, clientLogin: true } as any).kind).toBe("free");
  });
  it("enlace y dirección de la agencia", () => {
    expect(agencyLoginUrl("https://www.funnyleads.com/", "agencia-norte")).toBe("https://www.funnyleads.com/acceso/agencia-norte");
    expect(agencyLoginUrl("https://www.funnyleads.com", null)).toBe("https://www.funnyleads.com/acceso-cliente");
    expect(slugify("Clínica Vera S.L.")).toBe("clinica-vera-s-l");
    expect(withAlpha("#0EA5E9", 0.5)).toBe("rgba(14, 165, 233, 0.5)");
  });
});

describe("entrada exclusiva de clientes (/acceso/<slug>)", () => {
  beforeEach(() => { sb.rpc.mockReset(); sb.signIn.mockReset(); sb.signOut.mockClear(); sb.session.value = null; localStorage.clear(); });

  it("enseña el logo y el nombre de la AGENCIA, sin registro ni marca de Funnyleads", async () => {
    rpcRoutes({ client_login_branding: [BRAND] });
    pintar("/acceso/agencia-norte");
    expect(await screen.findByText("Entra en tu panel de Agencia Norte")).toBeInTheDocument();
    expect(screen.getByAltText("Agencia Norte")).toHaveAttribute("src", BRAND.logo_url);
    expect(screen.queryByText(/crear cuenta|regístrate|prueba gratis/i)).toBeNull();
    expect(screen.getByText(/Pídele una nueva a Agencia Norte/)).toBeInTheDocument();
    expect(sb.rpc).toHaveBeenCalledWith("client_login_branding", { p_slug: "agencia-norte" });
  });

  it("una dirección que no existe lo dice y no enseña formulario", async () => {
    rpcRoutes({ client_login_branding: [] });
    pintar("/acceso/no-existe");
    expect(await screen.findByText("Esta dirección de acceso no existe")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("un cliente de esa agencia entra y va a su panel", async () => {
    rpcRoutes({ client_login_branding: [BRAND], client_login_belongs: true });
    sb.signIn.mockResolvedValue({ data: {}, error: null });
    pintar("/acceso/agencia-norte");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "Ana@Cliente.com" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreta123" } });
    fireEvent.click(screen.getByRole("button", { name: /Entrar/ }));
    expect(await screen.findByTestId("donde")).toHaveTextContent("/dashboard");
    expect(sb.signIn).toHaveBeenCalledWith({ email: "ana@cliente.com", password: "secreta123" });
    expect(localStorage.getItem("fl_client_login_slug")).toBe("agencia-norte");
  });

  it("una cuenta que no es cliente de esa agencia no se queda dentro", async () => {
    rpcRoutes({ client_login_branding: [BRAND], client_login_belongs: false });
    sb.signIn.mockResolvedValue({ data: {}, error: null });
    pintar("/acceso/agencia-norte");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "otro@x.com" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secreta123" } });
    fireEvent.click(screen.getByRole("button", { name: /Entrar/ }));
    expect(await screen.findByText(/solo para los clientes de Agencia Norte/)).toBeInTheDocument();
    expect(sb.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(screen.queryByTestId("donde")).toBeNull();
  });

  it("contraseña mal: lo dice sin detalles técnicos", async () => {
    rpcRoutes({ client_login_branding: [BRAND] });
    sb.signIn.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    pintar("/acceso/agencia-norte");
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ana@cliente.com" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "mala" } });
    fireEvent.click(screen.getByRole("button", { name: /Entrar/ }));
    expect(await screen.findByText("El email o la contraseña no son correctos.")).toBeInTheDocument();
  });

  it("con la sesión ya abierta de un cliente de la agencia, ofrece entrar directamente", async () => {
    rpcRoutes({ client_login_branding: [BRAND], client_login_belongs: true });
    sb.session.value = { user: { email: "ana@cliente.com" } };
    pintar("/acceso/agencia-norte");
    expect(await screen.findByText(/Ya has iniciado sesión como/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Entrar en el panel/ }));
    await waitFor(() => expect(screen.getByTestId("donde")).toHaveTextContent("/dashboard"));
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PortalBuilding from "@/components/welcome/PortalBuilding";
import { pasosDelPortal, SECCIONES_PORTAL } from "@/lib/portal-build";

describe("Construyendo tu portal", () => {
  it("hace cada paso en orden y al final entra", async () => {
    const orden: string[] = [];
    const guardar = vi.fn(async () => { orden.push("prefs"); });
    const pre = Object.fromEntries(SECCIONES_PORTAL.map((s) => [s.id, async () => { orden.push(s.id); }]));
    const onDone = vi.fn();
    render(<PortalBuilding pasos={pasosDelPortal(guardar, pre)} onDone={onDone} minMs={0} />);
    expect(screen.getByText(/Construyendo/)).toBeInTheDocument();
    expect(screen.getByText("tu portal")).toBeInTheDocument();
    expect(screen.getByText("Creando tu espacio de campañas")).toBeInTheDocument();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(orden).toEqual(["prefs", "leads", "campaigns", "accounts", "unibox", "stats"]);
  });

  it("un paso que falla no deja a nadie fuera", async () => {
    const onDone = vi.fn();
    const pasos = pasosDelPortal(async () => { throw new Error("sin red"); }, {});
    render(<PortalBuilding pasos={pasos} onDone={onDone} minMs={0} />);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("no enseña ningún dominio ni análisis de web", () => {
    render(<PortalBuilding pasos={pasosDelPortal(async () => {}, {})} onDone={() => {}} minMs={0} />);
    expect(screen.queryByText(/Analizando/)).toBeNull();
  });
});

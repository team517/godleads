import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EmptyShowcase, { type EmptyVariant } from "@/components/EmptyShowcase";

describe("pantallas vacías", () => {
  it.each<[EmptyVariant, string]>([
    ["campaigns", "Oportunidades"],
    ["unibox", "Reunión agendada"],
    ["agents", "Agente de respuestas"],
    ["analytics", "Emails enviados"],
  ])("%s tiene su propia ilustración, su título y su botón", (variant, pieza) => {
    const onClick = vi.fn();
    render(<EmptyShowcase variant={variant} title="Nada todavía" text="Empieza aquí" cta={{ label: "Crear", onClick }} />);
    expect(screen.getByText(pieza)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nada todavía" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crear/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

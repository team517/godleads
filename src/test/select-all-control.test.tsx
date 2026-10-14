import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import SelectAllControl, { selectAllState } from "@/components/accounts/SelectAllControl";

/* Cuentas de email (14-10-2026): con el tag «whatsapp» activo, la casilla pregunta si las del tag o todas. */

const ALL = Array.from({ length: 80 }, (_, i) => `a${i}`);
const TAG = ALL.slice(0, 20);

// Radix abre el menú con el teclado (Enter) en jsdom; en el navegador, al pulsar.
const open = (el: HTMLElement) => { el.focus(); fireEvent.keyDown(el, { key: "Enter" }); };

describe("Seleccionar todo en Cuentas", () => {
  it("estado: nada / algunas / todas las visibles", () => {
    expect(selectAllState(TAG, new Set())).toBe(false);
    expect(selectAllState(TAG, new Set(["a1"]))).toBe("indeterminate");
    expect(selectAllState(TAG, new Set(TAG))).toBe(true);
    expect(selectAllState([], new Set(["a1"]))).toBe(false);
  });

  it("con un tag: «las 20 del tag» o «todas (80)»", async () => {
    const onChange = vi.fn();
    render(<SelectAllControl visibleIds={TAG} allIds={ALL} selected={new Set()} onChange={onChange} scopeLabel="«whatsapp»" />);
    open(screen.getByRole("button", { name: "Seleccionar cuentas" }));
    fireEvent.click(await screen.findByText("Seleccionar las 20 de «whatsapp»"));
    expect([...onChange.mock.calls[0][0]]).toEqual(TAG);

    open(screen.getByRole("button", { name: "Seleccionar cuentas" }));
    fireEvent.click(await screen.findByText("Seleccionar todas las cuentas (80)"));
    expect(onChange.mock.calls[1][0].size).toBe(80);
  });

  it("con algo marcado ofrece quitar la selección", async () => {
    const onChange = vi.fn();
    render(<SelectAllControl visibleIds={TAG} allIds={ALL} selected={new Set(["a3", "a50"])} onChange={onChange} scopeLabel="«whatsapp»" />);
    open(screen.getByRole("button", { name: "Seleccionar cuentas" }));
    fireEvent.click(await screen.findByText("Quitar selección (2)"));
    expect(onChange.mock.calls[0][0].size).toBe(0);
  });

  it("sin filtro es la casilla de siempre: marca o desmarca todas", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SelectAllControl visibleIds={ALL} allIds={ALL} selected={new Set()} onChange={onChange} scopeLabel={null} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar cuentas" }));
    expect(onChange.mock.calls[0][0].size).toBe(80);
    rerender(<SelectAllControl visibleIds={ALL} allIds={ALL} selected={new Set(ALL)} onChange={onChange} scopeLabel={null} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar cuentas" }));
    expect(onChange.mock.calls[1][0].size).toBe(0);
  });
});

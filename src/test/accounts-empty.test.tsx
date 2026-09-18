import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AccountsEmptyState from "@/components/accounts/AccountsEmptyState";

describe("Cuentas sin ninguna conectada", () => {
  it("invita a conectar la primera, con un solo botón", () => {
    const onAdd = vi.fn();
    render(<AccountsEmptyState onAdd={onAdd} />);
    expect(screen.getByText("Conecta una cuenta de envío")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Añadir cuenta/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("el CSV sólo se ofrece a quien puede usarlo", () => {
    const { rerender } = render(<AccountsEmptyState onAdd={vi.fn()} />);
    expect(screen.queryByText(/CSV/)).toBeNull();
    const onBulk = vi.fn();
    rerender(<AccountsEmptyState onAdd={vi.fn()} onBulk={onBulk} />);
    fireEvent.click(screen.getByText(/conecta varias a la vez/));
    expect(onBulk).toHaveBeenCalledTimes(1);
  });

  it("la tabla de ejemplo es decorado, no se lee ni se pulsa", () => {
    const { container } = render(<AccountsEmptyState onAdd={vi.fn()} />);
    const ghost = container.querySelector('[aria-hidden][class*="pointer-events-none"]');
    expect(ghost).not.toBeNull();
  });
});

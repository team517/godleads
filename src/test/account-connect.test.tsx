import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ConnectAccountForm from "@/components/accounts/ConnectAccountForm";
import { buildAccountPayload, type ConnectForm } from "@/lib/account-connect";

const empty: ConnectForm = {
  email: "", first_name: "", last_name: "",
  imap_username: "", imap_password: "", imap_host: "", imap_port: "993",
  smtp_username: "", smtp_password: "", smtp_host: "", smtp_port: "587",
  daily_limit: "50",
};

describe("buildAccountPayload", () => {
  it("Gmail: email + contraseña de aplicación → servidores de Google, usuario = email, sin espacios", () => {
    const r = buildAccountPayload({ ...empty, email: "  Ana@Gmail.com ", imap_password: "abcd efgh ijkl mnop" }, "gmail");
    expect(r).toEqual({
      ok: true,
      payload: expect.objectContaining({
        email: "ana@gmail.com", imap_username: "ana@gmail.com", smtp_username: "ana@gmail.com",
        imap_password: "abcdefghijklmnop", smtp_password: "abcdefghijklmnop",
        imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 587, daily_limit: 50,
      }),
    });
  });
  it("Gmail: la contraseña normal (no de 16 letras) se rechaza con explicación", () => {
    const r = buildAccountPayload({ ...empty, email: "ana@gmail.com", imap_password: "MiClave123" }, "gmail");
    expect(r).toEqual({ ok: false, error: expect.stringContaining("16 letras") });
  });
  it("Outlook: servidores de Microsoft aunque el formulario traiga otros", () => {
    const r = buildAccountPayload({ ...empty, email: "ana@outlook.com", imap_password: "secreta", smtp_host: "smtp.otro.com", imap_host: "imap.otro.com" }, "outlook");
    expect(r).toEqual({ ok: true, payload: expect.objectContaining({ imap_host: "outlook.office365.com", smtp_host: "smtp.office365.com", smtp_port: 587, smtp_username: "ana@outlook.com" }) });
  });
  it("SMTP: usuario = email y la contraseña de SMTP vale para IMAP si no se da otra", () => {
    const r = buildAccountPayload({ ...empty, email: "ana@empresa.es", smtp_host: " SMTP.ionos.es ", imap_host: "imap.ionos.es", smtp_password: "clave con espacios", smtp_port: "465", imap_port: "" }, "custom");
    expect(r).toEqual({
      ok: true,
      payload: expect.objectContaining({
        smtp_host: "smtp.ionos.es", smtp_port: 465, imap_port: 993,
        smtp_username: "ana@empresa.es", imap_username: "ana@empresa.es",
        smtp_password: "clave con espacios", imap_password: "clave con espacios",
      }),
    });
  });
  it("SMTP: credenciales de IMAP distintas se respetan", () => {
    const r = buildAccountPayload({ ...empty, email: "a@b.es", smtp_host: "smtp.b.es", imap_host: "imap.b.es", smtp_username: "envio", smtp_password: "p1", imap_username: "lectura", imap_password: "p2" }, "custom");
    expect(r).toEqual({ ok: true, payload: expect.objectContaining({ smtp_username: "envio", smtp_password: "p1", imap_username: "lectura", imap_password: "p2" }) });
  });
  it("valida email, contraseña y servidores", () => {
    expect(buildAccountPayload(empty, "gmail")).toEqual({ ok: false, error: expect.stringContaining("email") });
    expect(buildAccountPayload({ ...empty, email: "no-es-email" }, "outlook")).toEqual({ ok: false, error: expect.stringContaining("válido") });
    expect(buildAccountPayload({ ...empty, email: "a@b.es" }, "outlook")).toEqual({ ok: false, error: expect.stringContaining("contraseña") });
    expect(buildAccountPayload({ ...empty, email: "a@b.es", smtp_password: "x" }, "custom")).toEqual({ ok: false, error: expect.stringContaining("SMTP") });
    expect(buildAccountPayload({ ...empty, email: "a@b.es", smtp_password: "x", smtp_host: "smtp.b.es" }, "custom")).toEqual({ ok: false, error: expect.stringContaining("IMAP") });
    expect(buildAccountPayload({ ...empty, email: "a@b.es", smtp_password: "x", smtp_host: "http://smtp", imap_host: "imap.b.es" }, "custom")).toEqual({ ok: false, error: expect.stringContaining("SMTP") });
    expect(buildAccountPayload({ ...empty, email: "a@b.es", smtp_host: "smtp.b.es", imap_host: "imap.b.es" }, "custom")).toEqual({ ok: false, error: expect.stringContaining("contraseña") });
  });
  it("límite diario vacío o inválido → 30", () => {
    const r = buildAccountPayload({ ...empty, email: "a@outlook.com", imap_password: "x", daily_limit: "" }, "outlook");
    expect(r).toEqual({ ok: true, payload: expect.objectContaining({ daily_limit: 30 }) });
  });
});

describe("ConnectAccountForm", () => {
  it("Gmail: sólo email + contraseña de aplicación (sin servidores) y enlace a Google", () => {
    const onChange = vi.fn();
    render(<ConnectAccountForm provider="gmail" form={empty} onChange={onChange} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("Servidor SMTP")).toBeNull();
    expect(screen.getByRole("link", { name: /Google/ })).toHaveAttribute("href", "https://myaccount.google.com/apppasswords");
    fireEvent.change(screen.getByLabelText("Contraseña de aplicación"), { target: { value: "abcd" } });
    expect(onChange).toHaveBeenCalledWith({ imap_password: "abcd", smtp_password: "abcd" });
  });
  it("Outlook: mismo formulario con el enlace de Microsoft", () => {
    render(<ConnectAccountForm provider="outlook" form={empty} onChange={vi.fn()} />);
    expect(screen.getByRole("link", { name: /Microsoft/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Servidor IMAP")).toBeNull();
  });
  it("SMTP: pide los dos servidores; credenciales de IMAP sólo si son distintas", () => {
    const onChange = vi.fn();
    render(<ConnectAccountForm provider="custom" form={empty} onChange={onChange} />);
    expect(screen.getByLabelText("Servidor SMTP")).toBeInTheDocument();
    expect(screen.getByLabelText("Servidor IMAP")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Usuario")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText(/Mismo usuario y contraseña/));
    expect(screen.getAllByLabelText("Usuario")).toHaveLength(2);
  });
});

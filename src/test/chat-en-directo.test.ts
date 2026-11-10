import { describe, expect, it } from "vitest";
import {
  clienteMirando, correoDeContacto, correoMensajeChat, correoRespuestaAlCliente, debeAvisarEquipo,
  NOTIFY_THROTTLE_MS, nombreDeAutor, TEAM_MESSAGE_MAX, validarMensajeEquipo,
} from "../../supabase/functions/_shared/chat-hub-rules";

/* Chat en directo con el equipo (10-11-2026): validaciones y el aviso a team@ como mucho cada 10 min. */
const NOW = Date.parse("2026-11-10T12:00:00Z");

describe("debeAvisarEquipo — aviso a team@", () => {
  it("el primer mensaje de un hilo siempre avisa", () => {
    expect(debeAvisarEquipo(null, NOW)).toBe(true);
    expect(debeAvisarEquipo(undefined, NOW)).toBe(true);
    expect(debeAvisarEquipo("no es fecha", NOW)).toBe(true);
  });
  it("después, como mucho una vez cada 10 minutos", () => {
    expect(debeAvisarEquipo(new Date(NOW - 60_000).toISOString(), NOW)).toBe(false);
    expect(debeAvisarEquipo(new Date(NOW - NOTIFY_THROTTLE_MS + 1000).toISOString(), NOW)).toBe(false);
    expect(debeAvisarEquipo(new Date(NOW - NOTIFY_THROTTLE_MS).toISOString(), NOW)).toBe(true);
    expect(debeAvisarEquipo(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe(true);
  });
});

describe("validarMensajeEquipo", () => {
  it("recorta, quita controles y no deja vacíos", () => {
    expect(validarMensajeEquipo("  hola \u0007 ")).toEqual({ ok: true, value: "hola" });
    expect(validarMensajeEquipo("   ").ok).toBe(false);
    expect(validarMensajeEquipo(null).ok).toBe(false);
  });
  it("tope de 2000 caracteres", () => {
    expect(validarMensajeEquipo("a".repeat(TEAM_MESSAGE_MAX)).ok).toBe(true);
    expect(validarMensajeEquipo("a".repeat(TEAM_MESSAGE_MAX + 5)).ok).toBe(false);
  });
});

describe("contacto, autor y si el cliente está mirando", () => {
  it("correo de contacto normalizado o null", () => {
    expect(correoDeContacto("  Ana@Acme.COM ")).toBe("ana@acme.com");
    expect(correoDeContacto("ana@acme")).toBeNull();
    expect(correoDeContacto("")).toBeNull();
  });
  it("nombre de quien responde: perfil o parte del correo", () => {
    expect(nombreDeAutor("hello@onepulso.blog", "Xavi Riera")).toBe("Xavi Riera");
    expect(nombreDeAutor("hello@onepulso.blog", "")).toBe("Hello");
    expect(nombreDeAutor("maria.lopez@onepulso.online")).toBe("Maria lopez");
    expect(nombreDeAutor(null)).toBe("Equipo de Funnyleads");
  });
  it("cliente mirando = sondeó hace menos de 45 s", () => {
    expect(clienteMirando(new Date(NOW - 10_000).toISOString(), NOW)).toBe(true);
    expect(clienteMirando(new Date(NOW - 120_000).toISOString(), NOW)).toBe(false);
    expect(clienteMirando(null, NOW)).toBe(false);
  });
});

describe("correos", () => {
  it("aviso a team@ escapa el HTML y enlaza a Mensajes", () => {
    const c = correoMensajeChat({ quien: "ana@acme.com", cuenta: "Acme", mensaje: "<b>hola</b>", appUrl: "https://app", primero: true, previos: [{ role: "user", content: "¿precio?" }] });
    expect(c.subject).toBe("Nuevo chat: ana@acme.com");
    expect(c.html).toContain("&lt;b&gt;hola&lt;/b&gt;");
    expect(c.html).toContain("https://app/peticiones");
    expect(correoMensajeChat({ quien: "Visitante", cuenta: null, mensaje: "x", appUrl: "https://app", primero: false }).subject).toBe("Nuevo mensaje en el chat: Visitante");
  });
  it("respuesta al cliente con su enlace", () => {
    const c = correoRespuestaAlCliente({ autor: "Xavi", mensaje: "Te llamo mañana", enlace: "https://app/" });
    expect(c.subject).toContain("Xavi te ha respondido");
    expect(c.html).toContain("Te llamo mañana");
    expect(c.html).toContain('href="https://app/"');
  });
});

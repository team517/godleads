import { describe, expect, it } from "vitest";
import {
  TOUR_STEPS, canReplayTour, clampStep, dockSide, readingMs, shouldOfferTour, spotlightBox, tourMinutes, typedLength,
  type TourOfferInput,
} from "@/lib/tour";
import { findTarget, isSafeClick, navLink } from "@/components/tour/tour-dom";
import { availableSteps } from "@/components/tour/GuidedTour";

/* Tutorial guiado sobre la plataforma real: a quién se ofrece, los pasos, y cómo encuentra (y sólo
 * mira) las cosas de la pantalla de verdad. */

const base: TourOfferInput = {
  subscriptionStatus: "trialing", stateLoaded: true, tourState: null, welcomeDone: true, impersonating: false, pathname: "/dashboard",
};

describe("a quién se le ofrece el tutorial", () => {
  it("a una cuenta nueva con suscripción (prueba con tarjeta o plan activo) que aún no ha contestado", () => {
    expect(shouldOfferTour(base)).toBe(true);
    expect(shouldOfferTour({ ...base, subscriptionStatus: "active" })).toBe(true);
  });
  it("nunca a los clientes del portal de la agencia, al equipo ni a cuentas sin plan", () => {
    for (const s of ["free", "staff", "platform_trial", "expired", "needs_card", "payment_failed", "canceled", null, undefined]) {
      expect(shouldOfferTour({ ...base, subscriptionStatus: s as any }), String(s)).toBe(false);
    }
  });
  it("sólo una vez, nunca antes de la bienvenida, en el móvil (/m) ni con el cambio de cuenta", () => {
    expect(shouldOfferTour({ ...base, tourState: "done" })).toBe(false);
    expect(shouldOfferTour({ ...base, tourState: "skipped" })).toBe(false);
    expect(shouldOfferTour({ ...base, stateLoaded: false })).toBe(false);
    expect(shouldOfferTour({ ...base, welcomeDone: false })).toBe(false);
    expect(shouldOfferTour({ ...base, pathname: "/bienvenida" })).toBe(false);
    expect(shouldOfferTour({ ...base, pathname: "/m/inbox" })).toBe(false);
    expect(shouldOfferTour({ ...base, impersonating: true })).toBe(false);
  });
  it("volver a verlo: suscriptores y equipo, no el portal de la agencia", () => {
    expect(canReplayTour("active", false)).toBe(true);
    expect(canReplayTour("staff", true)).toBe(true);
    expect(canReplayTour("free", false)).toBe(false);
  });
});

describe("los pasos", () => {
  it("entre 12 y 18 pasos, del saludo al «Ya vas por libre», unos pocos minutos", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(12);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(18);
    expect(TOUR_STEPS[0].title).toMatch(/Soy Funny/);
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].title).toBe("¡Listo! Ya vas por libre");
    expect(tourMinutes()).toBeGreaterThanOrEqual(2);
    expect(tourMinutes()).toBeLessThanOrEqual(5);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });
  it("lo explica absolutamente todo: secuencia, variantes, límites, warm-up, Unibox, agentes, Funny Team…", () => {
    const all = TOUR_STEPS.map((s) => `${s.title} ${s.text}`).join(" ");
    for (const w of ["variante B", "{{personalized_message}}", "{{first_name}}", "warm-up", "slow ramp", "límite diario",
      "Interesados", "Fuera / Auto", "agente", "Entregabilidad", "Estadísticas", "Funny Team", "seguimientos"]) {
      expect(all, w).toContain(w);
    }
  });
  it("cada pantalla es una ruta real de la app, y lo que se abre de verdad está en la lista segura", () => {
    const rutas = ["/dashboard", "/campaigns", "/email-accounts", "/leads", "/unibox", "/ai-prompts", "/personalizacion", "/deliverability", "/stats", "/funny-team"];
    for (const s of TOUR_STEPS) if (s.route) expect(rutas, s.id).toContain(s.route);
    // Si lo señalado puede no existir (cuenta vacía), hay un texto para explicarlo igualmente.
    for (const s of TOUR_STEPS) if (s.open?.length) expect(s.missing, s.id).toBeTruthy();
  });
  it("las cuentas: texto que se escribe, tiempo de lectura, foco dentro de la pantalla y lado de Funny", () => {
    expect(typedLength("hola mundo", 0)).toBe(0);
    expect(typedLength("hola mundo", 100, 50)).toBe(5);
    expect(typedLength("hola", 99_999)).toBe(4);
    expect(readingMs("corto")).toBe(4000);
    expect(readingMs("x".repeat(200))).toBeGreaterThan(10_000);
    expect(spotlightBox({ left: 0, top: 10, width: 50, height: 20 }, 800, 600)).toEqual({ left: 4, top: 4, width: 54, height: 34 });
    expect(spotlightBox({ left: 780, top: 590, width: 50, height: 50 }, 800, 600, 8)).toEqual({ left: 772, top: 582, width: 24, height: 14 });
    expect(dockSide(null, 1200, 800)).toBe("left");
    expect(dockSide({ left: 40, top: 600, width: 200, height: 80 }, 1200, 800)).toBe("right");
    expect(dockSide({ left: 400, top: 100, width: 200, height: 80 }, 1200, 800)).toBe("left");
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(999)).toBe(TOUR_STEPS.length - 1);
  });
});

describe("la pantalla de verdad", () => {
  it("encuentra por selector y por texto, y no se inventa lo que no existe", () => {
    document.body.innerHTML = `
      <main><h1>Leads</h1><button>Exportar</button><label>Importar CSV</label>
        <button style="display:none">Ajustes</button></main>`;
    expect(findTarget([{ sel: "main button, main label", text: /Importar/ }])?.textContent).toBe("Importar CSV");
    expect(findTarget([{ sel: '[data-tour="nada"]' }, { sel: "main h1" }])?.textContent).toBe("Leads");
    expect(findTarget([{ sel: "main button", text: /^Ajustes$/ }])).toBeNull(); // oculto
    expect(findTarget([{ sel: '[aria-label="Añadir variante"]' }])).toBeNull();
  });
  it("sólo pulsa de verdad lo que abre (fila de campaña, pestañas): nunca crear, guardar ni borrar", () => {
    document.body.innerHTML = `
      <table><tbody><tr data-tour="campaign-row"><td>Mi campaña</td></tr></tbody></table>
      <button id="ed">Editor</button><button id="aj">Ajustes</button>
      <button id="del">Eliminar</button><button id="new">Crear campaña</button>
      <form><button id="f">Ajustes</button></form><button id="s" type="submit">Editor</button>`;
    const $ = (s: string) => document.querySelector(s);
    expect(isSafeClick($('[data-tour="campaign-row"]'))).toBe(true);
    expect(isSafeClick($("#ed"))).toBe(true);
    expect(isSafeClick($("#aj"))).toBe(true);
    expect(isSafeClick($("#del"))).toBe(false);
    expect(isSafeClick($("#new"))).toBe(false);
    expect(isSafeClick($("#f"))).toBe(false);
    expect(isSafeClick($("#s"))).toBe(false);
    expect(isSafeClick(null)).toBe(false);
  });
  it("se salta las pantallas que el menú de esta cuenta no tiene (permisos)", () => {
    document.body.innerHTML = `<aside><a href="/dashboard">Dashboard</a><a href="/campaigns">Campañas</a><a href="/unibox">Unibox</a></aside>`;
    expect(navLink("/unibox")).not.toBeNull();
    expect(navLink("/funny-team")).toBeNull();
    const ids = availableSteps().map((s) => s.id);
    expect(ids).toContain("unibox");
    expect(ids).toContain("variants");
    expect(ids).not.toContain("funny-team");
    expect(ids).not.toContain("accounts");
    expect(ids[0]).toBe("hola");
    expect(ids[ids.length - 1]).toBe("fin");
  });
});

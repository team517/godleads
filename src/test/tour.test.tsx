import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  TOUR_CHAPTERS, TOUR_TOTAL_MS, advanceClock, canReplayTour, chapterProgress, shouldOfferTour, type TourOfferInput,
} from "@/lib/tour";
import { CLICK_AFTER_MS, SCENES, TourShell, activeNav, renderScene, sceneChatOpen } from "@/components/tour/TourScenes";

/* Mini tutorial: a quién se ofrece, el reloj del reproductor y que cada clic del ratón cae en un
 * elemento que existe de verdad en la maqueta en ese momento. */

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
  it("sólo una vez: si ya dijo que sí o que no, no vuelve a salir", () => {
    expect(shouldOfferTour({ ...base, tourState: "done" })).toBe(false);
    expect(shouldOfferTour({ ...base, tourState: "skipped" })).toBe(false);
  });
  it("no molesta si no se sabe qué contestó (cargando o error), ni antes de la bienvenida", () => {
    expect(shouldOfferTour({ ...base, stateLoaded: false })).toBe(false);
    expect(shouldOfferTour({ ...base, welcomeDone: false })).toBe(false);
    expect(shouldOfferTour({ ...base, pathname: "/bienvenida" })).toBe(false);
    expect(shouldOfferTour({ ...base, pathname: "/m/inbox" })).toBe(false);
  });
  it("no se le pregunta al equipo cuando está dentro de la cuenta de un cliente", () => {
    expect(shouldOfferTour({ ...base, impersonating: true })).toBe(false);
  });
  it("volver a verlo: suscriptores y equipo, no el portal de la agencia", () => {
    expect(canReplayTour("active", false)).toBe(true);
    expect(canReplayTour("trialing", false)).toBe(true);
    expect(canReplayTour("staff", true)).toBe(true);
    expect(canReplayTour("free", false)).toBe(false);
  });
});

describe("capítulos y reloj", () => {
  it("nueve capítulos, unos dos minutos en total, y una escena por capítulo en el mismo orden", () => {
    expect(TOUR_CHAPTERS).toHaveLength(9);
    expect(TOUR_TOTAL_MS).toBeGreaterThanOrEqual(90_000);
    expect(TOUR_TOTAL_MS).toBeLessThanOrEqual(150_000);
    expect(SCENES.map((s) => s.id)).toEqual(TOUR_CHAPTERS.map((c) => c.id));
    for (const c of TOUR_CHAPTERS) expect(c.ms).toBeLessThanOrEqual(15_000);
  });
  it("explica las variantes y las variables", () => {
    const v = TOUR_CHAPTERS.find((c) => c.id === "variants")!;
    expect(v.text).toMatch(/variante B/);
    expect(v.text).toContain("{{personalized_message}}");
    expect(TOUR_CHAPTERS.find((c) => c.id === "leads")!.text).toContain("{{first_name}}");
  });
  it("el reloj pasa de capítulo al acabar cada uno y termina tras el último", () => {
    const first = TOUR_CHAPTERS[0].ms;
    expect(advanceClock({ chapter: 0, t: 0 }, 1000)).toEqual({ chapter: 0, t: 1000, finished: false });
    expect(advanceClock({ chapter: 0, t: first - 100 }, 300)).toEqual({ chapter: 1, t: 200, finished: false });
    expect(advanceClock({ chapter: 0, t: 0 }, TOUR_TOTAL_MS).finished).toBe(true);
    expect(advanceClock({ chapter: 0, t: 0 }, -50)).toEqual({ chapter: 0, t: 0, finished: false });
  });
  it("la barra: lo visto lleno, lo pendiente vacío y el actual a medias", () => {
    const c = { chapter: 2, t: TOUR_CHAPTERS[2].ms / 2 };
    expect(chapterProgress(c, 0)).toBe(1);
    expect(chapterProgress(c, 2)).toBeCloseTo(0.5);
    expect(chapterProgress(c, 3)).toBe(0);
  });
});

describe("la maqueta animada", () => {
  const renderAt = (i: number, t: number) => render(
    <div style={{ width: 960, height: 600 }}>
      <TourShell active={activeNav(i, t)} hover={null} chatOpen={sceneChatOpen(i, t)}>{renderScene(i, t, null)}</TourShell>
    </div>,
  );

  it("cada paso del ratón apunta a un elemento que está en pantalla cuando llega", () => {
    SCENES.forEach((scene, i) => {
      for (const step of scene.cursor) {
        const t = step.at + (step.click ? CLICK_AFTER_MS - 1 : 700);
        const { container, unmount } = renderAt(i, t);
        expect(container.querySelector(`[data-tour="${step.target}"]`), `${scene.id} → ${step.target} @${t}`).not.toBeNull();
        unmount();
      }
    });
  });
  it("cada capítulo acaba dentro de su tiempo (el último clic deja margen para verlo)", () => {
    SCENES.forEach((scene, i) => {
      const lastAt = Math.max(...scene.cursor.map((s) => s.at));
      expect(lastAt + CLICK_AFTER_MS, scene.id).toBeLessThan(TOUR_CHAPTERS[i].ms - 800);
    });
  });
  it("el menú lateral sigue al ratón: Cuentas Email tras su clic, y antes la sección anterior", () => {
    const acc = SCENES.findIndex((s) => s.id === "accounts");
    expect(activeNav(acc, 0)).toBe("dashboard");
    expect(activeNav(acc, 5000)).toBe("accounts");
    const variants = SCENES.findIndex((s) => s.id === "variants");
    expect(activeNav(variants, 0)).toBe("campaigns");
  });
  it("variantes: aparece la B, se escribe {{personalized_message}} y la A se apaga", () => {
    const i = SCENES.findIndex((s) => s.id === "variants");
    const mid = renderAt(i, 5600);
    expect(mid.getByText("Variante B")).toBeTruthy();
    expect(mid.container.textContent).toContain("{{personalized_message}}");
    mid.unmount();
    const end = renderAt(i, 13_000);
    expect(end.getByText("Apagada")).toBeTruthy();
  });
  it("datos de ejemplo: ningún correo de la maqueta es de un dominio real", () => {
    const html = SCENES.map((_, i) => { const r = renderAt(i, 1e9); const h = r.container.innerHTML; r.unmount(); return h; }).join("");
    const emails = html.match(/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]+/gi) ?? [];
    expect(emails.length).toBeGreaterThan(0);
    for (const e of emails) expect(e, e).toMatch(/@(ventas|tuempresa)-ejemplo\.com$/);
  });
});

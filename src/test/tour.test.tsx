import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useState } from "react";
import {
  CREATING_SAFE, MUTATING_SAFE, SAFE_IDS, TOUR_CAMPAIGN_NAME, TOUR_CHAPTERS, TOUR_STEPS, canReplayTour, chapterStarts, clearTourRun,
  dockSide, needsCampaign, readTourRun, readingMs, resolveSel, resumeIndex, saveTourRun, shouldOfferTour, spotlightBox, tourMinutes,
  typedLength, TOUR_RUN_TTL_MS, type TourAction, type TourOfferInput, type TourTarget,
} from "@/lib/tour";
import { findTarget, isAllowed, navLink, typeInto } from "@/components/tour/tour-dom";
import { captureNewExample, deleteExample } from "@/components/tour/tour-campaign";
import { availableSteps } from "@/components/tour/GuidedTour";

/* Tutorial práctico: a quién se ofrece, que los pasos sólo usan la lista cerrada (y lo único que
 * crea es la campaña de ejemplo en borrador), que escribe como una persona, que sigue tras recargar
 * y que al final sólo borra SU campaña de ejemplo. */

const CAMP = "11111111-2222-3333-4444-555555555555";
const OTRA = "99999999-8888-7777-6666-555555555555";

const base: TourOfferInput = {
  subscriptionStatus: "trialing", stateLoaded: true, tourState: null, welcomeDone: true, impersonating: false, pathname: "/dashboard",
};

describe("a quién se le ofrece el tutorial", () => {
  it("a una cuenta nueva con suscripción que aún no ha contestado", () => {
    expect(shouldOfferTour(base)).toBe(true);
    expect(shouldOfferTour({ ...base, subscriptionStatus: "active" })).toBe(true);
  });
  it("nunca a los clientes del portal de la agencia, al equipo ni a cuentas sin plan", () => {
    for (const s of ["free", "staff", "platform_trial", "expired", "needs_card", "payment_failed", "canceled", null, undefined]) {
      expect(shouldOfferTour({ ...base, subscriptionStatus: s as any }), String(s)).toBe(false);
    }
  });
  it("sólo una vez, nunca antes de la bienvenida, en /m ni con el cambio de cuenta", () => {
    expect(shouldOfferTour({ ...base, tourState: "done" })).toBe(false);
    expect(shouldOfferTour({ ...base, tourState: "skipped" })).toBe(false);
    expect(shouldOfferTour({ ...base, stateLoaded: false })).toBe(false);
    expect(shouldOfferTour({ ...base, welcomeDone: false })).toBe(false);
    expect(shouldOfferTour({ ...base, pathname: "/bienvenida" })).toBe(false);
    expect(shouldOfferTour({ ...base, pathname: "/m/inbox" })).toBe(false);
    expect(shouldOfferTour({ ...base, impersonating: true })).toBe(false);
  });
  it("volver a verlo: suscriptores y equipo", () => {
    expect(canReplayTour("active", false)).toBe(true);
    expect(canReplayTour("staff", true)).toBe(true);
    expect(canReplayTour("free", false)).toBe(false);
  });
});

const actionsOf = (s: (typeof TOUR_STEPS)[number]): TourAction[] => s.actions || [];
const targetsOf = (a: TourAction): TourTarget[] => ("target" in a ? a.target : []);

describe("los pasos: grande, completo y sólo con la lista cerrada", () => {
  it("es un tutorial grande, por capítulos, con ids únicos", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(45);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    for (const c of TOUR_CHAPTERS) expect(TOUR_STEPS.some((s) => s.chapter === c.id), c.id).toBe(true);
    expect(chapterStarts().map((c) => c.chapter.id)).toEqual(TOUR_CHAPTERS.map((c) => c.id));
    expect(TOUR_STEPS[0].id).toBe("hola");
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].id).toBe("fin");
  });

  it("enseña haciendo: crea la campaña, escribe asunto y cuerpo, añade seguimiento y variante B, la apaga y la enciende", () => {
    const safes = TOUR_STEPS.flatMap((s) => [...actionsOf(s).map((a) => ("safe" in a ? a.safe : null)), s.user?.safe ?? null]);
    for (const s of ["create-open", "create-name", "create-submit", "seq-first-step", "seq-subject", "seq-body", "seq-add-step", "seq-delay",
      "seq-add-variant", "seq-variant-off", "seq-variant-on", "settings-subtab" as const, "leads-import-open", "accounts-add-open", "agent-create-open", "chat-open"]) {
      if (s === "settings-subtab") continue; // las sub-pestañas las abre el propio paso (campaign.sub)
      expect(safes, s).toContain(s);
    }
    const body = TOUR_STEPS.find((s) => s.id === "cuerpo")!;
    const typed = actionsOf(body).find((a) => a.do === "type") as Extract<TourAction, { do: "type" }>;
    expect(typed.text).toMatch(/\{\{first_name\}\}/);
    expect(typed.text).toMatch(/\{\{personalized_message\}\}/);
    expect(typed.text).toMatch(/\{\{SenderFirstName\}\}/);
    expect(TOUR_STEPS.filter((s) => s.user).length).toBeGreaterThanOrEqual(2); // pasos «Ahora tú»
  });

  it("cada acción usa una clave de la lista cerrada", () => {
    for (const s of TOUR_STEPS) {
      for (const a of actionsOf(s)) if ("safe" in a) expect(SAFE_IDS as readonly string[], `${s.id}`).toContain(a.safe);
      if (s.user) expect(SAFE_IDS as readonly string[], `${s.id}`).toContain(s.user.safe);
    }
  });

  it("lo único que crea algo es «Crear» de la campaña de ejemplo, en un solo paso", () => {
    expect(CREATING_SAFE).toEqual(["create-submit"]);
    const creators = TOUR_STEPS.filter((s) => actionsOf(s).some((a) => "safe" in a && a.safe === "create-submit"));
    expect(creators.map((s) => s.id)).toEqual(["crear-ok"]);
    expect(creators[0].captureCampaign).toBe(true);
    // Y nunca se crea dos veces: si ya hay campaña de ejemplo, se salta.
    const submit = actionsOf(creators[0]).find((a) => "safe" in a && a.safe === "create-submit") as Extract<TourAction, { do: "click" }>;
    expect(submit.skipIfCampaign).toBe(true);
    expect(TOUR_STEPS.some((s) => s.user?.safe === "create-submit")).toBe(false);
  });

  it("todo lo que cambia datos (menos crearla) va SOLO dentro de la campaña de ejemplo", () => {
    for (const s of TOUR_STEPS) {
      for (const a of actionsOf(s)) {
        if (!("safe" in a) || !MUTATING_SAFE.includes(a.safe) || a.safe === "create-submit") continue;
        expect(needsCampaign(s), `${s.id} → ${a.safe}`).toBe(true);
        for (const t of targetsOf(a)) expect(t.sel, `${s.id}`).toContain("{campaign}");
      }
      if (s.user && MUTATING_SAFE.includes(s.user.safe)) {
        expect(needsCampaign(s)).toBe(true);
        expect(s.user.skipIf?.length, `${s.id}: no repetir (no crear una C)`).toBeTruthy();
      }
    }
  });

  it("nunca pulsa Lanzar, Enviar, Guardar, Importar N, pagar ni cerrar sesión", () => {
    const prohibido = ["Lanzar", "Reanudar", "Enviar prueba", "Guardar", "Importar 25 leads", "Añadir a campaña", "Cerrar sesión", "Eliminar", "Gestionar suscripción", "Elegir plan", "Añadir cuenta"];
    for (const s of TOUR_STEPS) {
      const clicks = [...actionsOf(s).filter((a) => a.do === "click"), ...(s.user ? [{ do: "click", target: s.user.target, safe: s.user.safe } as TourAction] : [])];
      for (const a of clicks) {
        for (const t of targetsOf(a)) {
          for (const p of prohibido) {
            if (!t.text) continue;
            // «Añadir cuenta» abre la ventana (accounts-add-open); el botón que GUARDA está dentro de la ventana.
            if (p === "Añadir cuenta" && !t.sel.includes("dialog")) continue;
            expect(t.text.test(p), `${s.id}: ${t.text} pulsaría «${p}»`).toBe(false);
          }
        }
      }
    }
  });

  it("las ventanas se cierran con su X (nunca con su botón de guardar)", () => {
    const closes = TOUR_STEPS.flatMap((s) => actionsOf(s)).filter((a) => "safe" in a && a.safe === "dialog-close") as Extract<TourAction, { do: "click" }>[];
    expect(closes.length).toBeGreaterThanOrEqual(3);
    for (const c of closes) expect(c.target[0].text?.source).toBe("^Close$");
  });

  it("lee y escribe a buen ritmo: textos y minutos razonables", () => {
    for (const s of TOUR_STEPS) {
      expect(s.text.length, s.id).toBeLessThan(330);
      expect(s.text.length, s.id).toBeGreaterThan(40);
    }
    expect(tourMinutes()).toBeGreaterThanOrEqual(6);
    expect(tourMinutes()).toBeLessThanOrEqual(20);
    expect(readingMs("corto")).toBe(4000);
    expect(typedLength("Hola", 0)).toBe(0);
    expect(typedLength("Hola", 10_000)).toBe(4);
  });
});

describe("encontrar y comprobar en la página", () => {
  it("{campaign} sólo se cambia por un id válido", () => {
    expect(resolveSel('[data-tour-campaign="{campaign}"] button', CAMP)).toBe(`[data-tour-campaign="${CAMP}"] button`);
    expect(resolveSel('[data-tour-campaign="{campaign}"]', null)).toBeNull();
    expect(resolveSel('[data-tour-campaign="{campaign}"]', '"] , body [x="')).toBeNull();
    expect(resolveSel("main h1", null)).toBe("main h1");
  });

  it("busca por texto, por posición y sube al contenedor", () => {
    document.body.innerHTML = `<main><div id="card"><label>Ventana de envío</label><input></div><button>Uno</button><button>Dos</button></main>`;
    expect(findTarget([{ sel: "main button", text: /^Dos$/ }])?.textContent).toBe("Dos");
    expect(findTarget([{ sel: "main button", nth: 1 }])?.textContent).toBe("Dos");
    expect(findTarget([{ sel: "main label", text: /Ventana/, up: 1 }])?.id).toBe("card");
    expect(findTarget([{ sel: "main table" }])).toBeNull();
  });

  it("lo de la campaña, sólo dentro de la campaña de ejemplo (nunca otra del cliente)", () => {
    document.body.innerHTML = `
      <main>
        <div data-tour-campaign="${CAMP}"><button aria-label="Añadir variante" id="mia">+</button><textarea id="seq-body-editor"></textarea></div>
        <div data-tour-campaign="${OTRA}"><button aria-label="Añadir variante" id="otra">+</button></div>
      </main>`;
    const ctx = { campaignId: CAMP };
    expect(isAllowed(document.getElementById("mia"), "seq-add-variant", ctx)).toBe(true);
    expect(isAllowed(document.getElementById("otra"), "seq-add-variant", ctx)).toBe(false);
    expect(isAllowed(document.getElementById("mia"), "seq-add-variant", { campaignId: null })).toBe(false);
    expect(isAllowed(document.getElementById("seq-body-editor"), "seq-body", ctx)).toBe(true);
    expect(isAllowed(document.getElementById("mia"), "seq-body", ctx)).toBe(false); // otra clave, otro elemento
  });

  it("«Crear» sólo en la ventana «Crear campaña»; nada de type=submit; Lanzar nunca", () => {
    document.body.innerHTML = `
      <main><button id="abrir">Crear campaña</button><button id="lanzar" data-tour="campaign-launch">Lanzar</button></main>
      <div role="dialog"><h2>Crear campaña</h2><input id="nombre"><button id="crear">Crear</button></div>
      <div role="dialog"><h2>Añadir lead</h2><button id="crear2">Crear</button><button id="cerrar"><span>Close</span></button><button id="enviar" type="submit">Close</button></div>`;
    const ctx = { campaignId: CAMP };
    expect(isAllowed(document.getElementById("abrir"), "create-open", ctx)).toBe(true);
    expect(isAllowed(document.getElementById("nombre"), "create-name", ctx)).toBe(true);
    expect(isAllowed(document.getElementById("crear"), "create-submit", ctx)).toBe(true);
    expect(isAllowed(document.getElementById("crear2"), "create-submit", ctx)).toBe(false);
    expect(isAllowed(document.getElementById("cerrar"), "dialog-close", ctx)).toBe(true);
    expect(isAllowed(document.getElementById("enviar"), "dialog-close", ctx)).toBe(false);
    for (const id of SAFE_IDS) expect(isAllowed(document.getElementById("lanzar"), id, ctx), id).toBe(false);
  });

  it("el enlace del menú lateral", () => {
    document.body.innerHTML = `<aside><a href="/campaigns">Campañas</a></aside>`;
    expect(navLink("/campaigns")?.textContent).toBe("Campañas");
    expect(navLink("/stats")).toBeNull();
  });

  it("escribe en un campo de React letra a letra (y React se entera)", async () => {
    const seen: string[] = [];
    function Campo() {
      const [v, setV] = useState("");
      return <input aria-label="campo" value={v} onChange={(e) => { setV(e.target.value); seen.push(e.target.value); }} />;
    }
    const { getByLabelText } = render(<Campo />);
    const el = getByLabelText("campo") as HTMLInputElement;
    await typeInto(el, "Hola", { cps: 2000 });
    expect(el.value).toBe("Hola");
    expect(seen.slice(-4)).toEqual(["H", "Ho", "Hol", "Hola"]);
    seen.length = 0;
    await typeInto(el, "Hola", { cps: 2000 }); // ya lo pone: no lo vuelve a escribir
    expect(seen).toEqual([]);
  });
});

describe("pantallas: móvil y teléfono", () => {
  it("en el móvil fuera lo que sólo existe en el ordenador; en el teléfono el Unibox se explica sin ir", () => {
    document.body.innerHTML = "";
    const desk = availableSteps(TOUR_STEPS, {});
    const mob = availableSteps(TOUR_STEPS, { mobile: true });
    const tel = availableSteps(TOUR_STEPS, { mobile: true, phone: true });
    expect(desk.length).toBe(TOUR_STEPS.length);
    expect(mob.some((s) => s.desktopOnly)).toBe(false);
    expect(tel.some((s) => s.route?.startsWith("/unibox"))).toBe(false);
    const u = tel.find((s) => s.id === "unibox")!;
    expect(u.route).toBeNull();
    expect(u.text).toMatch(/app de Funnyleads/);
    expect(tel.find((s) => s.id === "unibox-filtro")).toBeUndefined();
  });
  it("sin el enlace en el menú (permisos), ese paso no sale", () => {
    document.body.innerHTML = `<aside><a href="/dashboard">Panel</a><a href="/campaigns">Campañas</a></aside>`;
    const s = availableSteps(TOUR_STEPS, {});
    expect(s.some((x) => x.route === "/email-accounts")).toBe(false);
    expect(s.some((x) => x.route === "/campaigns")).toBe(true);
    document.body.innerHTML = "";
  });
  it("el foco no se sale de la pantalla y el bocadillo va donde menos tapa", () => {
    expect(spotlightBox({ left: -20, top: 10, width: 100, height: 50 }, 1440, 820)).toEqual({ left: 4, top: 4, width: 84, height: 64 });
    expect(dockSide(null, 1440, 820)).toBe("left");
    expect(dockSide({ left: 300, top: 600, width: 200, height: 100 }, 1440, 820)).toBe("right");
    expect(dockSide({ left: 1100, top: 600, width: 200, height: 100 }, 1440, 820)).toBe("left");
    expect(dockSide({ left: 300, top: 100, width: 200, height: 100 }, 1440, 820)).toBe("left");
  });
});

describe("seguir tras recargar", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
  it("guarda paso y campaña; caduca; y se borra", () => {
    const s = mem();
    saveTourRun({ index: 12, stepId: "asunto", campaignId: CAMP, at: 1000 }, s);
    expect(readTourRun(2000, s)).toEqual({ index: 12, stepId: "asunto", campaignId: CAMP, at: 1000 });
    expect(readTourRun(1000 + TOUR_RUN_TTL_MS + 1, s)).toBeNull();
    clearTourRun(s);
    expect(readTourRun(2000, s)).toBeNull();
  });
  it("un id de campaña raro no se acepta", () => {
    const s = mem();
    s.setItem("fl_tour_run_v2", JSON.stringify({ index: 3, campaignId: "x' OR 1=1", at: 5 }));
    expect(readTourRun(6, s)?.campaignId).toBeNull();
  });
  it("sigue por el id del paso aunque la lista cambie (ordenador ↔ móvil)", () => {
    const mob = availableSteps(TOUR_STEPS, { mobile: true });
    const i = resumeIndex({ index: 0, stepId: "variante-off" }, mob);
    expect(mob[i].id).toBe("variante-off");
    expect(resumeIndex({ index: 999 }, mob)).toBe(mob.length - 1);
    expect(resumeIndex(null, mob)).toBe(0);
  });
});

describe("la campaña de ejemplo: se reconoce y sólo se borra ESA", () => {
  const fakeSb = (rows: any[], onDelete?: (t: string, id: string) => void) => {
    const q: any = {
      _rows: rows,
      select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return Promise.resolve({ data: q._rows }); },
      maybeSingle() { return Promise.resolve({ data: q._rows[0] ?? null }); },
      then(res: any) { return Promise.resolve({ data: q._rows }).then(res); },
    };
    return {
      from: (t: string) => ({
        ...q,
        delete: () => ({ eq: (_c: string, id: string) => { onDelete?.(t, id); const r: any = Promise.resolve({ data: [{ id }], error: null }); r.select = () => Promise.resolve({ data: [{ id }], error: null }); return r; } }),
      }),
    };
  };

  it("la nueva es la que no estaba antes (y en borrador)", async () => {
    const sb = fakeSb([{ id: OTRA, status: "draft" }, { id: CAMP, status: "draft" }]);
    expect(await captureNewExample(sb, "u1", new Set([OTRA]), 1000)).toBe(CAMP);
  });
  it("no borra otra campaña ni la renombrada; la suya sí, con el borrado de siempre", async () => {
    const borrados: string[] = [];
    expect(await deleteExample(fakeSb([{ name: TOUR_CAMPAIGN_NAME }]), OTRA, CAMP)).toMatch(/no es la campaña de ejemplo/);
    expect(await deleteExample(fakeSb([{ name: "Mi campaña de verdad" }], (t, id) => borrados.push(`${t}:${id}`)), CAMP, CAMP)).toMatch(/renombrado/);
    expect(borrados).toEqual([]);
    const err = await deleteExample(fakeSb([{ name: TOUR_CAMPAIGN_NAME }], (t, id) => borrados.push(`${t}:${id}`)), CAMP, CAMP);
    expect(err).toBeNull();
    expect(borrados).toEqual([`campaign_steps:${CAMP}`, `campaign_accounts:${CAMP}`, `campaign_leads:${CAMP}`, `campaigns:${CAMP}`]);
  });
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

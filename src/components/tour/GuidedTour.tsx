import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, ChevronDown, Hand, ListOrdered, Loader2, Pause, Play, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { isPhoneDevice } from "@/lib/mobile-app";
import {
  TOUR_CHAPTERS, TOUR_STEPS, chapterStarts, clampStep, clearTourRun, dockSide, needsCampaign, readingMs, saveTourRun,
  resumeIndex, spotlightBox, typedLength, type Box, type TourAction, type TourStep,
} from "@/lib/tour";
import { centerOf, countOf, findRaw, isAllowed, isTourKey, navLink, pressEscape, realClick, typeInto, waitForTarget, type TourCtx } from "./tour-dom";
import { captureNewExample, deleteExample, exampleIds } from "./tour-campaign";
import { FunnyGuide } from "./FunnyGuide";

/* Tutorial guiado sobre la plataforma REAL (11-11-2026). Funny sube desde abajo y USA la cuenta:
 * el cursor va a cada sitio y pulsa de verdad, escribe letra a letra, crea una campaña de ejemplo
 * en borrador y la rellena (correos, seguimiento, variante B…), abre ventanas para enseñarlas y las
 * cierra sin guardar. En los pasos «Ahora tú» sólo queda libre lo señalado y el cliente lo pulsa.
 *
 * Seguridad: una capa tapa la página (nada se pulsa por error) y el guía sólo usa lo que está en la
 * lista cerrada de src/lib/tour.ts, comprobado en la página (tour-dom.ts → isAllowed). Lo único que
 * crea es la campaña de ejemplo; lo que cambia, sólo dentro de ella. Nunca lanza, envía, importa,
 * conecta buzones ni guarda agentes. Al terminar pregunta si se conserva o se borra la campaña. */

type Point = { x: number; y: number };
type Phase = "acting" | "showing";
type Ending = null | "ask" | "deleting" | { error: string };

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const sameBox = (a: Box | null, b: Box | null) =>
  !!a && !!b && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };

/** Los pasos de esta cuenta: fuera los de pantallas que su menú no tiene (permisos) y, en el
 *  móvil, los de piezas que sólo existen en el ordenador. */
export function availableSteps(steps: TourStep[] = TOUR_STEPS, opts: { mobile?: boolean; phone?: boolean; root?: ParentNode } = {}): TourStep[] {
  const root = opts.root ?? document;
  const hasMenu = !!root.querySelector("aside a[href]");
  const out: TourStep[] = [];
  for (const s of steps) {
    if (opts.mobile && s.desktopOnly) continue;
    if (s.needsNav && s.route && hasMenu && !navLink(s.route, root)) continue;
    // En el teléfono /unibox abre la app del móvil (y el tutorial se quedaría fuera): se explica.
    if (opts.phone && s.route?.startsWith("/unibox")) {
      if (s.phoneText) out.push({ ...s, route: null, point: [], actions: undefined, user: undefined, text: s.phoneText });
      continue;
    }
    out.push(s);
  }
  return out;
}

export interface GuidedTourProps {
  onClose: () => void;
  steps?: TourStep[];
  startIndex?: number;
  /** Seguir por este paso (gana a startIndex si existe en la lista de esta pantalla). */
  startStepId?: string;
  initialCampaignId?: string | null;
  /** Abrir directamente en «¿conservas la campaña de ejemplo?» (el chip de seguir → Terminar). */
  finishOnly?: boolean;
}

export default function GuidedTour({ onClose, steps: stepsProp, startIndex = 0, startStepId, initialCampaignId = null, finishOnly = false }: GuidedTourProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const reduced = !!useReducedMotion();

  const phone = useMemo(() => { try { return isPhoneDevice(); } catch { return false; } }, []);
  const [steps, setSteps] = useState<TourStep[]>(() => stepsProp ?? availableSteps(TOUR_STEPS, { mobile: isMobile, phone }));
  useEffect(() => { setSteps(stepsProp ?? availableSteps(TOUR_STEPS, { mobile: isMobile, phone })); }, [stepsProp, isMobile, phone]);

  const [index, setIndex] = useState(() => resumeIndex({ index: startIndex, stepId: startStepId }, steps));
  const [runKey, setRunKey] = useState(0);
  const [phase, setPhase] = useState<Phase>("acting");
  const [rect, setRect] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [cursor, setCursor] = useState<Point>(() => ({ x: 140, y: (typeof window !== "undefined" ? window.innerHeight : 800) - 170 }));
  const [ripple, setRipple] = useState<{ id: number; p: Point } | null>(null);
  const [typeStart, setTypeStart] = useState<number>(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [revealAll, setRevealAll] = useState(false);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [userTarget, setUserTarget] = useState<HTMLElement | null>(null);
  const [userDone, setUserDone] = useState(false);
  const [offTrack, setOffTrack] = useState(false);
  const [ending, setEnding] = useState<Ending>(finishOnly ? (initialCampaignId ? "ask" : null) : null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const runRef = useRef(0);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const expectedPath = useRef<string | null>(null);
  const campRef = useRef<string | null>(initialCampaignId);
  campRef.current = campaignId;
  const ctx = useCallback((): TourCtx => ({ campaignId: campRef.current }), []);

  const step = steps[clampStep(index, steps)];
  const last = index >= steps.length - 1;
  const text = missing && step.missing ? step.missing : step.text;
  const moveMs = reduced ? 0 : 650;
  const chapterLabel = TOUR_CHAPTERS.find((c) => c.id === step.chapter)?.label ?? "";
  const starts = useMemo(() => chapterStarts(steps), [steps]);

  // Sin campaña de ejemplo y sin nada que preguntar: «Terminar» cierra sin más.
  useEffect(() => {
    if (finishOnly && !initialCampaignId) { clearTourRun(); onClose(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recordar por dónde va (para seguir tras recargar).
  useEffect(() => {
    if (ending || finishOnly) return;
    saveTourRun({ index, stepId: steps[index]?.id, campaignId, at: Date.now() });
  }, [index, campaignId, ending, finishOnly, steps]);

  // Radix (ventanas modales) pone `pointer-events: none` en el body y cierra la ventana si se
  // pulsa fuera: el tutorial va por encima sin cerrarla. Los clics propios no salen del tutorial.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const types = ["pointerdown", "mousedown", "touchstart", "focusin"];
    types.forEach((t) => el.addEventListener(t, stop));
    return () => types.forEach((t) => el.removeEventListener(t, stop));
  }, [ending]);

  /* ── Un paso: pantalla → campaña de ejemplo → acciones → señalar → (ahora tú) ──────────────── */
  useEffect(() => {
    if (ending) return;
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    const sig = { get cancelled() { return !alive(); } };

    const moveTo = async (p: Point) => { if (!alive()) return; setCursor(p); await sleep(moveMs); };
    const tap = async (p: Point) => { if (!alive()) return; setRipple({ id: Date.now(), p }); await sleep(reduced ? 40 : 220); };
    const bring = async (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const free = window.innerHeight - (isMobile ? 270 : 40); // en el móvil, el bocadillo ocupa abajo
      const fits = r.top >= 64 && r.bottom <= free;
      if (!fits) {
        // Lo alto (una tarjeta entera) se enseña desde arriba; lo pequeño, centrado en lo libre.
        const tall = r.height > free * 0.7;
        const y = window.scrollY + r.top - (tall ? 76 : Math.max(76, (free - r.height) / 2));
        try { window.scrollTo({ top: Math.max(0, y), behavior: reduced ? "auto" : "smooth" }); } catch { /* jsdom */ }
        try { if (el.getBoundingClientRect().top < 0 || el.getBoundingClientRect().top > free) el.scrollIntoView({ block: tall ? "start" : "center" }); } catch { /* jsdom */ }
        await sleep(reduced ? 30 : 420);
      }
    };
    const show = (el: HTMLElement | null) => { targetRef.current = el; setRect(el ? boxOf(el) : null); };
    const doClick = async (el: HTMLElement, label?: string) => {
      await bring(el);
      if (!alive()) return;
      show(el);
      if (label) setBusy(label);
      if (!isMobile) await moveTo(centerOf(el));
      await tap(centerOf(el));
      if (!alive()) return;
      realClick(el);
      await sleep(reduced ? 80 : 380);
    };

    setPhase("acting"); setMissing(false); setRect(null); setRevealAll(false); setBusy(null);
    setUserTarget(null); setUserDone(false); setOffTrack(false); setMenuOpen(false);
    setTypeStart(Date.now());
    targetRef.current = null;

    const runAction = async (a: TourAction) => {
      if (a.do === "wait") { await sleep(reduced ? Math.min(a.ms, 250) : a.ms); return; }
      if (a.do === "escape") { pressEscape(); await sleep(180); return; }
      if (a.do === "click") {
        if (a.skipIfCampaign && campRef.current) return;
        if (a.skipIf?.length && findRaw(a.skipIf, ctx())) return;
        if (a.skipIfCount && countOf(a.skipIfCount.sel, ctx()) >= a.skipIfCount.min) return;
      }
      // Lo opcional (cerrar una ventana que quizá ya no está) no se espera.
      const el = await waitForTarget(a.target, a.do === "click" && a.optional ? 500 : 4500, sig, ctx(), true);
      if (!alive() || !el) return;
      if (!isAllowed(el, a.safe, ctx())) { console.warn("[tutorial] acción no permitida, se salta:", a.safe); return; }
      if (a.do === "click") {
        if (a.safe === "create-submit") {
          // Lo único que crea algo: la campaña de ejemplo. Se reconoce como «la que no estaba».
          const before = user ? await exampleIds(supabase as any, user.id) : new Set<string>();
          await doClick(el, "Creando la campaña de ejemplo…");
          if (!alive() || !user) return;
          const id = await captureNewExample(supabase as any, user.id, before, 9000, sig);
          if (alive() && id) { campRef.current = id; setCampaignId(id); }
          return;
        }
        await doClick(el);
        return;
      }
      // Escribir
      const field = el as HTMLInputElement | HTMLTextAreaElement;
      await bring(field);
      if (!alive()) return;
      show(field);
      setBusy(a.text ? "Escribiendo…" : null);
      if (!isMobile) await moveTo(centerOf(field));
      await typeInto(field, a.text, { cps: reduced ? 0 : (a.cps ?? 40), signal: sig, blur: a.blur });
      await sleep(reduced ? 40 : 250);
    };

    void (async () => {
      // 1) A la pantalla del paso, con un clic en el menú (en el móvil el menú está cerrado).
      if (step.route && pathRef.current !== step.route) {
        expectedPath.current = step.route;
        const link = !isMobile ? navLink(step.route) : null;
        const r = link?.getBoundingClientRect();
        if (link && r && r.width > 0 && r.height > 0) {
          setBusy(null);
          const p = centerOf(link);
          await moveTo(p);
          await tap(p);
        }
        if (!alive()) return;
        navigate(step.route);
        await sleep(reduced ? 60 : 380);
      }
      expectedPath.current = step.route ?? pathRef.current;
      if (!alive()) return;

      // 2) La campaña de ejemplo: abierta, en su pestaña, o la lista.
      let sinCampana = false;
      if (step.campaign === "list") {
        const back = findRaw([{ sel: 'button[aria-label="Volver a campañas"]' }], ctx())?.el ?? null;
        if (back && isAllowed(back, "campaign-back", ctx())) { await doClick(back); await sleep(300); }
        else if (back) { navigate("/dashboard"); await sleep(120); navigate("/campaigns"); await sleep(400); }
      } else if (needsCampaign(step)) {
        if (!campRef.current) sinCampana = true;
        else {
          const rootSel = '[data-tour-campaign="{campaign}"]';
          if (!findRaw([{ sel: rootSel }], ctx())) {
            // Otra campaña abierta (del cliente): se vuelve a la lista sin tocarla.
            if (findRaw([{ sel: "[data-tour-campaign]" }], ctx())) { navigate("/dashboard"); await sleep(120); navigate("/campaigns"); await sleep(400); }
            const rowEl = await waitForTarget([{ sel: '[data-tour="campaign-row"][data-campaign-id="{campaign}"]' }], 7000, sig, ctx(), true);
            if (!alive()) return;
            if (rowEl && isAllowed(rowEl, "campaign-row", ctx())) await doClick(rowEl);
            await waitForTarget([{ sel: rootSel }], 6000, sig, ctx(), true);
          }
          if (!alive()) return;
          const c = step.campaign as { tab?: string; sub?: string };
          const TABS: Record<string, string> = { analytics: "Analítica", editor: "Editor", leads: "Leads", settings: "Ajustes" };
          if (c.tab) {
            const t = await waitForTarget([{ sel: 'nav[aria-label="Secciones de la campaña"] button', text: new RegExp(`^${TABS[c.tab]}$`) }], 4000, sig, ctx(), true);
            if (t && t.getAttribute("aria-current") !== "page" && isAllowed(t, "campaign-tab", ctx())) { await doClick(t); await sleep(300); }
          }
          if (c.sub) {
            const s = await waitForTarget([{ sel: `${rootSel} button`, text: new RegExp(`^${c.sub}$`) }], 4000, sig, ctx(), true);
            if (s && isAllowed(s, "settings-subtab", ctx())) { await doClick(s); await sleep(300); }
          }
          if (!findRaw([{ sel: rootSel }], ctx())) sinCampana = true;
        }
      }
      if (!alive()) return;

      // 3) Lo que hace el guía.
      if (!sinCampana) {
        for (const a of step.actions || []) {
          if (!alive()) return;
          await runAction(a);
        }
      }
      if (!alive()) return;
      setBusy(null);

      // 4) Señalar lo importante (o explicarlo sin señalar si no está).
      const el = !sinCampana && step.point.length ? await waitForTarget(step.point, step.route ? 3500 : 2400, sig, ctx()) : null;
      if (!alive()) return;
      if (el) {
        await bring(el);
        if (!alive()) return;
        show(el);
        if (!isMobile) await moveTo(centerOf(el));
      } else if (step.point.length || sinCampana) {
        show(null);
        setMissing(true);
      } else {
        show(null); // sin nada que señalar: fuera el foco de la última acción
      }

      // 5) «Ahora tú»: sólo queda libre lo señalado.
      const u = step.user;
      if (u && !sinCampana && !(u.skipIfCampaign && campRef.current) && !(u.skipIf?.length && findRaw(u.skipIf, ctx()))) {
        const ue = await waitForTarget(u.target, 3000, sig, ctx(), true);
        if (!alive()) return;
        if (ue && isAllowed(ue, u.safe, ctx())) { show(ue); setUserTarget(ue); }
      }
      if (!alive()) return;
      setPhase("showing");
    })();

    return () => { runRef.current++; };
  }, [index, runKey, ending]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── «Ahora tú»: el clic del cliente (o el del guía) en lo señalado ───────────────────────── */
  useEffect(() => {
    if (!userTarget) return;
    const onClick = (e: MouseEvent) => {
      if (userTarget.contains(e.target as Node)) setUserDone(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [userTarget]);

  /* ── Seguir al elemento si la página se mueve ──────────────────────────────────────────── */
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = targetRef.current;
      if (el && el.isConnected) {
        const b = boxOf(el);
        setRect((prev) => (sameBox(prev, b) ? prev : b));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, []);

  useEffect(() => {
    if (phase !== "showing" || !rect || isMobile) return;
    setCursor({ x: rect.left + Math.min(rect.width / 2, 120), y: rect.top + rect.height / 2 });
  }, [rect, phase, isMobile]);

  // Si el cliente se va a otra pantalla por su cuenta, el tutorial se para y ofrece seguir.
  useEffect(() => {
    if (phase !== "showing" || !expectedPath.current) return;
    if (location.pathname !== expectedPath.current) { setOffTrack(true); setAuto(false); }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Texto que se escribe ─────────────────────────────────────────────────────────────── */
  const shown = reduced || revealAll ? text.length : typedLength(text, now - typeStart);
  const typing = shown < text.length;
  useEffect(() => {
    if (!typing) return;
    const t = window.setInterval(() => setNow(Date.now()), 30);
    return () => window.clearInterval(t);
  }, [typing]);

  /* ── Navegación del tutorial ──────────────────────────────────────────────────────────── */
  const go = useCallback((i: number) => { setIndex(clampStep(i, steps)); setRunKey((k) => k + 1); }, [steps]);
  const finalClose = useCallback((toDashboard: boolean) => {
    clearTourRun();
    // Ventanas que el tutorial dejara abiertas, cerradas sin guardar.
    if (document.querySelector('[role="dialog"]:not([data-testid="guided-tour"])')) pressEscape();
    if (toDashboard && pathRef.current !== "/dashboard") navigate("/dashboard");
    onClose();
  }, [navigate, onClose]);
  const requestClose = useCallback((toDashboard = false) => {
    if (campRef.current) { if (document.querySelector('[role="dialog"]:not([data-testid="guided-tour"])')) pressEscape(); setEnding("ask"); return; }
    finalClose(toDashboard);
  }, [finalClose]);
  const next = useCallback(() => { if (last) requestClose(true); else go(index + 1); }, [last, requestClose, go, index]);
  const back = useCallback(() => go(index - 1), [go, index]);
  const keep = useCallback(() => {
    toast.success("Campaña de ejemplo conservada en borrador. No enviará nada hasta que la lances.");
    finalClose(true);
  }, [finalClose]);
  const remove = useCallback(async () => {
    const id = campRef.current;
    if (!id) { finalClose(true); return; }
    setEnding("deleting");
    if (pathRef.current.startsWith("/campaigns")) { navigate("/dashboard"); await sleep(250); }
    const err = await deleteExample(supabase as any, id, campRef.current);
    if (err) { setEnding({ error: err }); return; }
    campRef.current = null;
    setCampaignId(null);
    toast.success("Campaña de ejemplo borrada");
    finalClose(true);
  }, [finalClose, navigate]);

  // Avance automático: cuando acaba de escribirse y da tiempo a leerlo (nunca en «Ahora tú»).
  const waitingUser = !!userTarget && !userDone;
  useEffect(() => {
    if (!auto || last || phase !== "showing" || typing || waitingUser || offTrack || ending) return;
    const elapsed = Date.now() - typeStart;
    const t = window.setTimeout(() => go(index + 1), Math.max(1600, readingMs(text) - elapsed));
    return () => window.clearTimeout(t);
  }, [auto, last, phase, typing, waitingUser, offTrack, ending, index, text, go, typeStart]);

  // Cuando el cliente ya lo ha hecho, sigue solo.
  useEffect(() => {
    if (!userDone) return;
    const t = window.setTimeout(() => go(index + 1), reduced ? 150 : 650);
    return () => window.clearTimeout(t);
  }, [userDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const doItForMe = useCallback(() => {
    const el = userTarget;
    if (!el || !step.user || !isAllowed(el, step.user.safe, ctx())) return;
    setRipple({ id: Date.now(), p: centerOf(el) });
    realClick(el);
  }, [userTarget, step, ctx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTourKey(e)) return; // las teclas del propio guía (Escape para cerrar menús)
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (ending) return;
      if (e.key === "Escape") { e.preventDefault(); requestClose(false); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); if (!waitingUser) next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, requestClose, ending, waitingUser]);

  /* ── Pintado ──────────────────────────────────────────────────────────────────────────── */
  // Tamaño de la ventana leído al pintar (un cambio de tamaño emulado no siempre avisa).
  const vwNow = typeof window !== "undefined" ? window.innerWidth : vw;
  const vhNow = typeof window !== "undefined" ? window.innerHeight : vh;
  const hole = !ending && rect ? spotlightBox(rect, vwNow, vhNow, isMobile ? 6 : 8) : null;
  const side = ending ? "left" : dockSide(rect, vwNow, vhNow);
  const progress = (index + 1) / steps.length;
  const holeOpen = waitingUser && hole;
  // En el móvil el bocadillo va abajo; si lo señalado queda debajo de él, sube arriba.
  const sheetTop = isMobile && !!hole && hole.top + hole.height > vhNow - 300 && hole.top > 330;

  const bubbleBody = ending ? (
    <EndPanel ending={ending} onKeep={keep} onRemove={() => void remove()} reduced={reduced} />
  ) : (
    <>
      <div className={cn("flex items-center justify-between gap-3", isMobile && "pl-14")}>
        <div className="relative min-w-0">
          <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label="Capítulos del tutorial"
            className="inline-flex max-w-full items-center gap-1 rounded-md py-0.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#6E58F1] hover:text-[#5B40FB]">
            <ListOrdered className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{chapterLabel}</span> <ChevronDown className="h-3 w-3 shrink-0" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.ul
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }}
                className="absolute bottom-7 left-0 z-10 max-h-[300px] w-[230px] overflow-y-auto rounded-xl border border-[#E6E3F0] bg-white p-1.5 shadow-[0_18px_40px_-10px_rgba(30,20,90,.35)] dark:border-white/10 dark:bg-[#1E1A36]"
                data-testid="tour-chapters"
              >
                {starts.map(({ chapter, index: i }) => (
                  <li key={chapter.id}>
                    <button type="button" onClick={() => { setMenuOpen(false); go(i); }}
                      className={cn("w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[#F1EEFC] dark:hover:bg-white/10",
                        chapter.id === step.chapter ? "font-semibold text-[#5B40FB]" : "text-[#45556C] dark:text-white/75")}>
                      {chapter.label}
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[12px] font-medium tabular-nums text-[#65768D] dark:text-white/60" data-testid="tour-progress">{index + 1}/{steps.length}</span>
          <button type="button" onClick={() => requestClose(false)} aria-label="Cerrar el tutorial"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-[#65768D] transition-colors hover:bg-[#F1EEFC] hover:text-[#0F172B] dark:hover:bg-white/10 dark:hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#EEEBF7] dark:bg-white/10">
        <motion.span className="block h-full rounded-full bg-gradient-to-r from-[#38BDF8] via-[#6E58F1] to-[#B23BFF]"
          animate={{ width: `${progress * 100}%` }} transition={{ duration: reduced ? 0 : 0.4 }} />
      </div>

      {offTrack ? (
        <>
          <h2 className="mt-3 font-display text-[19px] font-semibold leading-tight tracking-[-0.02em]">Te has ido por tu cuenta</h2>
          <p className="mt-1.5 text-[14.5px] leading-[1.55] text-[#45556C] dark:text-white/75">Sin problema. Cuando quieras, sigo desde donde lo dejamos.</p>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => requestClose(false)} className="mr-auto rounded-md px-2 py-2 text-[13px] font-semibold text-[#65768D] hover:text-[#0F172B] dark:text-white/60">Terminar</button>
            <button type="button" onClick={() => { setOffTrack(false); setRunKey((k) => k + 1); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#6E58F1] px-4 text-[13.5px] font-semibold text-white hover:bg-[#5B40FB]" data-testid="tour-resume">
              Seguir el tutorial <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="mt-3 flex items-center gap-2 font-display text-[19px] font-semibold leading-tight tracking-[-0.02em]">
            {step.user && waitingUser && <Hand className="h-[18px] w-[18px] shrink-0 text-[#6E58F1]" aria-hidden="true" />}
            {step.title}
          </h2>
          <p className="sr-only" aria-live="polite">{text}</p>
          <p
            className={cn("mt-1.5 cursor-default text-[14.5px] leading-[1.55] text-[#45556C] dark:text-white/75", isMobile ? "min-h-[66px]" : "min-h-[88px]")}
            aria-hidden="true" onClick={() => setRevealAll(true)} data-testid="tour-text"
          >
            {text.slice(0, shown)}{typing && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[#6E58F1]" />}
          </p>
          <div className="mt-1 h-5 text-[12.5px] font-medium text-[#6E58F1]" aria-live="polite" data-testid="tour-busy">
            {phase === "acting" && (busy
              ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}</span>
              : <Dots reduced={reduced} />)}
          </div>

          <div className="mt-2 flex items-center gap-2">
            {!last && (
              <button type="button" onClick={() => requestClose(false)}
                className="mr-auto rounded-md px-2 py-2 text-[13px] font-semibold text-[#65768D] transition-colors hover:text-[#0F172B] dark:text-white/60 dark:hover:text-white">
                Saltar
              </button>
            )}
            {last && <span className="mr-auto" />}
            {!last && !waitingUser && (
              <button type="button" onClick={() => setAuto((a) => !a)} aria-label={auto ? "Pausar el avance automático" : "Avance automático"} title={auto ? "Pausar" : "Avance automático"}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#65768D] transition-colors hover:bg-[#F1EEFC] hover:text-[#5B40FB] dark:hover:bg-white/10">
                {auto ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
            )}
            <button type="button" onClick={back} disabled={index === 0} aria-label="Paso anterior"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6E3F0] text-[#45556C] transition-colors hover:border-[#6E58F1]/50 hover:text-[#5B40FB] disabled:opacity-40 dark:border-white/15 dark:text-white/80">
              <ArrowLeft className="h-4 w-4" />
            </button>
            {waitingUser ? (
              <button type="button" onClick={doItForMe} data-testid="tour-do-it"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#6E58F1]/40 px-3 text-[13px] font-semibold text-[#5B40FB] transition-colors hover:bg-[#F1EEFC] dark:text-[#B9AEFF] dark:hover:bg-white/10">
                Hazlo tú por mí
              </button>
            ) : (
              <button type="button" onClick={next} aria-label={last ? "Empezar" : "Paso siguiente"}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#6E58F1] px-4 text-[13.5px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(110,88,241,.7)] transition-colors hover:bg-[#5B40FB]">
                {last ? "Empezar" : "Siguiente"} <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </>
      )}
    </>
  );

  const ui = (
    <div ref={rootRef} className="fixed inset-0 z-[100]" style={{ pointerEvents: "none" }} role="dialog" aria-modal="true" aria-label="Tutorial de Funnyleads" data-testid="guided-tour" data-phase={phase} data-step={step.id}>
      {/* Capa que tapa la página. En «Ahora tú» deja un hueco justo encima de lo señalado. */}
      {holeOpen && hole ? (
        <>
          <div className="absolute left-0 right-0 top-0" style={{ height: hole.top, pointerEvents: "auto" }} data-testid="tour-shield" />
          <div className="absolute left-0 right-0" style={{ top: hole.top + hole.height, bottom: 0, pointerEvents: "auto" }} />
          <div className="absolute left-0" style={{ top: hole.top, height: hole.height, width: hole.left, pointerEvents: "auto" }} />
          <div className="absolute right-0" style={{ top: hole.top, height: hole.height, left: hole.left + hole.width, pointerEvents: "auto" }} />
        </>
      ) : (
        <div className="absolute inset-0" style={{ pointerEvents: "auto" }} onClick={(e) => e.stopPropagation()} data-testid="tour-shield" />
      )}

      {/* Foco sobre el elemento real, o un velo suave si sólo se explica. */}
      <AnimatePresence>
        {hole ? (
          <motion.div
            key="hole"
            className="pointer-events-none absolute rounded-[14px]"
            initial={{ opacity: 0, left: hole.left, top: hole.top, width: hole.width, height: hole.height }}
            animate={{ opacity: 1, left: hole.left, top: hole.top, width: hole.width, height: hole.height }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30, opacity: { duration: 0.25 } }}
            style={{ boxShadow: `0 0 0 9999px rgba(17,12,46,${waitingUser ? ".52" : ".42"}), 0 0 0 2px ${waitingUser ? "#38BDF8" : "#8B7BFF"}, 0 0 28px 6px rgba(110,88,241,.45)` }}
            data-testid="tour-spotlight"
          >
            {!reduced && (
              <motion.span
                className={cn("absolute -inset-1 rounded-[16px] border-2", waitingUser ? "border-[#7DD3FC]" : "border-[#A99BFF]")}
                animate={{ opacity: [0.9, 0, 0.9], scale: [1, waitingUser ? 1.08 : 1.04, 1] }}
                transition={{ repeat: Infinity, duration: waitingUser ? 1.2 : 1.8, ease: "easeInOut" }}
              />
            )}
          </motion.div>
        ) : (
          <motion.div key="veil" className="pointer-events-none absolute inset-0 bg-[rgba(17,12,46,.36)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
        )}
      </AnimatePresence>

      {/* Cursor (en el móvil, sólo el toque). */}
      {!isMobile && !ending && (
        <motion.div
          className="pointer-events-none absolute left-0 top-0 z-[3]"
          initial={false}
          animate={{ x: cursor.x - 4, y: cursor.y - 3 }}
          transition={reduced ? { duration: 0 } : { duration: moveMs / 1000, ease: [0.22, 0.8, 0.24, 1] }}
          data-testid="tour-cursor"
        >
          <svg width="30" height="34" viewBox="0 0 30 34" fill="none" className="drop-shadow-[0_6px_10px_rgba(20,10,60,.35)]">
            <path d="M4 3.5 25.5 19.2l-9.4 1.6 5.3 10.1-4.3 2.2-5.3-10.2L4 29.6Z" fill="#fff" stroke="#1B1440" strokeWidth="2" strokeLinejoin="round" />
            <path d="M7.5 9.5v14.2l4.2-4.8 3.9-.7Z" fill="#6E58F1" opacity=".9" />
          </svg>
        </motion.div>
      )}
      <AnimatePresence>
        {ripple && (
          <motion.span
            key={ripple.id}
            className="pointer-events-none absolute z-[2] h-10 w-10 rounded-full border-2 border-[#8B7BFF] bg-[#6E58F1]/25"
            style={{ left: ripple.p.x - 20, top: ripple.p.y - 20 }}
            initial={{ scale: 0.3, opacity: 0.9 }}
            animate={{ scale: 1.7, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.01 : 0.55, ease: "easeOut" }}
            onAnimationComplete={() => setRipple((r) => (r && r.id === ripple.id ? null : r))}
          />
        )}
      </AnimatePresence>

      {/* Funny + bocadillo */}
      <motion.div
        className={cn(
          "absolute z-[4]",
          isMobile ? (sheetTop ? "inset-x-0 top-0" : "inset-x-0 bottom-0") : cn("bottom-6 flex items-end gap-3", side === "left" ? "left-6" : "right-6 flex-row-reverse"),
        )}
        style={{ pointerEvents: "auto" }}
        initial={{ y: reduced ? 0 : 160, opacity: reduced ? 1 : 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 22, delay: 0.05 }}
      >
        {!isMobile && <FunnyGuide size={84} talking={typing || phase === "acting"} reduced={reduced} />}

        <div
          className={cn(
            "relative bg-white text-[#0F172B] shadow-[0_24px_60px_-12px_rgba(30,20,90,.45)] dark:bg-[#17142B] dark:text-white",
            isMobile
              ? sheetTop
                ? "rounded-b-[22px] border-b border-[#E6E3F0] px-4 pb-4 pt-[calc(14px+env(safe-area-inset-top))] dark:border-white/10"
                : "rounded-t-[22px] border-t border-[#E6E3F0] px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-4 dark:border-white/10"
              : "w-[min(410px,calc(100vw-140px))] rounded-[20px] border border-[#E6E3F0] p-5 dark:border-white/10",
          )}
          data-sheet={isMobile ? (sheetTop ? "top" : "bottom") : undefined}
        >
          {isMobile && (
            <span className={cn("absolute left-4", sheetTop ? "-bottom-11" : "-top-11")}><FunnyGuide size={56} talking={typing} reduced={reduced} /></span>
          )}
          {!isMobile && (
            <span className={cn("absolute bottom-7 h-4 w-4 rotate-45 border-[#E6E3F0] bg-white dark:border-white/10 dark:bg-[#17142B]",
              side === "left" ? "-left-2 border-b border-l" : "-right-2 border-r border-t")} aria-hidden="true" />
          )}
          {bubbleBody}
        </div>
      </motion.div>
    </div>
  );

  return createPortal(ui, document.body);
}

function EndPanel({ ending, onKeep, onRemove, reduced }: { ending: Exclude<Ending, null>; onKeep: () => void; onRemove: () => void; reduced: boolean }) {
  const deleting = ending === "deleting";
  const error = typeof ending === "object" ? ending.error : null;
  return (
    <div data-testid="tour-end">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#6E58F1]">Funny · antes de irme</p>
      <h2 className="mt-2 font-display text-[19px] font-semibold leading-tight tracking-[-0.02em]">¿Conservas la campaña de ejemplo?</h2>
      <p className="mt-1.5 text-[14.5px] leading-[1.55] text-[#45556C] dark:text-white/75">
        Está en borrador: no envía nada. Puedes quedártela como plantilla para tu primera campaña o borrarla.
      </p>
      {error && <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive" role="alert">No se pudo borrar: {error}.</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button type="button" onClick={onRemove} disabled={deleting}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E6E3F0] px-3 text-[13.5px] font-semibold text-[#45556C] transition-colors hover:border-destructive/50 hover:text-destructive disabled:opacity-60 dark:border-white/15 dark:text-white/80"
          data-testid="tour-delete-example">
          {deleting ? <Loader2 className={cn("h-4 w-4", !reduced && "animate-spin")} /> : <Trash2 className="h-4 w-4" />} Borrarla
        </button>
        <button type="button" onClick={onKeep} disabled={deleting}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#6E58F1] px-4 text-[13.5px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(110,88,241,.7)] transition-colors hover:bg-[#5B40FB] disabled:opacity-60"
          data-testid="tour-keep-example">
          Conservarla
        </button>
      </div>
    </div>
  );
}

function Dots({ reduced }: { reduced: boolean }) {
  return (
    <span className="inline-flex gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="block h-1.5 w-1.5 rounded-full bg-[#A99BFF]"
          animate={reduced ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={reduced ? undefined : { repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />
      ))}
    </span>
  );
}

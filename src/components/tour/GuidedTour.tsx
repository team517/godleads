import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Pause, Play, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  TOUR_STEPS, clampStep, dockSide, readingMs, spotlightBox, typedLength, type Box, type TourStep,
} from "@/lib/tour";
import { centerOf, findTarget, isSafeClick, navLink, waitForTarget } from "./tour-dom";
import { FunnyGuide } from "./FunnyGuide";

/* Tutorial guiado sobre la plataforma REAL (11-11-2026). Funny sube desde abajo y, paso a paso, un
 * cursor va al menú, entra en cada sección y señala lo importante con un foco, mientras el bocadillo
 * lo explica escribiéndose. Nada de datos inventados: es la cuenta del cliente.
 *
 * Seguridad: una capa transparente tapa la página (no se puede pulsar nada por error), y los únicos
 * clics de verdad son de lectura (abrir una campaña, cambiar de pestaña: isSafeClick). Nunca crea,
 * guarda, envía ni borra. */

type Point = { x: number; y: number };
type Phase = "moving" | "showing";

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const sameBox = (a: Box | null, b: Box | null) =>
  !!a && !!b && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/** Los pasos de esta cuenta: fuera los de pantallas que su menú no tiene (permisos). */
export function availableSteps(steps: TourStep[] = TOUR_STEPS, root: ParentNode = document): TourStep[] {
  return steps.filter((s) => !s.needsNav || !s.route || !!navLink(s.route, root));
}

export default function GuidedTour({ onClose, steps: stepsProp }: { onClose: () => void; steps?: TourStep[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const reduced = !!useReducedMotion();
  // Se recalcula tras montar: el menú lateral tiene que estar ya en la página para saber qué ve.
  const [steps, setSteps] = useState<TourStep[]>(() => stepsProp ?? availableSteps());
  useEffect(() => { setSteps(stepsProp ?? availableSteps()); }, [stepsProp]);

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("moving");
  const [rect, setRect] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [cursor, setCursor] = useState<Point>(() => ({ x: 140, y: (typeof window !== "undefined" ? window.innerHeight : 800) - 170 }));
  const [ripple, setRipple] = useState<{ id: number; p: Point } | null>(null);
  const [typeStart, setTypeStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [revealAll, setRevealAll] = useState(false);
  const [auto, setAuto] = useState(true);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);

  const targetRef = useRef<HTMLElement | null>(null);
  const runRef = useRef(0);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const step = steps[index];
  const last = index === steps.length - 1;
  const text = missing && step.missing ? step.missing : step.text;
  const moveMs = reduced ? 0 : 720;

  /* ── Un paso: menú → pantalla → abrir (sólo lectura) → señalar ─────────────────────────── */
  useEffect(() => {
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    const sig = { get cancelled() { return !alive(); } };
    const moveTo = async (p: Point) => { if (!alive()) return; setCursor(p); await sleep(moveMs); };
    const click = async (p: Point) => {
      if (!alive()) return;
      setRipple({ id: Date.now(), p });
      await sleep(reduced ? 60 : 260);
    };
    const bring = async (el: HTMLElement) => {
      try { el.scrollIntoView({ block: isMobile ? "start" : "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" }); } catch { /* jsdom */ }
      if (isMobile) { try { window.scrollBy({ top: -72 }); } catch { /* nada */ } }
      await sleep(reduced ? 30 : 380);
    };

    setPhase("moving"); setMissing(false); setRect(null); setTypeStart(null); setRevealAll(false);
    targetRef.current = null;

    void (async () => {
      // 1) A la pantalla, con un clic en el menú (en móvil el menú está cerrado: se va directo).
      if (step.route && pathRef.current !== step.route) {
        const link = !isMobile ? navLink(step.route) : null;
        const r = link?.getBoundingClientRect();
        if (link && r && r.width > 0 && r.height > 0) {
          const p = centerOf(link);
          await moveTo(p);
          await click(p);
        }
        if (!alive()) return;
        navigate(step.route);
        await sleep(reduced ? 50 : 300);
      }

      // 2) Abrir lo que haga falta para verlo (sólo si aún no se ve lo que se va a señalar).
      if (step.open?.length && !findTarget(step.targets)) {
        for (const o of step.open) {
          const el = await waitForTarget([o], 2600, sig);
          if (!alive()) return;
          if (!el || !isSafeClick(el)) break;
          await bring(el);
          const p = centerOf(el);
          await moveTo(p);
          await click(p);
          if (!alive()) return;
          el.click();
          await sleep(reduced ? 80 : 450);
        }
      }

      // 3) Señalar lo importante (o explicarlo sin señalar si esta cuenta aún no lo tiene).
      const el = step.targets.length ? await waitForTarget(step.targets, step.route ? 3500 : 2200, sig) : null;
      if (!alive()) return;
      if (el) {
        await bring(el);
        if (!alive()) return;
        targetRef.current = el;
        const r = el.getBoundingClientRect();
        setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
        if (!isMobile) await moveTo(centerOf(el));
      } else if (step.targets.length) {
        setMissing(true);
      }
      if (!alive()) return;
      setPhase("showing");
      setTypeStart(Date.now());
    })();

    return () => { runRef.current++; };
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Seguir al elemento si la página se mueve (scroll, carga, cambio de tamaño) ──────────── */
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = targetRef.current;
      if (el && el.isConnected) {
        const r = el.getBoundingClientRect();
        const b = { left: r.left, top: r.top, width: r.width, height: r.height };
        setRect((prev) => (sameBox(prev, b) ? prev : b));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, []);

  // Si la página se mueve después de llegar, el cursor sigue al elemento.
  useEffect(() => {
    if (phase !== "showing" || !rect || isMobile) return;
    setCursor({ x: rect.left + Math.min(rect.width / 2, 120), y: rect.top + rect.height / 2 });
  }, [rect, phase, isMobile]);

  /* ── Texto que se escribe ─────────────────────────────────────────────────────────────── */
  const shown = phase !== "showing" || typeStart === null ? 0
    : reduced || revealAll ? text.length
    : typedLength(text, now - typeStart);
  const typing = phase === "showing" && shown < text.length;
  useEffect(() => {
    if (!typing) return;
    const t = window.setInterval(() => setNow(Date.now()), 30);
    return () => window.clearInterval(t);
  }, [typing]);

  /* ── Navegación del tutorial ──────────────────────────────────────────────────────────── */
  const go = useCallback((i: number) => setIndex(clampStep(i, steps)), [steps]);
  const finish = useCallback(() => { if (pathRef.current !== "/dashboard") navigate("/dashboard"); onClose(); }, [navigate, onClose]);
  const next = useCallback(() => { if (last) finish(); else go(index + 1); }, [last, finish, go, index]);
  const back = useCallback(() => go(index - 1), [go, index]);

  // Modo automático: cuando acaba de escribirse y da tiempo a leerlo, pasa solo (menos al final).
  useEffect(() => {
    if (!auto || last || phase !== "showing" || typing) return;
    const t = window.setTimeout(() => go(index + 1), Math.max(1800, readingMs(text) - text.length * (1000 / 55)));
    return () => window.clearTimeout(t);
  }, [auto, last, phase, typing, index, text, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onClose]);

  /* ── Pintado ──────────────────────────────────────────────────────────────────────────── */
  const hole = rect ? spotlightBox(rect, vw, vh, isMobile ? 6 : 8) : null;
  const side = dockSide(rect, vw, vh);
  const progress = (index + 1) / steps.length;

  const ui = (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Tutorial de Funnyleads" data-testid="guided-tour">
      {/* Capa que tapa la página: nada se pulsa por error durante el recorrido. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} data-testid="tour-shield" />

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
            style={{ boxShadow: "0 0 0 9999px rgba(17,12,46,.46), 0 0 0 2px #8B7BFF, 0 0 28px 6px rgba(110,88,241,.45)" }}
            data-testid="tour-spotlight"
          >
            {!reduced && (
              <motion.span
                className="absolute -inset-1 rounded-[16px] border-2 border-[#A99BFF]"
                animate={{ opacity: [0.9, 0, 0.9], scale: [1, 1.04, 1] }}
                transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
              />
            )}
          </motion.div>
        ) : (
          <motion.div key="veil" className="pointer-events-none absolute inset-0 bg-[rgba(17,12,46,.38)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
        )}
      </AnimatePresence>

      {/* Cursor (en el móvil, sólo el toque). */}
      {!isMobile && (
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
          isMobile ? "inset-x-0 bottom-0" : cn("bottom-6 flex items-end gap-3", side === "left" ? "left-6" : "right-6 flex-row-reverse"),
        )}
        initial={{ y: reduced ? 0 : 160, opacity: reduced ? 1 : 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 210, damping: 22, delay: 0.05 }}
      >
        {!isMobile && <FunnyGuide size={84} talking={typing} reduced={reduced} />}

        <div
          className={cn(
            "relative bg-white text-[#0F172B] shadow-[0_24px_60px_-12px_rgba(30,20,90,.45)] dark:bg-[#17142B] dark:text-white",
            isMobile
              ? "rounded-t-[22px] border-t border-[#E6E3F0] px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-4 dark:border-white/10"
              : "w-[min(400px,calc(100vw-140px))] rounded-[20px] border border-[#E6E3F0] p-5 dark:border-white/10",
          )}
        >
          {isMobile && (
            <span className="absolute -top-11 left-4"><FunnyGuide size={56} talking={typing} reduced={reduced} /></span>
          )}
          {/* Rabito del bocadillo hacia Funny */}
          {!isMobile && (
            <span className={cn("absolute bottom-7 h-4 w-4 rotate-45 border-[#E6E3F0] bg-white dark:border-white/10 dark:bg-[#17142B]",
              side === "left" ? "-left-2 border-b border-l" : "-right-2 border-r border-t")} aria-hidden="true" />
          )}

          <div className={cn("flex items-center justify-between gap-3", isMobile && "pl-14")}>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#6E58F1]">Funny · tu guía</p>
            <div className="flex items-center gap-1">
              <span className="text-[12px] font-medium tabular-nums text-[#65768D] dark:text-white/60" data-testid="tour-progress">{index + 1}/{steps.length}</span>
              <button type="button" onClick={onClose} aria-label="Cerrar el tutorial"
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-md text-[#65768D] transition-colors hover:bg-[#F1EEFC] hover:text-[#0F172B] dark:hover:bg-white/10 dark:hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#EEEBF7] dark:bg-white/10">
            <motion.span className="block h-full rounded-full bg-gradient-to-r from-[#38BDF8] via-[#6E58F1] to-[#B23BFF]"
              animate={{ width: `${progress * 100}%` }} transition={{ duration: reduced ? 0 : 0.4 }} />
          </div>

          <h2 className="mt-3 font-display text-[19px] font-semibold leading-tight tracking-[-0.02em]">{step.title}</h2>
          <p className="sr-only" aria-live="polite">{phase === "showing" ? text : ""}</p>
          <p
            className={cn("mt-1.5 cursor-default text-[14.5px] leading-[1.55] text-[#45556C] dark:text-white/75", isMobile ? "min-h-[66px]" : "min-h-[88px]")}
            aria-hidden="true"
            onClick={() => setRevealAll(true)}
            data-testid="tour-text"
          >
            {phase !== "showing"
              ? <span className="inline-flex items-center gap-1.5 text-[#94A0B4]"><Dots reduced={reduced} /></span>
              : <>{text.slice(0, shown)}{typing && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[#6E58F1]" />}</>}
          </p>

          <div className="mt-4 flex items-center gap-2">
            {!last && (
              <button type="button" onClick={onClose}
                className="mr-auto rounded-md px-2 py-2 text-[13px] font-semibold text-[#65768D] transition-colors hover:text-[#0F172B] dark:text-white/60 dark:hover:text-white">
                Saltar tutorial
              </button>
            )}
            {last && <span className="mr-auto" />}
            {!last && (
              <button type="button" onClick={() => setAuto((a) => !a)} aria-label={auto ? "Pausar el avance automático" : "Avance automático"} title={auto ? "Pausar" : "Avance automático"}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#65768D] transition-colors hover:bg-[#F1EEFC] hover:text-[#5B40FB] dark:hover:bg-white/10">
                {auto ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
            )}
            <button type="button" onClick={back} disabled={index === 0} aria-label="Paso anterior"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E6E3F0] text-[#45556C] transition-colors hover:border-[#6E58F1]/50 hover:text-[#5B40FB] disabled:opacity-40 dark:border-white/15 dark:text-white/80">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={next} aria-label={last ? "Empezar" : "Paso siguiente"}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#6E58F1] px-4 text-[13.5px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(110,88,241,.7)] transition-colors hover:bg-[#5B40FB]">
              {last ? "Empezar" : "Siguiente"} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(ui, document.body);
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

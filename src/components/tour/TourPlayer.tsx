import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from "lucide-react";
import { SparkMark } from "@/components/SparkMark";
import { cn } from "@/lib/utils";
import { TOUR_CHAPTERS, advanceClock, chapterProgress, type TourClock } from "@/lib/tour";
import {
  STAGE_H, STAGE_W, CURSOR_MOVE_MS, TourShell, activeNav, clickingAt, cursorStepAt, renderScene, sceneChatOpen,
} from "./TourScenes";

/* El reproductor del mini tutorial: "como un mini vídeo". Una maqueta del panel a escala, un ratón
 * que se mueve y hace clic, y debajo el capítulo con su explicación, la barra de progreso y los
 * controles (pausa, anterior, siguiente, saltar). Avanza solo. */

const TICK_MS = 50;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  });
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { return; }
    const on = () => setReduced(!!mq?.matches);
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Las {{variables}} del texto del capítulo, en violeta como en el editor. */
function Caption({ text }: { text: string }) {
  return <>{text.split(/(\{\{[a-z_]+\}\})/g).map((p, i) => p.startsWith("{{")
    ? <code key={i} className="rounded bg-primary/10 px-1 py-px font-sans text-[0.92em] font-semibold text-primary">{p}</code>
    : <span key={i}>{p}</span>)}</>;
}

export default function TourPlayer({ onClose, tickMs = TICK_MS }: { onClose: () => void; tickMs?: number }) {
  const [clock, setClock] = useState<TourClock>({ chapter: 0, t: 0 });
  const [playing, setPlaying] = useState(true);
  const [finished, setFinished] = useState(false);
  const reduced = usePrefersReducedMotion();
  const last = TOUR_CHAPTERS.length - 1;

  // Reloj: avanza mientras se reproduce. Al pasar el último capítulo, pantalla final.
  useEffect(() => {
    if (!playing || finished) return;
    let prev = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - prev;
      prev = now;
      setClock((c) => {
        const n = advanceClock(c, dt);
        if (n.finished) { setFinished(true); return { chapter: last, t: TOUR_CHAPTERS[last].ms }; }
        return { chapter: n.chapter, t: n.t };
      });
    }, tickMs);
    return () => window.clearInterval(id);
  }, [playing, finished, last, tickMs]);

  const goTo = useCallback((chapter: number) => {
    setFinished(false);
    setClock({ chapter: Math.max(0, Math.min(last, chapter)), t: 0 });
    setPlaying(true);
  }, [last]);
  const restart = useCallback(() => goTo(0), [goTo]);

  // Teclado: espacio = pausa, flechas = capítulos, Esc = cerrar. Y sin scroll detrás.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === " " || e.key === "k") { e.preventDefault(); if (!finished) setPlaying((p) => !p); }
      else if (e.key === "ArrowRight") { e.preventDefault(); if (clock.chapter >= last) setFinished(true); else goTo(clock.chapter + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(clock.chapter - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock.chapter, finished, goTo, last, onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Escala de la maqueta: cabe a lo ancho y deja sitio debajo para el texto y los controles.
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth || STAGE_W;
      // Alto libre = ventana − panel del texto − cabecera, huecos y márgenes.
      const panel = panelRef.current?.offsetHeight || 210;
      const room = window.innerHeight - panel - 100;
      setScale(Math.max(0.2, Math.min(w / STAGE_W, room / STAGE_H, 1.15)));
    };
    fit();
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(fit) : null;
    ro?.observe(el);
    if (panelRef.current) ro?.observe(panelRef.current);
    window.addEventListener("resize", fit);
    return () => { ro?.disconnect(); window.removeEventListener("resize", fit); };
  }, []);

  // El ratón: va al elemento del paso vigente (medido dentro de la maqueta, a escala 1).
  const stageRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: STAGE_W * 0.6, y: STAGE_H * 0.55 });
  const step = cursorStepAt(clock.chapter, clock.t);
  const arrived = !!step && clock.t >= step.at + CURSOR_MOVE_MS;
  const hover = arrived ? step!.target : null;
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !step) return;
    const el = stage.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) return;
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!s.width || !r.width) return;
    const k = s.width / STAGE_W;
    const x = (r.left - s.left + r.width * 0.5) / k;
    const y = (r.top - s.top + r.height * 0.6) / k;
    setPos((p) => (Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5 ? p : { x, y }));
  });
  const clickT = clickingAt(clock.chapter, clock.t);

  const ch = TOUR_CHAPTERS[clock.chapter];

  return (
    <div role="dialog" aria-modal="true" aria-label="Tutorial de Funnyleads"
      className="fixed inset-0 z-[200] flex flex-col items-center overflow-y-auto overflow-x-hidden bg-[#15113C]/80 px-3 py-3 backdrop-blur-sm sm:px-6 sm:py-5">
      <style>{`
        @keyframes tourRipple { from { transform: translate(-50%,-50%) scale(.3); opacity: .55 } to { transform: translate(-50%,-50%) scale(1.7); opacity: 0 } }
      `}</style>
      <div className="my-auto flex w-full max-w-[1000px] flex-col gap-3">
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-3 text-white">
          <span className="flex min-w-0 items-center gap-2">
            <SparkMark size={26} variant="star" />
            <span className="truncate text-[13.5px] font-semibold">Tutorial de Funnyleads</span>
            <span className="hidden rounded-full bg-white/12 px-2 py-0.5 text-[11px] font-semibold text-white/80 sm:inline">{finished ? "Terminado" : `${clock.chapter + 1} de ${TOUR_CHAPTERS.length}`}</span>
          </span>
          <button type="button" onClick={onClose} aria-label="Cerrar el tutorial"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* La pantalla */}
        <div ref={boxRef} className="w-full">
          <div className="relative mx-auto overflow-hidden rounded-xl border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,.35)]"
            style={{ width: STAGE_W * scale, height: STAGE_H * scale }}>
            <div ref={stageRef} data-testid="tour-stage" className="absolute left-0 top-0 origin-top-left select-none"
              style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }} aria-hidden="true">
              <TourShell active={activeNav(clock.chapter, clock.t)} hover={hover} chatOpen={sceneChatOpen(clock.chapter, clock.t)}>
                <div key={`${clock.chapter}`} className={cn(reduced && "motion-reduce:animate-none")}>
                  {renderScene(clock.chapter, clock.t, hover)}
                </div>
              </TourShell>
              {/* Ratón */}
              {!finished && (
                <div className="pointer-events-none absolute left-0 top-0 z-50"
                  style={{
                    transform: `translate(${pos.x}px, ${pos.y}px)`,
                    transition: reduced ? "none" : `transform ${CURSOR_MOVE_MS}ms cubic-bezier(.45,0,.2,1)`,
                  }}>
                  {clickT !== null && !reduced && (
                    <span key={clickT} className="absolute left-0 top-0 h-10 w-10 rounded-full border-2 border-primary bg-primary/20"
                      style={{ animation: "tourRipple 450ms ease-out forwards" }} />
                  )}
                  <svg width="26" height="26" viewBox="0 0 24 24" className="drop-shadow-[0_3px_4px_rgba(0,0,0,.35)] transition-transform duration-150"
                    style={{ marginLeft: -3, marginTop: -2, transformOrigin: "3px 2px", transform: clickT !== null ? "scale(.82)" : "scale(1)" }}>
                    <path d="M4 2.5l15 8.6-6.4 1.6 3.7 6.9-2.7 1.4-3.7-6.9L4.8 18.3z" fill="#fff" stroke="#15113C" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
              {/* Final */}
              {finished && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#15113C]/55 backdrop-blur-[3px] animate-in fade-in duration-500">
                  <div className="w-[460px] rounded-2xl bg-card p-8 text-center shadow-[0_18px_44px_rgba(21,17,60,.25)]">
                    <span className="mx-auto mb-4 flex w-fit"><SparkMark size={56} /></span>
                    <p className="font-display text-[28px] font-semibold tracking-[-0.03em] text-foreground">¡Listo! Ya vas por libre</p>
                    <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">Ya conoces Funnyleads. Si te atascas, FunnyBot y el equipo están a un clic.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Texto del capítulo, progreso y controles */}
        <div ref={panelRef} className="mx-auto w-full rounded-xl bg-card p-4 text-foreground shadow-[0_12px_32px_rgba(21,17,60,.2)] sm:p-5">
          {finished ? (
            <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
              <div className="flex-1">
                <p className="font-display text-[19px] font-semibold tracking-[-0.02em]">¡Listo! Ya vas por libre</p>
                <p className="text-[13.5px] text-muted-foreground">Puedes volver a verlo cuando quieras desde el menú de tu cuenta.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={restart} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-2 text-[13.5px] font-semibold transition-colors hover:bg-secondary">
                  <RotateCcw className="h-4 w-4" /> Verlo otra vez
                </button>
                <button type="button" onClick={onClose} autoFocus className="rounded-md bg-primary px-5 py-2 text-[14px] font-semibold text-white shadow-[0_2px_4px_rgba(110,88,241,.24)] transition-colors hover:bg-[#5B40FB]">
                  Empezar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-[76px]" aria-live="polite">
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-primary">Capítulo {clock.chapter + 1} · {ch.short}</p>
                <p className="mt-0.5 font-display text-[18px] font-semibold tracking-[-0.02em] sm:text-[20px]">{ch.title}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground sm:text-[14.5px]"><Caption text={ch.text} /></p>
              </div>
              {/* Barra por capítulos: se puede saltar a cualquiera. */}
              <div className="mt-3 flex gap-1" role="group" aria-label="Capítulos">
                {TOUR_CHAPTERS.map((c, i) => (
                  <button key={c.id} type="button" onClick={() => goTo(i)} aria-label={`Ir al capítulo ${i + 1}: ${c.title}`} title={c.title}
                    className="group flex-1 py-1.5">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-muted group-hover:bg-muted-foreground/30">
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${chapterProgress(clock, i) * 100}%` }} />
                    </span>
                    <span className={cn("mt-1 hidden truncate text-[10.5px] font-semibold md:block", i === clock.chapter ? "text-primary" : "text-muted-foreground")}>{c.short}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <button type="button" onClick={() => onClose()} className="rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                  Saltar tutorial
                </button>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => goTo(clock.chapter - 1)} disabled={clock.chapter === 0} aria-label="Capítulo anterior"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border transition-colors hover:bg-secondary disabled:opacity-40">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pausar" : "Reproducir"} autoFocus
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-[0_2px_6px_rgba(110,88,241,.35)] transition-colors hover:bg-[#5B40FB]">
                    {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
                  </button>
                  <button type="button" onClick={() => (clock.chapter >= last ? setFinished(true) : goTo(clock.chapter + 1))} aria-label="Capítulo siguiente"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border transition-colors hover:bg-secondary">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

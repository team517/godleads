import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import star from "@/assets/onepulso-spark-star.png";

/* La barra del plan a medida (11-11-2026), calcada de la referencia del dueño: tres píldoras con la
   estrella (Básico · Profesional · Empresarial) y la de la zona elegida rellena con degradado y una
   flecha; una barra gruesa cian → azul → violeta con brillo a la izquierda; marcas debajo (una grande
   por nivel y pequeñas entre medias); el pomo blanco grande con la estrella de la marca y halo violeta;
   y debajo las cifras de referencia en píldoras lavanda con la elegida resaltada.
   Todo con estilos en línea + un <style> con prefijo: así sirve igual en la app (con modo oscuro) y
   dentro del marco de la landing, que no carga Tailwind. 10 niveles, se ajusta a cada uno. */

export interface PlanSliderZone { label: string; short?: string; from: number; to: number }

const PREFIX = "fl-ps";
const CSS = `
.${PREFIX}-pills{position:relative;height:58px}
.${PREFIX}-pill{position:absolute;top:0;transform:translateX(-50%);display:inline-flex;align-items:center;gap:8px;white-space:nowrap;border:0;cursor:pointer;
  border-radius:999px;padding:10px 18px;font-weight:700;font-size:16px;letter-spacing:-.01em;transition:background .25s ease,color .25s ease,box-shadow .25s ease,transform .25s ease}
.${PREFIX}-pill:focus-visible{outline:3px solid rgba(110,88,241,.45);outline-offset:2px}
.${PREFIX}-short{display:none}
.${PREFIX}-knob:focus-visible{outline:none;box-shadow:0 0 0 6px rgba(110,88,241,.35),0 0 0 12px rgba(138,28,255,.14),0 12px 30px rgba(138,28,255,.38) !important}
@media (max-width:560px){
  .${PREFIX}-pills{display:flex;justify-content:space-between;gap:4px;height:50px;margin:0 !important}
  .${PREFIX}-pill{position:relative;left:auto !important;transform:none;padding:7px 10px;font-size:12.5px;gap:5px}
  .${PREFIX}-pill svg{width:14px;height:14px}
  .${PREFIX}-long{display:none}
  .${PREFIX}-short{display:inline}
  .${PREFIX}-chip{font-size:13px !important;padding:5px 10px !important}
}
@media (prefers-reduced-motion: reduce){ .${PREFIX}-pill{transition:none} }
`;

/** La estrella de cuatro puntas de la marca, en SVG (para las píldoras). */
export function StarGlyph({ size = 18, white = false }: { size?: number; white?: boolean }) {
  const id = white ? "fl-ps-star-w" : "fl-ps-star-g";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      {!white && (
        <defs>
          <linearGradient id={id} x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stopColor="#00C8F0" /><stop offset="55%" stopColor="#3B5BFF" /><stop offset="100%" stopColor="#B23BFF" /></linearGradient>
        </defs>
      )}
      <path d="M12 1.5c.6 4.9 2.5 7.9 9.5 10.5-7 2.6-8.9 5.6-9.5 10.5-.6-4.9-2.5-7.9-9.5-10.5 7-2.6 8.9-5.6 9.5-10.5Z" fill={white ? "#fff" : `url(#${id})`} />
    </svg>
  );
}

export function PlanSlider({
  level, onChange, min = 1, max = 10, zones, values, format, dark = false, ariaLabel, valueText, referenceLevels,
}: {
  level: number;
  onChange: (level: number) => void;
  min?: number;
  max?: number;
  zones: PlanSliderZone[];
  /** Valor de cada nivel (envíos/mes), para las píldoras de abajo. */
  values: number[];
  format: (n: number) => string;
  dark?: boolean;
  ariaLabel: string;
  valueText: (level: number) => string;
  /** Niveles con píldora de referencia fija (por defecto: primero, el del medio y el último). */
  referenceLevels?: number[];
}) {
  const reduce = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [trackW, setTrackW] = useState(0);
  const n = max - min;

  // Ancho real de la barra: el degradado se pinta a ese ancho para que no "encoja" al mover el pomo.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const medir = () => setTrackW(el.getBoundingClientRect().width);
    medir();
    const RO = (el.ownerDocument?.defaultView as any)?.ResizeObserver ?? (typeof ResizeObserver !== "undefined" ? ResizeObserver : null);
    const ro = RO ? new RO(medir) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const pct = (l: number) => ((l - min) / n) * 100;
  // El último nivel pedido (aunque aún no se haya repintado): así varias pulsaciones seguidas suman.
  const actual = useRef(level);
  actual.current = level;
  const set = useCallback((l: number) => {
    const v = Math.min(max, Math.max(min, Math.round(l)));
    if (v !== actual.current) { actual.current = v; onChange(v); }
  }, [min, max, onChange]);

  const fromClientX = (x: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    set(min + ((x - r.left) / r.width) * n);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* nada */ }
    setDrag(true);
    fromClientX(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => { if (drag) fromClientX(e.clientX); };
  const onUp = () => setDrag(false);
  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    const cur = actual.current;
    if (k === "ArrowRight" || k === "ArrowUp") set(cur + 1);
    else if (k === "ArrowLeft" || k === "ArrowDown") set(cur - 1);
    else if (k === "Home") set(min);
    else if (k === "End") set(max);
    else if (k === "PageUp") set(cur + 2);
    else if (k === "PageDown") set(cur - 2);
    else return;
    e.preventDefault();
  };

  const C = dark
    ? { pillBg: "rgba(255,255,255,.07)", pillText: "#C9C6E6", track: "rgba(255,255,255,.10)", tick: "rgba(178,150,255,.55)", tickOn: "#C9B6FF", chip: "rgba(255,255,255,.07)", chipText: "#B9B5DA", chipOn: "rgba(139,92,246,.30)", chipOnText: "#FFFFFF" }
    : { pillBg: "#F1EEFB", pillText: "#5E5C80", track: "#ECE8FB", tick: "rgba(123,60,255,.55)", tickOn: "#6E2BFF", chip: "#F1EEFB", chipText: "#6C6A8E", chipOn: "#E6DEFF", chipOnText: "#1B1546" };
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 34 };
  const zoneOf = (l: number) => zones.findIndex((z) => l >= z.from && l <= z.to);
  const activeZone = zoneOf(level);
  // Las cifras de referencia se esconden si chocarían con la elegida (según el ancho real de la barra).
  const porNivel = trackW > 0 ? trackW / n : 0;
  const lejos = (a: number, b: number) => (porNivel > 0 ? Math.abs(a - b) * porNivel >= 64 : Math.abs(a - b) > 1);
  const refs = (referenceLevels ?? [min, Math.round((min + max) / 2), max]).filter((r) => lejos(r, level));
  const knob = 60;

  return (
    <div style={{ position: "relative", userSelect: "none", padding: "0 8px" }} data-testid="plan-slider">
      <style>{CSS}</style>

      {/* Píldoras de zona */}
      <div className={`${PREFIX}-pills`} style={{ margin: `0 ${knob / 2}px` }}>
        {zones.map((z, i) => {
          const on = i === activeZone;
          const center = pct((z.from + z.to) / 2);
          const style: CSSProperties = {
            left: `${center}%`,
            background: on ? "linear-gradient(100deg,#2E7BFF 0%,#5B3BFF 50%,#8B2CF5 100%)" : C.pillBg,
            color: on ? "#fff" : C.pillText,
            boxShadow: on ? "0 10px 26px rgba(91,59,255,.35)" : "none",
          };
          return (
            <button key={z.label} type="button" className={`${PREFIX}-pill`} style={style} aria-pressed={on}
              onClick={() => set(Math.round((z.from + z.to) / 2))} data-testid={`zone-${i}`}>
              <StarGlyph size={18} white={on} />
              <span className={`${PREFIX}-long`}>{z.label}</span>
              <span className={`${PREFIX}-short`}>{z.short ?? z.label}</span>
              {on && (
                <span aria-hidden="true" style={{ position: "absolute", left: "50%", bottom: -7, width: 14, height: 14, transform: "translateX(-50%) rotate(45deg)", borderRadius: 3, background: "linear-gradient(135deg,#5B3BFF,#7A30F8)" }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Barra */}
      <div
        style={{ position: "relative", height: knob + 6, padding: `0 ${knob / 2}px`, touchAction: "none", cursor: drag ? "grabbing" : "pointer" }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      >
        <div ref={trackRef} style={{ position: "relative", height: "100%" }}>
          {/* brillo a la izquierda */}
          <span aria-hidden="true" style={{ position: "absolute", left: -18, top: "50%", width: 90, height: 34, transform: "translateY(-50%)", borderRadius: 999, background: "radial-gradient(closest-side,rgba(0,200,240,.55),rgba(0,200,240,0))", filter: "blur(6px)" }} />
          <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 15, transform: "translateY(-50%)", borderRadius: 999, background: C.track }} />
          <motion.span aria-hidden="true" initial={false} animate={{ width: `${pct(level)}%` }} transition={spring}
            style={{ position: "absolute", left: 0, top: "50%", height: 15, marginTop: -7.5, borderRadius: 999, minWidth: 15, overflow: "hidden" }}>
            {/* El degradado ocupa siempre la barra entera: así el color de cada punto no cambia. */}
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: trackW || "100%", maxWidth: "none",
              background: "linear-gradient(90deg,#00C8F0 0%,#2F6BFF 30%,#5B3BFF 60%,#8A1CFF 100%)", boxShadow: "0 0 18px rgba(91,59,255,.35)" }} />
          </motion.span>

          {/* Pomo */}
          <motion.div
            role="slider" tabIndex={0} aria-label={ariaLabel} aria-valuemin={min} aria-valuemax={max} aria-valuenow={level} aria-valuetext={valueText(level)}
            onKeyDown={onKey} className={`${PREFIX}-knob`} data-testid="plan-slider-knob"
            initial={false} animate={{ left: `${pct(level)}%`, scale: drag ? 1.06 : 1 }} transition={spring}
            style={{ position: "absolute", top: "50%", width: knob, height: knob, marginLeft: -knob / 2, marginTop: -knob / 2, borderRadius: "50%", background: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: drag ? "grabbing" : "grab", zIndex: 2,
              boxShadow: "0 0 0 8px rgba(138,28,255,.12), 0 12px 30px rgba(138,28,255,.38), inset 0 -2px 6px rgba(91,59,255,.08)" }}
          >
            <img src={star} alt="" draggable={false} style={{ width: 30, height: 30, pointerEvents: "none" }} />
          </motion.div>
        </div>
      </div>

      {/* Marcas */}
      <div aria-hidden="true" style={{ position: "relative", height: 22, margin: `-14px ${knob / 2}px 0` }}>
        {Array.from({ length: n * 3 + 1 }, (_, i) => {
          const major = i % 3 === 0;
          const l = min + i / 3;
          const on = major && l === level;
          return (
            <span key={i} style={{ position: "absolute", left: `${(i / (n * 3)) * 100}%`, top: 0, width: major ? 3 : 2, height: on ? 20 : major ? 15 : 8, transform: "translateX(-50%)",
              borderRadius: 2, background: on ? C.tickOn : C.tick, opacity: major ? 1 : 0.7, transition: "height .2s ease, background .2s ease" }} />
          );
        })}
      </div>

      {/* Cifras */}
      <div aria-hidden="true" style={{ position: "relative", height: 40, margin: `8px ${knob / 2}px 0` }}>
        {refs.map((r) => (
          <span key={`r${r}`} className={`${PREFIX}-chip`} style={{ position: "absolute", left: `${pct(r)}%`, transform: "translateX(-50%)", whiteSpace: "nowrap", padding: "6px 14px", borderRadius: 999,
            background: C.chip, color: C.chipText, fontWeight: 700, fontSize: 15, letterSpacing: "-.01em", fontVariantNumeric: "tabular-nums" }}>
            {format(values[r - min])}
          </span>
        ))}
        <motion.span className={`${PREFIX}-chip`} data-testid="plan-slider-value" initial={false} animate={{ left: `${pct(level)}%` }} transition={spring}
          style={{ position: "absolute", transform: "translateX(-50%)", whiteSpace: "nowrap", padding: "6px 16px", borderRadius: 999, background: C.chipOn, color: C.chipOnText,
            fontWeight: 800, fontSize: 17, letterSpacing: "-.02em", fontVariantNumeric: "tabular-nums", boxShadow: dark ? "none" : "0 4px 14px rgba(110,88,241,.16)" }}>
          {format(values[level - min])}
        </motion.span>
      </div>
    </div>
  );
}

export default PlanSlider;

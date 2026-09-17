import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  value: number;
  /** Decimales que se muestran (p. ej. 1 para "4,3"). */
  decimals?: number;
  suffix?: string;
  durationMs?: number;
  className?: string;
}

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Cifra que sube hasta su valor al aparecer (y desde el valor anterior cuando cambia), como
 *  las métricas del diseño. Con "reducir movimiento" pinta el valor final sin animar. */
export function CountUp({ value, decimals = 0, suffix = "", durationMs = 900, className }: CountUpProps) {
  const safe = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(() => (reducedMotion() ? safe : 0));
  const fromRef = useRef(shown);

  useEffect(() => {
    if (reducedMotion() || typeof requestAnimationFrame === "undefined") { setShown(safe); fromRef.current = safe; return; }
    const from = fromRef.current;
    if (from === safe) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const next = from + (safe - from) * eased;
      setShown(next);
      fromRef.current = next;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [safe, durationMs]);

  const text = shown.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span className={className} aria-label={`${safe.toLocaleString("es-ES", { maximumFractionDigits: decimals })}${suffix}`}>{text}{suffix}</span>;
}

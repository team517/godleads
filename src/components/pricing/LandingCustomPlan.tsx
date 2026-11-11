import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatedNumber } from "@/components/pricing/CustomPlanBuilder";
import {
  CUSTOM_DEFAULT_LEVEL, CUSTOM_LEVELS, customLevel, customPerMonth, customYearSavings, fmtVolume, type CustomInterval,
} from "@/lib/custom-plan";

/* Plan a medida en la landing (11-11-2026). La landing es el diseño de Claude Design servido tal cual
   en un marco (ver Landing.tsx), con sus estilos en línea y en inglés: esta sección se pinta DENTRO
   del marco, justo debajo de la tabla de precios, con estilos en línea y las mismas medidas, colores y
   tipografías del diseño (Inter, Schibsted Grotesk, #6E58F1, bordes #E6E3F0), para que parezca suya.
   No usa Tailwind: el marco no lo carga y meterlo rompería el diseño. */

export const LANDING_CUSTOM_HOST_ID = "fl-custom-plan";
const STYLE_ID = "fl-custom-plan-style";

const en = (n: number) => n.toLocaleString("en-US");

/** Estilos de la barra (el input range necesita pseudo-elementos: van en un <style> del marco). */
const RANGE_CSS = `
#${LANDING_CUSTOM_HOST_ID} input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:28px;background:transparent;margin:0;cursor:pointer}
#${LANDING_CUSTOM_HOST_ID} input[type=range]:focus{outline:none}
#${LANDING_CUSTOM_HOST_ID} input[type=range]::-webkit-slider-runnable-track{height:8px;border-radius:999px;background:linear-gradient(90deg,#6E58F1 0%,#6E58F1 var(--fl-p),#E6E3F0 var(--fl-p),#E6E3F0 100%)}
#${LANDING_CUSTOM_HOST_ID} input[type=range]::-moz-range-track{height:8px;border-radius:999px;background:#E6E3F0}
#${LANDING_CUSTOM_HOST_ID} input[type=range]::-moz-range-progress{height:8px;border-radius:999px;background:#6E58F1}
#${LANDING_CUSTOM_HOST_ID} input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:24px;height:24px;margin-top:-8px;border-radius:50%;background:#6E58F1;border:3px solid #fff;box-shadow:0 4px 14px rgba(110,88,241,.45);transition:transform .15s ease}
#${LANDING_CUSTOM_HOST_ID} input[type=range]::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#6E58F1;border:3px solid #fff;box-shadow:0 4px 14px rgba(110,88,241,.45)}
#${LANDING_CUSTOM_HOST_ID} input[type=range]:hover::-webkit-slider-thumb{transform:scale(1.1)}
#${LANDING_CUSTOM_HOST_ID} input[type=range]:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 6px rgba(110,88,241,.22),0 4px 14px rgba(110,88,241,.45)}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr)}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-side{border-left:1px solid #E6E3F0}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-tick-odd{display:inline}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-cta:hover{background:#5B40FB !important}
@media (max-width: 820px){
  #${LANDING_CUSTOM_HOST_ID} .fl-cp-grid{grid-template-columns:1fr}
  #${LANDING_CUSTOM_HOST_ID} .fl-cp-side{border-left:0;border-top:1px solid #E6E3F0}
}
@media (max-width: 560px){
  #${LANDING_CUSTOM_HOST_ID} .fl-cp-stats{grid-template-columns:1fr}
  #${LANDING_CUSTOM_HOST_ID} .fl-cp-tick-odd{display:none}
}`;

const FEATURES = ["Unlimited mailboxes & warmup", "AI agent replies", "A/B testing & follow-ups", "Unibox Pro", "Revenue analytics", "1:1 support"];

/** Inserta el hueco de la sección dentro del marco, bajo la tabla de precios, y lo devuelve. */
export function ensureLandingHost(doc: Document | null | undefined): HTMLElement | null {
  if (!doc) return null;
  const pricing = doc.getElementById("pricing");
  const inner = pricing?.firstElementChild as HTMLElement | null;
  if (!inner) return null;
  let host = doc.getElementById(LANDING_CUSTOM_HOST_ID);
  if (!host) {
    host = doc.createElement("div");
    host.id = LANDING_CUSTOM_HOST_ID;
    host.setAttribute("data-fl", "custom-plan");
  }
  // Justo debajo de la tabla de precios (el bloque con desplazamiento horizontal), antes de la nota
  // y de la formación 1:1. Si el diseño cambia y no se encuentra, al final de la sección.
  const tabla = Array.from(inner.children).find((el) => (el as HTMLElement).style?.overflowX === "auto" && el !== host) as HTMLElement | undefined;
  if (tabla) { if (tabla.nextElementSibling !== host) tabla.insertAdjacentElement("afterend", host); }
  else if (host.parentElement !== inner) inner.appendChild(host);
  if (!doc.getElementById(STYLE_ID)) {
    const st = doc.createElement("style");
    st.id = STYLE_ID;
    st.textContent = RANGE_CSS;
    doc.head?.appendChild(st);
  }
  return host;
}

export function LandingCustomPlanSection({ onChoose }: { onChoose: (level: number, interval: CustomInterval) => void }) {
  const [level, setLevel] = useState(CUSTOM_DEFAULT_LEVEL);
  const [interval, setInterval_] = useState<CustomInterval>("month");
  const l = customLevel(level);
  const pct = ((level - 1) / (CUSTOM_LEVELS.length - 1)) * 100;
  const pill = (on: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: 600, padding: "7px 14px", borderRadius: 999, cursor: "pointer", border: 0,
    background: on ? "#fff" : "transparent", color: on ? "#0F172B" : "#45556C", boxShadow: on ? "0 1px 3px rgba(21,17,60,.12)" : "none",
  });

  return (
    <div style={{ marginTop: 28, border: "1px solid #E6E3F0", borderRadius: 12, background: "#fff", boxShadow: "0 2px 6px rgba(21,17,60,.04)", overflow: "hidden", fontFamily: "Inter, sans-serif" }}>
      <div className="fl-cp-grid">
        <div style={{ padding: "28px 28px 26px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
            <div>
              <span style={{ display: "inline-block", fontSize: 12.5, fontWeight: 600, color: "#6E58F1", background: "#F1EEF8", padding: "5px 11px", borderRadius: 999 }}>Custom plan</span>
              <h3 style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 600, fontSize: 28, letterSpacing: "-0.03em", color: "#0F172B", margin: "10px 0 0" }}>Need more volume? Build your plan</h3>
              <p style={{ margin: "6px 0 0", fontSize: 15, color: "#45556C" }}>Slide to your sending volume. Everything in Scale, priced per volume.</p>
            </div>
            <div role="radiogroup" aria-label="Billing" style={{ display: "flex", gap: 4, background: "#E6F4EE", border: "1px solid #E6E3F0", borderRadius: 999, padding: 4 }}>
              <button type="button" role="radio" aria-checked={interval === "month"} onClick={() => setInterval_("month")} style={pill(interval === "month")}>Monthly</button>
              <button type="button" role="radio" aria-checked={interval === "year"} onClick={() => setInterval_("year")} style={pill(interval === "year")}>
                Yearly <span style={{ fontSize: 10.5, fontWeight: 600, color: "#0A7A52" }}>17% off</span>
              </button>
            </div>
          </div>

          <div style={{ marginTop: 30 }}>
            <div style={{ position: "relative", height: 20, marginBottom: 6, fontSize: 12, fontWeight: 500, color: "#5A5670" }} aria-hidden="true">
              {CUSTOM_LEVELS.map((x, i) => (
                <span key={x.level} className={i % 2 === 1 && x.level !== level ? "fl-cp-tick-odd" : undefined}
                  style={{ position: "absolute", left: `${(i / (CUSTOM_LEVELS.length - 1)) * 100}%`, transform: "translateX(-50%)", whiteSpace: "nowrap", color: x.level === level ? "#6E58F1" : "#5A5670", fontWeight: x.level === level ? 700 : 500 }}>
                  {fmtVolume(x.emails)}
                </span>
              ))}
            </div>
            <input
              type="range" min={1} max={10} step={1} value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              aria-label="Emails per month"
              aria-valuetext={`${en(l.emails)} emails per month`}
              style={{ ["--fl-p" as any]: `${pct}%` }}
            />
          </div>

          <div className="fl-cp-stats" style={{ marginTop: 22 }}>
            {[["Emails per month", l.emails], ["Contacts stored", l.contacts], ["Client workspaces", l.clients]].map(([label, value]) => (
              <div key={label as string} style={{ border: "1px solid #EAE7F4", borderRadius: 10, padding: "12px 14px", background: "#FBFAFF" }}>
                <span style={{ display: "block", fontSize: 13, color: "#5A5670" }}>{label}</span>
                <span style={{ display: "block", marginTop: 4, fontFamily: "'Schibsted Grotesk', sans-serif", fontSize: 24, fontWeight: 600, letterSpacing: "-0.03em", color: "#0F172B" }}>
                  <AnimatedNumber value={value as number} format={en} />
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="fl-cp-side" style={{ padding: "28px 28px 26px", background: "linear-gradient(160deg,#F7F5FF 0%,#FFFFFF 70%)", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 18 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#6E58F1" }}>Level {level} of 10</span>
            <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontSize: 46, fontWeight: 600, letterSpacing: "-0.04em", color: "#0F172B", lineHeight: 1 }}>
                <AnimatedNumber value={customPerMonth(l, interval)} format={(n) => `${en(n)}€`} />
              </span>
              <span style={{ fontSize: 14, color: "#5A5670" }}>/mo</span>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#5A5670", minHeight: 20 }}>
              {interval === "year" ? `Billed ${en(l.eurYear)}€ yearly · save ${en(customYearSavings(l))}€` : "Billed monthly · cancel anytime"}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 7 }}>
              {FEATURES.map((f) => (
                <li key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#1D293D" }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#05A063" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <button type="button" className="fl-cp-cta" data-testid="landing-custom-choose" onClick={() => onChoose(level, interval)}
              style={{ display: "block", width: "100%", textAlign: "center", fontSize: 16, fontWeight: 600, color: "#fff", background: "#6E58F1", padding: "13px 16px", borderRadius: 8, border: 0, cursor: "pointer", boxShadow: "0 6px 18px rgba(110,88,241,.38)", transition: "background .15s ease" }}>
              Choose this plan →
            </button>
            <p style={{ margin: "10px 0 0", textAlign: "center", fontSize: 12.5, color: "#5A5670" }}>Secure payment with Stripe · charged today, no trial</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Monta la sección dentro del marco de la landing (y la vuelve a poner si el diseño se repinta). */
export function LandingCustomPlan({ frame, ready, onChoose }: { frame: HTMLIFrameElement | null; ready: boolean; onChoose: (level: number, interval: CustomInterval) => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!ready || !frame) return;
    const poner = () => {
      try {
        const h = ensureLandingHost(frame.contentDocument);
        if (h) setHost((prev) => (prev === h ? prev : h));
      } catch { /* marco aún no accesible */ }
    };
    poner();
    const t = window.setInterval(poner, 1000);
    return () => window.clearInterval(t);
  }, [ready, frame]);
  if (!host) return null;
  return createPortal(<LandingCustomPlanSection onChoose={onChoose} />, host);
}

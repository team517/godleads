import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatedNumber } from "@/components/pricing/CustomPlanBuilder";
import {
  CUSTOM_DEFAULT_LEVEL, CUSTOM_LEVELS, customLevel, customPerMonth, customYearSavings, fmtVolume, type CustomInterval,
} from "@/lib/custom-plan";
import { PlanSlider, StarGlyph, type PlanSliderZone } from "@/components/pricing/PlanSlider";

/* Plan a medida en la landing (11-11-2026). La landing es el diseño de Claude Design servido tal cual
   en un marco (ver Landing.tsx), con sus estilos en línea y en inglés: esta sección se pinta DENTRO
   del marco, justo debajo de la tabla de precios, con estilos en línea y las mismas medidas, colores y
   tipografías del diseño (Inter, Schibsted Grotesk, #6E58F1, bordes #E6E3F0), para que parezca suya.
   No usa Tailwind: el marco no lo carga y meterlo rompería el diseño. */

export const LANDING_CUSTOM_HOST_ID = "fl-custom-plan";
const STYLE_ID = "fl-custom-plan-style";

const en = (n: number) => n.toLocaleString("en-US");

/** Estilos de la sección (rejillas que cambian en móvil): van en un <style> dentro del marco. */
const SECTION_CSS = `
#${LANDING_CUSTOM_HOST_ID} .fl-cp-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:18px}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-feats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-cta{transition:filter .15s ease, transform .15s ease}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-cta:hover{filter:brightness(1.08)}
#${LANDING_CUSTOM_HOST_ID} .fl-cp-cta:active{transform:scale(.98)}
@media (max-width: 860px){ #${LANDING_CUSTOM_HOST_ID} .fl-cp-grid{grid-template-columns:1fr} }
@media (max-width: 560px){
  #${LANDING_CUSTOM_HOST_ID} .fl-cp-stats{grid-template-columns:1fr}
  #${LANDING_CUSTOM_HOST_ID} .fl-cp-feats{grid-template-columns:1fr}
  #${LANDING_CUSTOM_HOST_ID} .fl-cp-pad{padding:22px 14px !important}
}`;

const FEATURES = ["Unlimited mailboxes & warmup", "AI agent replies", "A/B testing & follow-ups", "Unibox Pro", "Revenue analytics", "1:1 support"];
const ZONES_EN: PlanSliderZone[] = [
  { label: "Basic", short: "Basic", from: 1, to: 3 },
  { label: "Professional", short: "Pro", from: 4, to: 6 },
  { label: "Enterprise", short: "Enterprise", from: 7, to: 10 },
];
const VOLUMES = CUSTOM_LEVELS.map((x) => x.emails);
/** "250K", "1M", "1.5M" (la landing va en inglés). */
const volEn = (n: number) => fmtVolume(n).replace(",", ".");

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
    st.textContent = SECTION_CSS;
    doc.head?.appendChild(st);
  }
  return host;
}

export function LandingCustomPlanSection({ onChoose }: { onChoose: (level: number, interval: CustomInterval) => void }) {
  const [level, setLevel] = useState(CUSTOM_DEFAULT_LEVEL);
  const [interval, setInterval_] = useState<CustomInterval>("month");
  const l = customLevel(level);
  const pill = (on: boolean): React.CSSProperties => ({
    fontSize: 14, fontWeight: 600, padding: "8px 16px", borderRadius: 999, cursor: "pointer", border: 0,
    background: on ? "linear-gradient(100deg,#2E7BFF,#5B3BFF 50%,#8B2CF5)" : "transparent", color: on ? "#fff" : "#45556C",
    boxShadow: on ? "0 6px 16px rgba(91,59,255,.35)" : "none",
  });
  const stat = (label: string, value: number) => (
    <div key={label} style={{ border: "1px solid rgba(110,88,241,.16)", borderRadius: 14, padding: "13px 15px", background: "linear-gradient(180deg,rgba(110,88,241,.06),rgba(110,88,241,0))" }}>
      <span style={{ display: "block", fontSize: 13, color: "#5A5670" }}>{label}</span>
      <span style={{ display: "block", marginTop: 4, fontFamily: "'Schibsted Grotesk', sans-serif", fontSize: 25, fontWeight: 700, letterSpacing: "-0.03em", color: "#1B1546" }}>
        <AnimatedNumber value={value} format={en} />
      </span>
    </div>
  );

  return (
    <div style={{ marginTop: 32, padding: 1.5, borderRadius: 24, background: "linear-gradient(135deg,rgba(0,200,240,.55),rgba(91,59,255,.45) 45%,rgba(138,28,255,.55))", boxShadow: "0 24px 60px -30px rgba(91,59,255,.55)", fontFamily: "Inter, sans-serif" }}>
      <div className="fl-cp-pad" style={{ position: "relative", overflow: "hidden", borderRadius: 22.5, background: "rgba(255,255,255,.97)", padding: "32px 32px 30px" }}>
        <span aria-hidden="true" style={{ position: "absolute", left: -110, top: -110, width: 300, height: 300, borderRadius: "50%", background: "rgba(0,200,240,.10)", filter: "blur(50px)", pointerEvents: "none" }} />
        <span aria-hidden="true" style={{ position: "absolute", right: -110, top: 40, width: 300, height: 300, borderRadius: "50%", background: "rgba(138,28,255,.10)", filter: "blur(50px)", pointerEvents: "none" }} />

        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
            <div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#6E58F1", background: "rgba(110,88,241,.10)", padding: "5px 12px", borderRadius: 999 }}>
                <StarGlyph size={13} /> Custom plan
              </span>
              <h3 style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontWeight: 700, fontSize: 30, letterSpacing: "-0.03em", color: "#1B1546", margin: "12px 0 0" }}>Need more volume? Build your plan</h3>
              <p style={{ margin: "6px 0 0", fontSize: 15, color: "#45556C" }}>Slide to your sending volume. Contacts and client workspaces grow with it — everything in Pack Agency included.</p>
            </div>
            <div role="radiogroup" aria-label="Billing" style={{ display: "flex", gap: 4, background: "#F1EEFB", border: "1px solid #E6E3F0", borderRadius: 999, padding: 4 }}>
              <button type="button" role="radio" aria-checked={interval === "month"} onClick={() => setInterval_("month")} style={pill(interval === "month")}>Monthly</button>
              <button type="button" role="radio" aria-checked={interval === "year"} onClick={() => setInterval_("year")} style={pill(interval === "year")}>
                Yearly <span style={{ fontSize: 10.5, fontWeight: 700, marginLeft: 4, color: interval === "year" ? "#fff" : "#0A7A52" }}>-17%</span>
              </button>
            </div>
          </div>

          <div style={{ marginTop: 30 }}>
            <PlanSlider level={level} onChange={setLevel} zones={ZONES_EN} values={VOLUMES} format={volEn}
              ariaLabel="Emails per month" valueText={(lv) => `${en(customLevel(lv).emails)} emails per month`} />
          </div>

          <div className="fl-cp-grid" style={{ marginTop: 28 }}>
            <div>
              <div className="fl-cp-stats">
                {stat("Emails per month", l.emails)}
                {stat("Contacts stored", l.contacts)}
                {stat("Client workspaces", l.clients)}
              </div>
              <ul className="fl-cp-feats" style={{ listStyle: "none", padding: 0, margin: "16px 0 0" }}>
                {FEATURES.map((f) => (
                  <li key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#1D293D" }}>
                    <span style={{ display: "inline-flex", width: 20, height: 20, borderRadius: 999, alignItems: "center", justifyContent: "center", background: "rgba(110,88,241,.12)", flexShrink: 0 }}>
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#6E58F1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ border: "1px solid rgba(110,88,241,.22)", borderRadius: 18, padding: 22, background: "linear-gradient(135deg,rgba(59,91,255,.07),rgba(255,255,255,0) 50%,rgba(138,28,255,.08))", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 18 }}>
              <div>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#6E58F1", background: "rgba(110,88,241,.10)", padding: "4px 10px", borderRadius: 999 }}>Level {level} of 10</span>
                <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontFamily: "'Schibsted Grotesk', sans-serif", fontSize: 48, fontWeight: 700, letterSpacing: "-0.04em", color: "#1B1546", lineHeight: 1 }}>
                    <AnimatedNumber value={customPerMonth(l, interval)} format={(n) => `${en(n)}€`} />
                  </span>
                  <span style={{ fontSize: 14, color: "#5A5670" }}>/mo</span>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#5A5670", minHeight: 20 }}>
                  {interval === "year" ? `Billed ${en(l.eurYear)}€ yearly · save ${en(customYearSavings(l))}€` : "Billed monthly · cancel anytime"}
                </p>
              </div>
              <div>
                <button type="button" className="fl-cp-cta" data-testid="landing-custom-choose" onClick={() => onChoose(level, interval)}
                  style={{ display: "block", width: "100%", textAlign: "center", fontSize: 16, fontWeight: 700, color: "#fff", background: "linear-gradient(100deg,#2E7BFF,#5B3BFF 50%,#8B2CF5)", padding: "14px 16px", borderRadius: 12, border: 0, cursor: "pointer", boxShadow: "0 12px 28px rgba(91,59,255,.38)" }}>
                  Choose this plan →
                </button>
                <p style={{ margin: "10px 0 0", textAlign: "center", fontSize: 12.5, color: "#5A5670" }}>Secure payment with Stripe · charged today, no trial</p>
              </div>
            </div>
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

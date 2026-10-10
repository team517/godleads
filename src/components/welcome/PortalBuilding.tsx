import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { SparkMark } from "@/components/SparkMark";
import { Wordmark } from "@/components/Wordmark";
import { PASO_MIN_MS, type PasoPortal } from "@/lib/portal-build";
import { cn } from "@/lib/utils";

/* "Construyendo tu portal" — la carga al terminar la bienvenida, con el diseño del propietario:
   la chispa de OnePulso en su baldosa, un anillo que se va llenando con cada paso y la lista de
   pasos con su check. Los pasos van de uno en uno y cada uno espera a que su trabajo termine. */

type Estado = "pending" | "active" | "done";
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const R = 112;                       // radio del anillo de progreso
const C = 2 * Math.PI * R;

function Anillo({ progreso }: { progreso: number }) {
  const p = Math.max(0, Math.min(1, progreso));
  const ang = (-90 + 360 * p) * (Math.PI / 180);
  const dot = { x: 160 + R * Math.cos(ang), y: 160 + R * Math.sin(ang) };
  return (
    <svg viewBox="0 0 320 320" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="pb-arc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4F8BFF" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
        <radialGradient id="pb-halo" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#c9c2ff" stopOpacity=".28" />
        </radialGradient>
      </defs>
      <circle cx="160" cy="160" r="156" fill="none" stroke="#e6e8f7" strokeOpacity=".7" />
      <circle cx="160" cy="160" r="136" fill="none" stroke="#e6e8f7" strokeOpacity=".9" />
      <circle cx="160" cy="160" r={R} fill="url(#pb-halo)" stroke="#e9e6ff" strokeWidth="5" />
      <circle
        cx="160" cy="160" r={R} fill="none" stroke="url(#pb-arc)" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 160 160)"
        style={{ transition: "stroke-dashoffset .7s cubic-bezier(.2,.7,.2,1)" }}
      />
      {p > 0.01 && (
        <circle cx={dot.x} cy={dot.y} r="7" fill="#fff" stroke="#dcd7ff" strokeWidth="2"
          style={{ transition: "cx .7s cubic-bezier(.2,.7,.2,1), cy .7s cubic-bezier(.2,.7,.2,1)" }} />
      )}
    </svg>
  );
}

const PUNTOS = [
  { l: "12%", t: "8%", c: "#5b8cff", d: 0 }, { l: "88%", t: "20%", c: "#a15cff", d: 0.8 },
  { l: "3%", t: "40%", c: "#8e83ff", d: 1.6 }, { l: "14%", t: "80%", c: "#a15cff", d: 0.4 },
  { l: "86%", t: "86%", c: "#5b8cff", d: 1.2 }, { l: "97%", t: "56%", c: "#c3bfff", d: 2 },
];

export default function PortalBuilding({ pasos, onDone, minMs = PASO_MIN_MS }: { pasos: PasoPortal[]; onDone: () => void; minMs?: number }) {
  const [estados, setEstados] = useState<Estado[]>(() => pasos.map(() => "pending"));
  const [tiempos, setTiempos] = useState<(number | null)[]>(() => pasos.map(() => null));
  const [ahora, setAhora] = useState(0);
  const inicio = useRef(Date.now());
  const hecho = useRef(false);

  // Contador en vivo del paso activo.
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now() - inicio.current), 250);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (hecho.current) return;
    hecho.current = true;
    let vivo = true;
    (async () => {
      for (let i = 0; i < pasos.length; i++) {
        if (!vivo) return;
        setEstados((e) => e.map((x, j) => (j === i ? "active" : x)));
        // Un paso que falla no bloquea: su trabajo es ayudar, no dejar a nadie fuera del panel.
        await Promise.all([pasos[i].run().catch(() => undefined), esperar(minMs)]);
        if (!vivo) return;
        const seg = Math.max(1, Math.round((Date.now() - inicio.current) / 1000));
        setTiempos((t) => t.map((x, j) => (j === i ? seg : x)));
        setEstados((e) => e.map((x, j) => (j === i ? "done" : x)));
      }
      await esperar(Math.min(450, minMs));
      if (vivo) onDone();
    })();
    return () => { vivo = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hechos = estados.filter((e) => e === "done").length;
  const activo = estados.indexOf("active");
  const progreso = (hechos + (activo >= 0 ? 0.35 : 0)) / pasos.length;

  return (
    <div className="page-enter mx-auto flex w-full max-w-[720px] flex-col items-center pb-16 pt-2 text-center" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <SparkMark size={34} variant="star" />
        <Wordmark className="h-6" colorClassName="text-[#0b1040]" />
      </div>

      <div className="relative mt-6 h-[270px] w-[270px] sm:h-[320px] sm:w-[320px]">
        {PUNTOS.map((p, i) => (
          <span key={i} className="wv-float absolute h-[7px] w-[7px] rounded-full" style={{ left: p.l, top: p.t, background: p.c, animationDelay: `${p.d}s`, opacity: 0.75 }} />
        ))}
        <Anillo progreso={progreso} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="pb-breathe flex items-center justify-center rounded-[30px] shadow-[0_18px_40px_rgba(98,86,255,.18)]">
            <SparkMark size={132} className="rounded-[30px]" />
          </span>
        </div>
      </div>

      <h1 className="mt-4 font-display text-[clamp(32px,4.2vw,48px)] font-semibold leading-[1.1] tracking-[-1.5px] text-[#0b1040]">
        Construyendo <span className="bg-gradient-to-r from-[#7b5cff] to-[#b04dff] bg-clip-text text-transparent">tu portal</span>
      </h1>
      <p className="mt-3 max-w-[560px] text-[clamp(15px,1.5vw,18px)] leading-[1.5] text-[#6470a8]">
        <span className="block">OnePulso está preparando tu espacio: leads, campañas, cuentas y Unibox.</span>
        <span className="block">Te llevamos dentro en cuanto esté listo.</span>
      </p>

      <ol className="soft-glass mt-8 w-full overflow-hidden rounded-[22px] bg-white/80 px-5 py-2 text-left sm:px-9">
        {pasos.map((p, i) => {
          const e = estados[i];
          const seg = e === "done" ? tiempos[i] : e === "active" ? Math.max(1, Math.round(ahora / 1000)) : null;
          return (
            <li key={p.id} className={cn("flex items-center gap-4 py-3.5", i > 0 && "border-t border-[#eef0f8]")}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                {e === "done" ? (
                  <span className="chip-pop flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#6E58F1] to-[#8B5CF6] shadow-[0_4px_10px_rgba(110,88,241,.35)]">
                    <Check className="h-4 w-4 text-white" strokeWidth={3} />
                  </span>
                ) : e === "active" ? (
                  <span className="h-7 w-7 rounded-full border-[2.5px] border-[#e4e0ff] border-l-[#4F8BFF] border-t-[#7b5cff] motion-safe:animate-spin" />
                ) : (
                  <span className="h-7 w-7 rounded-full border-2 border-[#dfe3f1]" />
                )}
              </span>
              <span className={cn("flex-1 text-[15.5px] sm:text-[16px]",
                e === "active" ? "font-semibold text-[#1d2260]" : e === "done" ? "text-[#3b4270]" : "text-[#5f689f]")}>
                {p.label}
              </span>
              <span className="w-10 shrink-0 text-right text-[14px] tabular-nums text-[#7c84ad]">{seg ? `${seg} s` : "—"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

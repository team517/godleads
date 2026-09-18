import { BarChart3, Mail, Plus, SendHorizonal, ShieldCheck, Sparkles, Zap } from "lucide-react";

/* Cuentas conectadas, cuando todavía no hay ninguna.
 *
 * En vez de una tarjeta vacía con un icono gris, la pantalla del diseño: la tabla "fantasma" de
 * lo que va a haber ahí, el sobre de la marca y un solo botón grande para conectar la primera. */

interface Props {
  onAdd: () => void;
  /** Conectar varias a la vez (CSV). Sólo se ofrece a quien tiene esa opción. */
  onBulk?: () => void;
}

const COLUMNS = ["Correo", "Etiquetas", "Tipo", "Estado", "Salud"];

/** La tabla que verá en cuanto conecte: puro decorado, se desvanece hacia abajo. */
function GhostTable() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 hidden select-none px-4 sm:block"
      style={{ maskImage: "linear-gradient(to bottom, #000 0%, #000 34%, transparent 76%)", WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 34%, transparent 76%)" }}
    >
      <div className="mx-auto max-w-[1180px] overflow-hidden rounded-[14px] border border-[#EAE7F4] bg-white/70 dark:border-border dark:bg-white/[.03]">
        <div className="grid grid-cols-[28px_repeat(5,1fr)] items-center gap-4 border-b border-[#EAE7F4] px-4 py-3.5 dark:border-border">
          <span className="h-[15px] w-[15px] rounded-[4px] border border-[#D5D2DD] dark:border-border" />
          {COLUMNS.map((c) => (
            <span key={c} className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#65768D] dark:text-muted-foreground">{c}</span>
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="grid grid-cols-[28px_repeat(5,1fr)] items-center gap-4 border-b border-[#EAE7F4]/70 px-4 py-3.5 last:border-0 dark:border-border/70">
            <span className="h-[15px] w-[15px] rounded-[4px] border border-[#D5D2DD] dark:border-border" />
            {COLUMNS.map((c) => (
              <span key={c} className="h-[13px] rounded-full bg-[#E9ECF8] dark:bg-white/10" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const DOTS = "radial-gradient(#C9BFFA 1.4px, transparent 1.4px)";

export default function AccountsEmptyState({ onAdd, onBulk }: Props) {
  return (
    <section className="relative isolate overflow-hidden rounded-[16px] border border-[#EAE7F4] bg-[#FBFAFE] px-5 dark:border-border dark:bg-card pb-12 pt-6 sm:px-8">
      {/* Luz de fondo y retícula de puntos, como en el diseño. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 top-[-30%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(139,107,255,.16),transparent)]" />
        <div className="absolute -right-32 bottom-[-35%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(47,198,238,.14),transparent)]" />
        <span className="absolute left-1 top-8 hidden h-20 w-28 opacity-60 dark:opacity-25 lg:block" style={{ backgroundImage: DOTS, backgroundSize: "14px 14px" }} />
        <span className="absolute bottom-8 left-1 hidden h-20 w-28 opacity-60 dark:opacity-25 lg:block" style={{ backgroundImage: DOTS, backgroundSize: "14px 14px" }} />
      </div>

      <GhostTable />

      {/* Piezas flotantes */}
      <span aria-hidden className="wv-float absolute left-[4%] top-[42%] hidden place-items-center rounded-[16px] border border-white bg-white/85 p-3 dark:border-white/10 dark:bg-white/5 shadow-[0_12px_30px_rgba(21,17,60,.09)] backdrop-blur-sm lg:grid">
        <SendHorizonal className="h-6 w-6 text-[#6E58F1]" strokeWidth={1.7} />
      </span>
      <span aria-hidden className="wv-float absolute right-[4%] top-[48%] hidden place-items-center rounded-[16px] border border-white bg-white/85 p-3 dark:border-white/10 dark:bg-white/5 shadow-[0_12px_30px_rgba(21,17,60,.09)] backdrop-blur-sm lg:grid" style={{ animationDelay: "1.8s" }}>
        <Mail className="h-6 w-6 text-[#8B5CF6]" strokeWidth={1.7} />
      </span>
      <Sparkles aria-hidden className="absolute left-[16%] top-[58%] hidden h-5 w-5 text-[#8B6BFF]/70 lg:block" />
      <Sparkles aria-hidden className="absolute right-[15%] top-[44%] hidden h-5 w-5 text-[#2FC6EE]/80 lg:block" />

      {/* Contenido */}
      <div className="relative flex flex-col items-center pt-[190px] text-center sm:pt-[230px]">
        <span className="wv-float relative grid h-[76px] w-[76px] place-items-center rounded-[20px] bg-[linear-gradient(135deg,#3B82F6_0%,#5FB8F0_45%,#6FDDAE_100%)] shadow-[0_16px_34px_rgba(59,130,246,.30)]">
          <Mail className="h-8 w-8 text-white" strokeWidth={1.8} />
          <span aria-hidden className="absolute -right-4 -top-3 text-[#3B82F6]">
            <svg viewBox="0 0 22 22" className="h-5 w-5"><g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 9L1 6" /><path d="M8 5.5L7.6 2.4" /><path d="M12.2 8.4L14.8 6" /></g></svg>
          </span>
        </span>

        <h2 className="mt-7 font-display text-[clamp(26px,3.4vw,42px)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#0F172B] dark:text-foreground">
          Conecta una cuenta de envío
        </h2>
        <p className="mt-3 max-w-[560px] text-[16.5px] leading-[1.5] text-[#45556C] dark:text-muted-foreground">
          Usaremos tu cuenta para enviar los correos, medir los resultados y mantenerlo todo sincronizado.
        </p>

        <button
          type="button"
          onClick={onAdd}
          className="group mt-8 inline-flex items-center gap-2.5 rounded-[12px] bg-[linear-gradient(90deg,#3B82F6_0%,#7C5CFB_52%,#9333EA_100%)] px-10 py-4 text-[16px] font-semibold text-white shadow-[0_12px_26px_rgba(110,88,241,.30)] transition-all duration-200 hover:-translate-y-[2px] hover:shadow-[0_16px_34px_rgba(110,88,241,.36)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8B6BFF]/50"
        >
          <Plus className="h-[18px] w-[18px] transition-transform duration-200 group-hover:rotate-90" />
          Añadir cuenta
        </button>

        {onBulk && (
          <button type="button" onClick={onBulk} className="mt-4 text-[14px] font-semibold text-[#65768D] underline-offset-4 dark:text-muted-foreground transition-colors hover:text-[#6E58F1] hover:underline">
            o conecta varias a la vez con un CSV
          </button>
        )}

        <ul className="mt-10 grid w-full max-w-[860px] gap-5 sm:grid-cols-3">
          {[
            { Icon: ShieldCheck, tint: "bg-[#E8F1FE] text-[#3B89E9] dark:bg-[#3B89E9]/15", title: "Seguro", text: "Tus datos no salen de tu cuenta" },
            { Icon: Zap, tint: "bg-[#F1EEF8] text-[#6E58F1] dark:bg-primary/15", title: "Rápido", text: "Se conecta en menos de un minuto" },
            { Icon: BarChart3, tint: "bg-[#E8FBF2] text-[#05A063] dark:bg-[#05A063]/15", title: "Mejores resultados", text: "SPF, DKIM y DMARC revisados" },
          ].map(({ Icon, tint, title, text }, i) => (
            <li key={title} style={{ animationDelay: `${0.08 + i * 0.09}s` }} className="chip-pop flex items-center justify-center gap-3 text-left">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tint}`}><Icon className="h-5 w-5" strokeWidth={1.9} /></span>
              <span>
                <span className="block text-[15px] font-semibold text-[#0F172B] dark:text-foreground">{title}</span>
                <span className="block text-[13.5px] text-[#65768D] dark:text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

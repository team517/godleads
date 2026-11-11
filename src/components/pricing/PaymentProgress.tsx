import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, CreditCard, ExternalLink, Loader2, Mail, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAYMENT_PROCESSING_MS, type PaymentStage } from "@/hooks/usePaymentConfirmation";

/* Las tres fases de un pago, iguales en todas partes (plan a medida, alta, vuelta de Stripe):
   1 · Esperando tu pago en Stripe…  2 · Pago recibido · Procesando tu plan…  3 · ¡Listo!
   La 2 y la 3 sólo llegan cuando el SERVIDOR ha confirmado el pago (usePaymentConfirmation). No hay
   botón de "ya he pagado": si tarda mucho, se ofrece escribirnos. */

const PASOS: { id: PaymentStage; label: string }[] = [
  { id: "esperando", label: "Pago" },
  { id: "procesando", label: "Procesando" },
  { id: "listo", label: "Listo" },
];

export function PaymentProgress({
  stage, slow, waitingTitle = "Esperando tu pago en Stripe…", waitingText, reopenUrl, doneTitle, doneText, doneAction, tone = "app", className,
}: {
  stage: PaymentStage;
  slow?: boolean;
  waitingTitle?: string;
  waitingText?: ReactNode;
  reopenUrl?: string | null;
  doneTitle: string;
  doneText?: ReactNode;
  doneAction?: ReactNode;
  /** "app" usa los colores del tema (modo oscuro incluido); "light" es la pantalla clara del alta. */
  tone?: "app" | "light";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const idx = PASOS.findIndex((p) => p.id === stage);
  const light = tone === "light";
  const titleCls = light ? "text-[#0F172B]" : "text-foreground";
  const textCls = light ? "text-[#45556C]" : "text-muted-foreground";

  return (
    <div className={cn("flex flex-col items-center text-center", className)} role="status" aria-live="polite" data-testid="payment-progress" data-stage={stage}>
      {/* Pasos */}
      <ol className="mb-6 flex w-full max-w-[320px] items-center" aria-label="Estado del pago">
        {PASOS.map((p, i) => (
          <li key={p.id} className="flex flex-1 items-center last:flex-none">
            <span className="flex flex-col items-center gap-1.5">
              <span className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold transition-colors duration-300",
                i < idx || stage === "listo" ? "bg-gradient-to-br from-[#3B5BFF] to-[#8A1CFF] text-white"
                  : i === idx ? "bg-[#6E58F1]/12 text-[#6E58F1] ring-2 ring-[#6E58F1]"
                  : light ? "bg-[#EEEBF7] text-[#8A8FB0]" : "bg-muted text-muted-foreground",
              )}>
                {i < idx || stage === "listo" ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn("text-[11.5px] font-medium", i === idx ? (light ? "text-[#0F172B]" : "text-foreground") : textCls)}>{p.label}</span>
            </span>
            {i < PASOS.length - 1 && (
              <span className={cn("mx-2 mb-5 h-[3px] flex-1 overflow-hidden rounded-full", light ? "bg-[#EEEBF7]" : "bg-muted")}>
                <motion.span
                  className="block h-full rounded-full bg-gradient-to-r from-[#00C8F0] via-[#3B5BFF] to-[#8A1CFF]"
                  initial={false}
                  animate={{ width: i < idx ? "100%" : "0%" }}
                  transition={{ duration: reduce ? 0 : 0.5, ease: "easeOut" }}
                />
              </span>
            )}
          </li>
        ))}
      </ol>

      <AnimatePresence mode="wait" initial={false}>
        {stage === "esperando" && (
          <motion.div key="esperando" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: reduce ? 0 : 0.2 }} className="flex flex-col items-center">
            <span className="relative flex h-14 w-14 items-center justify-center">
              {!reduce && <span className="absolute inset-0 animate-ping rounded-full bg-[#6E58F1]/15" />}
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#6E58F1]/10 text-[#6E58F1]"><CreditCard className="h-6 w-6" /></span>
            </span>
            <p className={cn("mt-4 font-display text-[19px] font-semibold tracking-[-0.02em]", titleCls)}>{waitingTitle}</p>
            {waitingText && <p className={cn("mt-1.5 max-w-[360px] text-[13.5px] leading-relaxed", textCls)}>{waitingText}</p>}
            <p className={cn("mt-3 inline-flex items-center gap-1.5 text-[12.5px]", textCls)}><Loader2 className="h-3.5 w-3.5 animate-spin" /> Esta pantalla se actualiza sola en cuanto Stripe lo confirme</p>
            {reopenUrl && (
              <a href={reopenUrl} target="_blank" rel="noopener" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6E58F1] hover:underline">
                Volver a abrir el pago <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {slow && (
              <p className={cn("mt-4 max-w-[360px] rounded-xl border px-3 py-2.5 text-[12.5px]", light ? "border-[#F2D9B8] bg-[#FFF8EE] text-[#7A4A12]" : "border-warning/30 bg-warning/10 text-foreground")} data-testid="payment-slow">
                ¿Algún problema con el pago? <a className="font-semibold underline" href="mailto:team@onepulso.online?subject=Pago%20de%20Funnyleads">Escríbenos</a> o abre el chat de abajo a la derecha y lo miramos al momento.
              </p>
            )}
          </motion.div>
        )}

        {stage === "procesando" && (
          <motion.div key="procesando" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: reduce ? 0 : 0.2 }} className="flex w-full flex-col items-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#3B5BFF] to-[#8A1CFF] text-white shadow-[0_10px_28px_rgba(110,88,241,.35)]">
              <Sparkles className="h-6 w-6" />
            </span>
            <p className={cn("mt-4 font-display text-[19px] font-semibold tracking-[-0.02em]", titleCls)}>Pago recibido · Procesando tu plan…</p>
            <div className={cn("mt-4 h-1.5 w-full max-w-[260px] overflow-hidden rounded-full", light ? "bg-[#EEEBF7]" : "bg-muted")}>
              <motion.div className="h-full rounded-full bg-gradient-to-r from-[#00C8F0] via-[#3B5BFF] to-[#8A1CFF]"
                initial={{ width: "8%" }} animate={{ width: "100%" }} transition={{ duration: reduce ? 0 : PAYMENT_PROCESSING_MS / 1000, ease: "easeInOut" }} />
            </div>
          </motion.div>
        )}

        {stage === "listo" && (
          <motion.div key="listo" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: reduce ? 0 : 0.25 }} className="flex flex-col items-center" data-testid="payment-done">
            <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 18 }}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_10px_28px_rgba(16,185,129,.35)]">
              <Check className="h-7 w-7" strokeWidth={3} />
            </motion.span>
            <p className={cn("mt-4 font-display text-[20px] font-semibold tracking-[-0.02em]", titleCls)}>{doneTitle}</p>
            {doneText && <p className={cn("mt-1.5 max-w-[380px] text-[13.5px]", textCls)}>{doneText}</p>}
            {doneAction && <div className="mt-5">{doneAction}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Enlace para escribirnos (se usa en pantallas sin botón de comprobar). */
export function PaymentHelpLine({ className }: { className?: string }) {
  return (
    <p className={cn("inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground", className)}>
      <Mail className="h-3.5 w-3.5" /> Si acabas de pagar, esta pantalla se actualiza sola en unos segundos. ¿Algo no cuadra? <a className="font-semibold text-primary hover:underline" href="mailto:team@onepulso.online">Escríbenos</a>
    </p>
  );
}

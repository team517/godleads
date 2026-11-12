import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Gauge, X } from "lucide-react";
import { usePlanUsageAlert } from "@/hooks/usePlanUsageAlert";
import { planAlertCopy, planAlertDismissKey } from "@/lib/plan-alerts";
import { cn } from "@/lib/utils";

/* Aviso en el panel del dueño cuando su plan va por el 80 / 95 / 100 % de los envíos del mes
   (contando los de sus clientes). Se puede cerrar; vuelve a salir si sube de nivel. */

const TONES = {
  info: "border-[#D9D2FB] bg-[#F5F2FF] text-[#2E2560] dark:border-primary/30 dark:bg-primary/10 dark:text-foreground",
  warning: "border-[#F6D7A8] bg-[#FFF7EB] text-[#5C3A0A] dark:border-warning/40 dark:bg-warning/10 dark:text-foreground",
  danger: "border-[#F5C2C2] bg-[#FFF1F1] text-[#6B1414] dark:border-destructive/40 dark:bg-destructive/10 dark:text-foreground",
} as const;

export function PlanUsageBanner() {
  const alert = usePlanUsageAlert();
  const [, bump] = useState(0);
  if (!alert) return null;
  const key = planAlertDismissKey(alert);
  let dismissed = false;
  try { dismissed = localStorage.getItem(key) === "1"; } catch { /* sin almacenamiento */ }
  if (dismissed) return null;
  const copy = planAlertCopy(alert);
  const Icon = copy.tone === "info" ? Gauge : AlertTriangle;
  const pct = Math.min(100, alert.pct);

  return (
    <div role="status" className={cn("mb-4 flex flex-col gap-3 rounded-2xl border px-4 py-3 shadow-sm sm:flex-row sm:items-center", TONES[copy.tone])}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 dark:bg-white/10">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{copy.title}</p>
        <p className="text-[13px] opacity-80">{copy.text}</p>
        <div className="mt-2 h-1.5 w-full max-w-[420px] overflow-hidden rounded-full bg-black/10 dark:bg-white/10" aria-hidden="true">
          <span className={cn("block h-full rounded-full", copy.tone === "danger" ? "bg-[#DC2626]" : copy.tone === "warning" ? "bg-[#EA580C]" : "bg-[#6E58F1]")} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link to="/settings?tab=plan" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5B5CF6] to-[#8B3CF5] px-3.5 text-[13px] font-semibold text-white shadow-[0_6px_16px_rgba(106,76,255,.28)] hover:brightness-110">
          Mejorar plan <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <button type="button" aria-label="Cerrar el aviso" onClick={() => { try { localStorage.setItem(key, "1"); } catch { /* nada */ } bump((n) => n + 1); }}
          className="flex h-8 w-8 items-center justify-center rounded-lg opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { STATUS_BY_ID, type LeadStatus } from "@/lib/mobile-inbox";

/* Piezas visuales de la app del móvil, calcadas del diseño (Instantly en claro). */

/** El rayo del diseño: contorno en las pastillas, relleno en el menú de filtros. */
export function Bolt({ color, filled = false, size = 16, strokeWidth = 2 }: { color: string; filled?: boolean; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path
        d="M13.2 2.3 4.6 13.1c-.4.5 0 1.2.6 1.2h5.6l-1.2 7.4c-.1.7.8 1.1 1.2.5l8.6-10.8c.4-.5 0-1.2-.6-1.2h-5.6l1.2-7.4c.1-.7-.8-1.1-1.2-.5Z"
        fill={filled ? color : "none"}
        stroke={color}
        strokeWidth={filled ? 0 : strokeWidth}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StatusPill({ status, size = "sm" }: { status: LeadStatus; size?: "sm" | "md" }) {
  const s = STATUS_BY_ID[status];
  return (
    <span
      className={`m-pill inline-flex shrink-0 items-center rounded-full font-medium leading-none ${size === "sm" ? "h-[25px] gap-1 pl-2 pr-2.5 text-[12px]" : "h-8 gap-2 px-3 text-sm"}`}
      style={{ background: s.pill, color: s.color }}
    >
      <Bolt color={s.color} size={size === "sm" ? 13 : 16} />
      {s.label}
    </span>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const letter = (name || "U").trim().charAt(0).toUpperCase() || "U";
  return (
    <span
      className="m-avatar flex shrink-0 items-center justify-center rounded-full font-medium"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden
    >
      {letter}
    </span>
  );
}

/** Botón cuadrado blanco de la barra superior (atrás, papelera, ···). */
export function SquareButton({ onClick, label, children, className = "" }: { onClick: () => void; label: string; children: ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className={`m-press m-square flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] ${className}`}>
      {children}
    </button>
  );
}

/** Hoja que sube desde abajo (estados, carpetas, más opciones…). */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), 260);
    return () => window.clearTimeout(t);
  }, [open]);
  // Arrastrar hacia abajo para cerrar.
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`m-backdrop absolute inset-0 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <div
        className="m-sheet absolute inset-x-0 bottom-0 mx-auto max-w-[520px] rounded-t-[22px] pb-[calc(14px+env(safe-area-inset-bottom))]"
        style={{ transform: shown ? `translateY(${drag}px)` : "translateY(105%)", transition: startY.current === null ? "transform 260ms cubic-bezier(.2,.8,.2,1)" : "none" }}
        onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
        onTouchMove={(e) => { if (startY.current !== null) setDrag(Math.max(0, e.touches[0].clientY - startY.current)); }}
        onTouchEnd={() => { const d = drag; startY.current = null; setDrag(0); if (d > 90) onClose(); }}
      >
        <div className="flex justify-center pt-2.5"><span className="h-[5px] w-10 rounded-full bg-[#DADFEC]" /></div>
        {title && (
          <div className="flex items-center justify-between px-5 pb-2 pt-3">
            <h3 className="text-[17px] font-semibold text-[#0E1330]">{title}</h3>
            <button type="button" aria-label="Cerrar" onClick={onClose} className="m-press -mr-1.5 flex h-8 w-8 items-center justify-center rounded-full text-[#6B7192]">
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto overscroll-contain px-3 pb-1">{children}</div>
      </div>
    </div>
  );
}

/** Fila de una hoja: icono, texto y marca si está elegida. */
export function SheetRow({ icon, label, hint, selected, danger, onClick }: { icon?: ReactNode; label: ReactNode; hint?: ReactNode; selected?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`m-press flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left ${selected ? "bg-[#EEF2FE]" : "active:bg-[#F3F5FB]"}`}>
      {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[15.5px] font-medium ${danger ? "text-[#E5354F]" : "text-[#0E1330]"}`}>{label}</span>
        {hint && <span className="mt-0.5 block truncate text-[12.5px] text-[#7A809B]">{hint}</span>}
      </span>
      {selected && <Check className="h-5 w-5 shrink-0 text-[#3B6CF6]" />}
    </button>
  );
}

/** Confirmación con el estilo de la app (en vez del confirm() del navegador). */
export function ConfirmSheet({ open, title, text, confirmLabel, danger, busy, onConfirm, onClose }: {
  open: boolean; title: string; text: string; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-3 pb-2 pt-3 text-center">
        <h3 className="text-[18px] font-semibold text-[#0E1330]">{title}</h3>
        <p className="mx-auto mt-2 max-w-[320px] text-[14.5px] leading-snug text-[#6B7192]">{text}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="m-press m-btn-outline h-[50px] rounded-[14px] text-[15.5px] font-semibold text-[#3A4163]">Cancelar</button>
          <button type="button" disabled={busy} onClick={onConfirm}
            className={`m-press h-[50px] rounded-[14px] text-[15.5px] font-semibold text-white disabled:opacity-60 ${danger ? "bg-[#EF3B5D]" : "m-gradient"}`}>
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Las ondas suaves del fondo del diseño (abajo de la pantalla). */
export function Waves({ className = "" }: { className?: string }) {
  return (
    <svg className={`pointer-events-none ${className}`} viewBox="0 0 400 220" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="mw1" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#E9E3FB" />
          <stop offset="1" stopColor="#E3EBFC" />
        </linearGradient>
        <linearGradient id="mw2" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#F1E8FA" />
          <stop offset="1" stopColor="#E8F0FD" />
        </linearGradient>
      </defs>
      <path d="M0 70 C 70 30, 150 40, 215 80 S 340 140, 400 95 L400 220 L0 220 Z" fill="url(#mw2)" opacity=".55" />
      <path d="M0 120 C 90 70, 170 95, 240 130 S 350 160, 400 120 L400 220 L0 220 Z" fill="url(#mw1)" opacity=".6" />
      <path d="M0 165 C 80 140, 160 150, 230 170 S 340 195, 400 175 L400 220 L0 220 Z" fill="#EEF2FD" opacity=".7" />
    </svg>
  );
}

/** Un aviso pequeño arriba (enviado, guardado, error…). */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error"; id: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.tone === "error" ? 4200 : 2400);
    return () => window.clearTimeout(t);
  }, [toast]);
  const show = (text: string, tone: "ok" | "error" = "ok") => setToast({ text, tone, id: Date.now() });
  const node = toast ? (
    <div key={toast.id} className="m-toast pointer-events-none fixed inset-x-0 top-[calc(10px+env(safe-area-inset-top))] z-[120] flex justify-center px-4">
      <div className={`max-w-[460px] rounded-[14px] px-4 py-3 text-[14.5px] font-medium shadow-[0_10px_30px_rgba(20,25,60,.18)] ${toast.tone === "error" ? "bg-[#2A1420] text-white" : "bg-[#141938] text-white"}`}>
        {toast.text}
      </div>
    </div>
  ) : null;
  return { show, node };
}

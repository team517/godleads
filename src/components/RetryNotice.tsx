import { RefreshCw } from "lucide-react";

/**
 * Aviso de "esto no se pudo cargar" con su propio Reintentar, para ponerlo DENTRO del widget que ha
 * fallado (una tarjeta, una gráfica) en vez de tumbar toda la página. `stale` = se está enseñando el
 * último dato bueno: el aviso es discreto y dice que no se pudo actualizar.
 */
export default function RetryNotice({ what, error, onRetry, stale, className = "" }: {
  what: string;
  error?: string | null;
  onRetry: () => void;
  stale?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground ${className}`}>
      <span>
        {stale ? `No se pudo actualizar ${what}` : `No se pudo cargar ${what}`}
        {error ? <span className="text-muted-foreground/70"> · {error}</span> : null}
      </span>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
        <RefreshCw className="h-3.5 w-3.5" /> Reintentar
      </button>
    </div>
  );
}

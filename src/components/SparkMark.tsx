import { cn } from "@/lib/utils";

/* La marca de OnePulso: la estrella de cuatro puntas con el degradado cian → violeta,
 * dentro de su baldosa de cristal. La usan la barra superior, el menú del móvil y el botón
 * del chat, así que el logo es el mismo en todo el producto.
 *
 * Las cuentas de CLIENTE que tienen su propio logo siguen viendo el suyo: esto es la marca
 * de la casa (agencia y usuarios normales). */

interface Props {
  /** Lado de la baldosa en píxeles. */
  size?: number;
  /** Sin baldosa: sólo la estrella (para botones que ya tienen su propio fondo). */
  bare?: boolean;
  className?: string;
}

export function SparkMark({ size = 32, bare, className }: Props) {
  const star = (
    <svg viewBox="0 0 100 100" width={bare ? size : Math.round(size * 0.56)} height={bare ? size : Math.round(size * 0.56)} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="op-spark-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#25c8f5" />
          <stop offset=".5" stopColor="#5269ff" />
          <stop offset="1" stopColor="#b82cff" />
        </linearGradient>
      </defs>
      {/* Las cuatro puntas con la curva hacia dentro del logo. */}
      <path
        d="M50 2 C54 28 60 40 72 46 C82 50 90 50 98 50 C90 50 82 50 72 54 C60 60 54 72 50 98 C46 72 40 60 28 54 C18 50 10 50 2 50 C10 50 18 50 28 46 C40 40 46 28 50 2 Z"
        fill="url(#op-spark-grad)"
      />
    </svg>
  );

  if (bare) return <span className={cn("inline-grid place-items-center", className)} role="img" aria-label="OnePulso">{star}</span>;

  return (
    <span
      role="img"
      aria-label="OnePulso"
      className={cn(
        "inline-grid shrink-0 place-items-center border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,.92),rgba(244,246,255,.86))]",
        "shadow-[0_6px_16px_rgba(82,78,200,.14)] dark:border-white/10 dark:bg-[linear-gradient(135deg,rgba(255,255,255,.12),rgba(255,255,255,.05))]",
        className,
      )}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      {star}
    </span>
  );
}

export default SparkMark;

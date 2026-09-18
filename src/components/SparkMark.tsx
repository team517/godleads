import { cn } from "@/lib/utils";
import spark from "@/assets/onepulso-spark.png";

/* La marca de OnePulso: el archivo que pasó el propietario, TAL CUAL.
 *
 * Se pinta como imagen (no como dibujo rehecho) para que sea exactamente el logo: su baldosa
 * clara con las esquinas redondeadas y la estrella con el degradado cian → violeta. Lo único
 * que cambia es a qué tamaño se enseña.
 *
 * Lo usan la barra superior, el menú del móvil y el botón del chat, así que la marca es la misma
 * en todo el producto. Las cuentas de CLIENTE con su propio logo siguen viendo el suyo. */

interface Props {
  /** Lado en píxeles. */
  size?: number;
  className?: string;
}

export function SparkMark({ size = 32, className }: Props) {
  return (
    <img
      src={spark}
      alt="OnePulso"
      width={size}
      height={size}
      draggable={false}
      className={cn("block shrink-0 select-none object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}

export default SparkMark;

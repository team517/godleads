import { cn } from "@/lib/utils";
import tile from "@/assets/onepulso-spark-tile.png";
import star from "@/assets/onepulso-spark-star.png";

/* La marca de OnePulso, sacada del archivo que pasó el propietario (src/assets/onepulso-spark.png).
 *
 * Dos versiones, las dos con fondo transparente y a tamaño de pantalla (el original era un
 * cuadrado blanco de 1254 px y 190 KB que se veía como una caja blanca en la barra morada):
 *  · "tile": la baldosa clara con las esquinas redondeadas y la estrella. Para los sitios donde la
 *    marca va como icono de app (botón del chat, pantallas vacías, PulseBot). 320 px, 49 KB.
 *  · "star": sólo la estrella con su degradado cian → violeta, sin baldosa. Para ir junto al
 *    nombre (barra superior, menú del móvil). 128 px, 10 KB.
 * Las cuentas de CLIENTE con su propio logo siguen viendo el suyo. */

interface Props {
  /** Lado en píxeles. */
  size?: number;
  /** "tile" (por defecto) = icono con baldosa; "star" = sólo la estrella, sin fondo. */
  variant?: "tile" | "star";
  className?: string;
}

export function SparkMark({ size = 32, variant = "tile", className }: Props) {
  return (
    <img
      src={variant === "star" ? star : tile}
      alt="OnePulso"
      width={size}
      height={size}
      draggable={false}
      decoding="async"
      className={cn("block shrink-0 select-none object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}

export default SparkMark;

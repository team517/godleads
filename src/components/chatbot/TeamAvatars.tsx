import team1 from "@/assets/team/team-1.jpg";
import team2 from "@/assets/team/team-2.jpg";
import team3 from "@/assets/team/team-3.jpg";
import { cn } from "@/lib/utils";

/* Las personas reales del equipo (fotos del diseño de Funnyleads). Sustituyen a la marca en el
   chat cuando se está hablando con el equipo, no con la IA (10-11-2026). */
export const TEAM_PHOTOS = [team1, team2, team3];

/** Pila de tres fotos superpuestas. `size` = lado de cada foto en px. */
export function TeamAvatars({ size = 32, className }: { size?: number; className?: string }) {
  const overlap = Math.round(size * 0.38);
  // Ancho real de la pila: tres fotos menos los dos solapes. Antes se reservaba menos y las fotos
  // se salían por encima del nombre de la cabecera (10-11-2026).
  const width = size * TEAM_PHOTOS.length - overlap * (TEAM_PHOTOS.length - 1);
  return (
    <div className={cn("flex shrink-0 items-center", className)} style={{ width, minWidth: width }} aria-label="Equipo de Funnyleads" role="img">
      {TEAM_PHOTOS.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          width={size}
          height={size}
          draggable={false}
          className="rounded-full border-2 border-card object-cover shadow-sm"
          style={{ width: size, height: size, marginLeft: i === 0 ? 0 : -overlap, zIndex: 3 - i }}
        />
      ))}
    </div>
  );
}

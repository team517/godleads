import { cn } from "@/lib/utils";

interface WordmarkProps {
  className?: string;
  /** Clase de color de Tailwind: el nombre se pinta con currentColor. p. ej. "text-primary", "text-white" */
  colorClassName?: string;
}

/**
 * Marca "Funnyleads" (10-11-2026), calcada de la cabecera del diseño de la landing: Schibsted Grotesk
 * 600 con tracking negativo. Es un SVG con el texto ajustado a un ancho fijo (textLength), así que
 * escala con la ALTURA que le dé `className` (h-5, h-8…) igual que el logo de imagen anterior, y el
 * color sale de `colorClassName` (currentColor).
 */
export function Wordmark({ className, colorClassName = "text-primary" }: WordmarkProps) {
  return (
    <svg
      role="img"
      aria-label="Funnyleads"
      viewBox="0 0 560 120"
      className={cn("inline-block w-auto align-middle", colorClassName, className)}
      style={{ aspectRatio: "560 / 120" }}
    >
      <text
        x="0"
        y="90"
        fill="currentColor"
        textLength="556"
        lengthAdjust="spacingAndGlyphs"
        style={{ fontFamily: "'Schibsted Grotesk', Inter, system-ui, sans-serif", fontWeight: 600, fontSize: 112, letterSpacing: "-0.03em" }}
      >
        Funnyleads
      </text>
    </svg>
  );
}

import { cn } from "@/lib/utils";

/* Marca doble agencia × cliente (12-11-2026): en la cuenta de un cliente, arriba sale el logo de
   la agencia y al lado el del cliente. Sin logo, la inicial en su color. Se usa en la barra
   superior, en el menú del móvil, en la bienvenida y en la vista previa de /clientes. */

export const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface BrandSide {
  name: string;
  logo: string | null;
  color: string | null;
}

export function initialOf(name: string): string {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

/** Un logo: dentro de una pastilla blanca, o la inicial en su color si no hay logo. */
export function BrandChip({
  side,
  size = "bar",
  showName = false,
  nameClassName,
}: {
  side: BrandSide;
  size?: "bar" | "hero" | "mini";
  showName?: boolean;
  nameClassName?: string;
}) {
  const color = side.color && HEX6.test(side.color) ? side.color : "#6E58F1";
  const box = size === "hero" ? "h-[72px] min-w-[72px] rounded-[20px] px-3" : size === "mini" ? "h-7 min-w-7 rounded-md px-1.5" : "h-8 min-w-8 rounded-lg px-2";
  const img = size === "hero" ? "h-11 max-w-[150px]" : size === "mini" ? "h-[18px] max-w-[80px]" : "h-5 max-w-[104px]";
  const letter = size === "hero" ? "text-[28px]" : size === "mini" ? "text-[12px]" : "text-[14px]";
  return (
    <span className="flex min-w-0 items-center gap-2">
      {side.logo ? (
        <span className={cn("flex shrink-0 items-center justify-center bg-white shadow-[0_1px_3px_rgba(16,24,64,.12)]", box)}>
          <img src={side.logo} alt={side.name} className={cn("object-contain", img)} />
        </span>
      ) : (
        <span
          className={cn("flex shrink-0 items-center justify-center font-bold text-white shadow-[0_1px_3px_rgba(16,24,64,.18)] ring-1 ring-white/30", box, letter)}
          style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
          aria-label={side.name}
        >
          {initialOf(side.name)}
        </span>
      )}
      {showName && <span className={cn("truncate font-semibold", nameClassName)}>{side.name}</span>}
    </span>
  );
}

/** Agencia × cliente, en una línea. */
export function CoBrand({
  agency,
  client,
  size = "bar",
  tone = "light",
  className,
}: {
  agency: BrandSide | null;
  client: BrandSide;
  size?: "bar" | "hero" | "mini";
  /** "light": sobre fondo oscuro (barra superior), el aspa en blanco. "dark": sobre fondo claro. */
  tone?: "light" | "dark";
  className?: string;
}) {
  const x = size === "hero" ? "text-[22px]" : "text-[13px]";
  return (
    <span className={cn("flex min-w-0 items-center", size === "hero" ? "gap-4" : "gap-2", className)} data-cobrand="">
      {agency && (
        <>
          <BrandChip side={agency} size={size} />
          <span aria-hidden="true" className={cn("shrink-0 font-light leading-none", x, tone === "light" ? "text-white/55" : "text-[#9aa1c4]")}>×</span>
        </>
      )}
      <BrandChip
        // Cliente sin color propio: su inicial con el color de la agencia, nunca el violeta de Funnyleads.
        side={client.color || !agency?.color ? client : { ...client, color: agency.color }}
        size={size}
        showName={size === "bar" && !client.logo}
        nameClassName={cn("hidden max-w-[160px] text-[15px] sm:inline", tone === "light" ? "text-white" : "text-[#0b1040]")}
      />
    </span>
  );
}

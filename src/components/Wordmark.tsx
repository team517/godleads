import { cn } from "@/lib/utils";
import wordmark from "@/assets/onepulso-wordmark-black.png";

interface WordmarkProps {
  className?: string;
  /** Tailwind text-color class controls the wordmark color via mask. e.g. "text-primary", "text-white" */
  colorClassName?: string;
}

/**
 * onepulso wordmark rendered as a CSS mask so its color follows the design system.
 * Use the standard `text-*` utility (via colorClassName) to tint it.
 */
export function Wordmark({ className, colorClassName = "text-primary" }: WordmarkProps) {
  return (
    <span
      role="img"
      aria-label="onepulso"
      className={cn("inline-block bg-current align-middle", colorClassName, className)}
      style={{
        aspectRatio: "1572 / 430",
        WebkitMaskImage: `url(${wordmark})`,
        maskImage: `url(${wordmark})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

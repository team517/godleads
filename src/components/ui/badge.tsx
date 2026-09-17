import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // Etiqueta del diseño: pastilla, 11.5px y peso 600.
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-accent text-accent-foreground hover:bg-accent/70",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-accent dark:hover:bg-accent",
        /** Selected / active chip. */
        active: "border-transparent bg-accent text-accent-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(({ className, variant, ...props }, ref) => {
  return <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
});
Badge.displayName = "Badge";

export { Badge, badgeVariants };

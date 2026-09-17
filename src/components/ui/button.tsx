import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Diseño "Primary": radio 6px, peso 600, alturas contenidas (DESIGN.md).
  // Responde al dedo: sube la sombra al pasar y se hunde un 2% al pulsar (como un botón de verdad).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold ring-offset-background transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-btn hover:bg-primary-hover hover:shadow-btn-hover",
        destructive: "bg-destructive text-destructive-foreground shadow-rest hover:bg-destructive/90",
        outline: "border border-[#D4D0E2] dark:border-border bg-card text-secondary-foreground rounded-md shadow-rest hover:border-primary hover:text-primary hover:bg-card",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary dark:hover:bg-accent",
        ghost: "text-primary hover:bg-secondary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-[18px] py-2 text-[15px]",
        sm: "h-9 px-4 text-sm",
        lg: "h-12 px-[26px] text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

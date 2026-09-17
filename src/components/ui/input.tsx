import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // House system: #fcfbff field, #e7e2f5 border, 13px radius, light text,
          // purple focus ring (no outline).
          "flex h-10 w-full rounded-md border border-border bg-[#FBFAFF] text-foreground dark:bg-secondary px-4 py-2 text-base font-normal ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground transition-[border-color,box-shadow,background-color] duration-150 hover:border-[#D4D0E2] dark:hover:border-border focus-visible:outline-none focus-visible:border-[#8B6BFF] focus-visible:bg-card focus-visible:ring-4 focus-visible:ring-[#8B6BFF]/15 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

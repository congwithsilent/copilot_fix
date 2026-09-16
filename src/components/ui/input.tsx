import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "!tw-h-9 !tw-min-w-[50px] !tw-rounded-md !tw-bg-modifier-form-field !tw-px-3 !tw-py-1 !tw-text-sm !tw-transition-colors md:!tw-text-base",
          "focus-visible:!tw-bg-modifier-hover focus-visible:!tw-outline-none",
          "placeholder:tw-text-sm",
          "tw-flex tw-w-full placeholder:tw-text-muted disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };

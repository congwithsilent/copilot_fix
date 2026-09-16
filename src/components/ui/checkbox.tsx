import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "!tw-bg-secondary-alt tw-p-0 tw-transition-colors", // custom styles
      "hover:!tw-bg-interactive-accent hover:!tw-text-on-accent data-[state=checked]:!tw-bg-interactive-accent data-[state=checked]:!tw-text-on-accent", // custom styles
      "tw-peer tw-size-4 tw-shrink-0 tw-rounded-sm focus-visible:tw-outline-none disabled:tw-cursor-not-allowed disabled:tw-opacity-50",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("tw-flex tw-items-center tw-justify-center tw-text-current")}
    >
      <Check className="tw-size-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

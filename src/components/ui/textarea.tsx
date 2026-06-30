import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border border-input/75 bg-card/80 px-3 py-2.5 text-base leading-6 text-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.10)] ring-offset-background transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/75 focus-visible:border-foreground/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-card/90 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }

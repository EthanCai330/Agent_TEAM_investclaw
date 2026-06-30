/* eslint-disable react-refresh/only-export-components */
/**
 * Badge Component
 * Based on shadcn/ui badge
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-[0.01em] transition-colors focus:outline-none focus:ring-2 focus:ring-ring/30 focus:ring-offset-0',
  {
    variants: {
      variant: {
        default:
          'border-border/70 bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.09]',
        secondary:
          'border-border/55 bg-secondary/70 text-secondary-foreground hover:bg-secondary/85',
        destructive:
          'border-destructive/25 bg-destructive/[0.12] text-destructive hover:bg-destructive/[0.18] dark:text-red-100',
        outline: 'border-border/70 text-foreground',
        success:
          'border-emerald-500/20 bg-emerald-500/12 text-emerald-700 dark:text-emerald-200',
        warning:
          'border-amber-500/20 bg-amber-500/14 text-amber-700 dark:text-amber-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

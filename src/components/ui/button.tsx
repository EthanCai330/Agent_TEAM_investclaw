/* eslint-disable react-refresh/only-export-components */
/**
 * Button Component
 * Based on shadcn/ui button
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium tracking-[-0.01em] ring-offset-background transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0 active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border border-primary bg-primary text-primary-foreground shadow-[0_8px_18px_-14px_hsl(var(--foreground)/0.55)] hover:bg-primary/92 hover:shadow-[0_10px_22px_-14px_hsl(var(--foreground)/0.48)]',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-border/70 bg-card/[0.72] shadow-[0_8px_18px_-18px_hsl(var(--foreground)/0.35)] hover:border-border hover:bg-card hover:text-foreground hover:shadow-[0_10px_22px_-16px_hsl(var(--foreground)/0.30)]',
        secondary:
          'border border-border/45 bg-secondary/75 text-secondary-foreground hover:bg-secondary hover:shadow-[0_8px_18px_-16px_hsl(var(--foreground)/0.26)]',
        ghost: 'hover:bg-transparent hover:text-foreground hover:shadow-[0_8px_18px_-16px_hsl(var(--foreground)/0.24)]',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3.5 py-2',
        sm: 'h-8 rounded-lg px-3',
        lg: 'h-10 rounded-xl px-5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };

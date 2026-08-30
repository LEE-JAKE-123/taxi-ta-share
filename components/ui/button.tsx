import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button inline-flex min-h-11 shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap outline-none select-none transition-[transform,background-color,border-color,color] duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 aria-busy:pointer-events-none aria-busy:opacity-70 aria-invalid:border-destructive aria-invalid:outline-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'rounded-[14px] bg-primary text-primary-foreground hover:bg-action-focus active:not-aria-[haspopup]:scale-[0.98]',
        secondary:
          'rounded-[14px] border-hairline bg-surface text-ink hover:bg-surface-subtle aria-expanded:bg-surface-subtle',
        dark: 'rounded-[14px] bg-surface-dark text-white hover:bg-surface-black',
        ghost:
          'rounded-[14px] hover:bg-surface-subtle hover:text-ink aria-expanded:bg-surface-subtle',
        destructive: 'rounded-[14px] bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-destructive',
      },
      size: {
        default:
          'h-12 gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4',
        xs: "h-11 gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1 px-3.5 text-[0.8rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-12 gap-2 px-6 text-base',
        icon: 'size-12 rounded-[14px]',
        'icon-xs': "size-11 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-11',
        'icon-lg': 'size-12',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'primary',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

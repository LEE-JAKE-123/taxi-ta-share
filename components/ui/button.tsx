import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "group/button inline-flex min-h-11 shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-normal whitespace-nowrap outline-none select-none transition-[transform,background-color,border-color,color] duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 aria-busy:pointer-events-none aria-busy:opacity-70 aria-invalid:border-destructive aria-invalid:outline-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'rounded-full bg-action text-primary-foreground hover:bg-action/90',
        secondary:
          'rounded-[11px] border-hairline bg-canvas text-ink hover:bg-canvas-parchment aria-expanded:bg-canvas-parchment',
        dark: 'rounded-lg bg-surface-dark text-white hover:bg-surface-black',
        outline:
          'rounded-[11px] border-hairline bg-canvas text-ink hover:bg-canvas-parchment aria-expanded:bg-canvas-parchment',
        ghost:
          'rounded-[11px] hover:bg-canvas-parchment hover:text-ink aria-expanded:bg-canvas-parchment',
        destructive:
          'rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:outline-destructive',
        link: 'min-h-0 rounded-none text-action underline-offset-4 hover:underline',
        default: 'rounded-full bg-action text-primary-foreground hover:bg-action/90',
        utility: 'rounded-lg bg-surface-dark text-white hover:bg-surface-black',
      },
      size: {
        default:
          'h-11 gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4',
        xs: "h-11 gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1 px-3.5 text-[0.8rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-12 gap-2 px-6 text-base',
        icon: 'size-11',
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
  variant = 'default',
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

import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const cardVariants = cva('rounded-[18px] p-5', {
  variants: {
    variant: {
      flat: 'bg-card text-card-foreground',
      hairline: 'border border-hairline bg-card text-card-foreground',
      parchment: 'bg-canvas-parchment text-ink',
      dark: 'bg-surface-dark text-white',
    },
  },
  defaultVariants: {
    variant: 'hairline',
  },
})

export function Card({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof cardVariants>) {
  return (
    <div
      className={cn(
        cardVariants({ variant }),
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({
  className,
  ...props
}: React.ComponentProps<'h3'>) {
  return (
    <h3
      className={cn('text-[21px] font-semibold leading-[1.25] tracking-[-0.012em] text-inherit', className)}
      {...props}
    />
  )
}

export { cardVariants }

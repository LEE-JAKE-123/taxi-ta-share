import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const cardVariants = cva('rounded-[18px] p-5', {
  variants: {
    variant: {
      surface: 'border border-hairline bg-surface text-card-foreground',
      subtle: 'bg-surface-subtle text-ink',
      selected: 'border border-primary bg-brand-soft text-ink',
      dark: 'bg-surface-dark text-white',
      interactive: 'border border-hairline bg-surface text-card-foreground transition-colors hover:border-primary/50 hover:bg-surface-subtle',
    },
  },
  defaultVariants: {
    variant: 'surface',
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

import { cn } from '@/lib/utils'
import { avatarColor } from '@/lib/mock-data'

export function Avatar({
  name,
  index = 0,
  size = 'md',
  className,
}: {
  name: string
  index?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizeCls =
    size === 'lg' ? 'size-12 text-base' : size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm'
  const colorClass = avatarColor(index)
  const foregroundClass =
    colorClass === 'bg-accent' ? 'text-brand-strong' : 'text-primary-foreground'
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold ring-2 ring-card',
        colorClass,
        foregroundClass,
        sizeCls,
        className,
      )}
      aria-hidden
    >
      {name.slice(0, 1)}
    </span>
  )
}

export function AvatarStack({
  names,
  max,
}: {
  names: string[]
  max: number
}) {
  const empty = Math.max(max - names.length, 0)
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {names.map((n, i) => (
          <Avatar key={i} name={n} index={i} size="sm" />
        ))}
        {Array.from({ length: empty }).map((_, i) => (
          <span
            key={`e${i}`}
            className="inline-flex size-8 items-center justify-center rounded-full border border-dashed border-border bg-muted text-xs text-muted-foreground ring-2 ring-card"
            aria-hidden
          >
            +
          </span>
        ))}
      </div>
      <span className="ml-2 text-xs font-semibold text-muted-foreground">
        {names.length}/{max}명
      </span>
    </div>
  )
}

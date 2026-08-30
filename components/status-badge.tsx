import { cn } from '@/lib/utils'

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'
type Kind = 'status' | 'emphasis'

const variantStyles: Record<BadgeVariant, string> = {
  neutral: 'border-hairline bg-surface-subtle text-ink-secondary',
  brand: 'border-brand/20 bg-brand-soft text-brand-strong',
  success: 'border-success/20 bg-success-soft text-success',
  warning: 'border-warning/20 bg-warning-soft text-warning',
  danger: 'border-danger/20 bg-danger-soft text-danger',
}
const variantLabels: Record<BadgeVariant, string> = {
  neutral: '일반 상태',
  brand: '주요 상태',
  success: '완료 상태',
  warning: '주의 상태',
  danger: '위험 상태',
}

export function StatusBadge({
  children,
  label,
  helper,
  variant = 'neutral',
  kind = 'status',
  className,
  icon: Icon,
}: {
  /** `children` is retained as the visible label for existing screens. */
  children?: React.ReactNode
  /** Prefer this named label for new status badges. */
  label?: React.ReactNode
  /** Optional supporting detail; it is announced with the status label. */
  helper?: React.ReactNode
  variant?: BadgeVariant
  kind?: Kind
  className?: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  const statusLabel = variantLabels[variant]
  const visibleLabel = label ?? children ?? statusLabel

  return (
    <span
      role={kind === 'status' ? 'status' : undefined}
      data-variant={variant}
      className={cn(
        'inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[-0.01em]',
        variantStyles[variant],
        className,
      )}
    >
      {kind === 'status' ? <span className="sr-only">{statusLabel}: </span> : null}
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
      <span>{visibleLabel}</span>
      {helper ? <span className="text-[11px] font-normal opacity-80">· {helper}</span> : null}
    </span>
  )
}

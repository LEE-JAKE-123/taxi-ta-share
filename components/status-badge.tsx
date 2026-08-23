import { cn } from '@/lib/utils'

type Tone = 'brand' | 'mint' | 'info' | 'warn' | 'muted'
type Kind = 'status' | 'emphasis'

const toneStyles: Record<Tone, string> = {
  brand: 'border-brand/20 bg-brand-soft text-brand-strong',
  mint: 'border-success/20 bg-success-soft text-success',
  info: 'border-info/20 bg-info-soft text-info',
  warn: 'border-warning/20 bg-warning-soft text-warning',
  muted: 'border-hairline bg-surface-subtle text-ink-secondary',
}
const toneLabels: Record<Tone, string> = {
  brand: '주요 상태',
  mint: '완료 상태',
  info: '안내 상태',
  warn: '주의 상태',
  muted: '일반 상태',
}

export function StatusBadge({
  children,
  label,
  helper,
  tone = 'muted',
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
  tone?: Tone
  kind?: Kind
  className?: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  const visibleLabel = label ?? children ?? toneLabels[tone]

  return (
    <span
      role={kind === 'status' ? 'status' : undefined}
      className={cn(
        'inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[-0.01em]',
        toneStyles[tone],
        className,
      )}
    >
      {kind === 'status' ? <span className="sr-only">{toneLabels[tone]}: </span> : null}
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
      <span>{visibleLabel}</span>
      {helper ? <span className="text-[11px] font-normal opacity-80">· {helper}</span> : null}
    </span>
  )
}

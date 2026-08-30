'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

export function TopBar({
  title,
  subtitle,
  back = true,
  backHref = '/home',
  onBack,
  right,
  className,
}: {
  title: string
  subtitle?: string
  back?: boolean
  backHref?: string
  onBack?: () => void
  right?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex min-h-[60px] items-center gap-2 border-b border-hairline bg-canvas px-5 py-2',
        className,
      )}
    >
      {back ? (
        onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="뒤로 가기"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'shrink-0')}
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : (
          <Link
            href={backHref}
            aria-label="뒤로 가기"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'shrink-0')}
          >
            <ChevronLeft className="size-5" />
          </Link>
        )
      ) : (
        <span className="w-1" />
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
    </header>
  )
}

'use client'

import { useFormStatus } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function PendingSubmitButton({
  children,
  pendingLabel,
  className,
  disabled,
  ariaLabel,
}: {
  children: React.ReactNode
  pendingLabel: string
  className?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-[17px] font-normal text-primary-foreground transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100',
        className,
      )}
    >
      {pending ? (
        <>
          <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
          <span>{pendingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}

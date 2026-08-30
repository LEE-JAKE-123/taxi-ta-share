'use client'

import { useFormStatus } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

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
    <Button
      type="submit"
      variant="primary"
      size="lg"
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      aria-label={ariaLabel}
      className={cn(
        'w-full',
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
    </Button>
  )
}

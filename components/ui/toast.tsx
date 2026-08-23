'use client'

import { CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ToastItem {
  id: number
  message: string
  tone: 'default' | 'success' | 'warn'
}

const toneStyles: Record<ToastItem['tone'], string> = {
  default: 'bg-foreground text-background',
  success: 'bg-foreground text-background',
  warn: 'border-warn/30 bg-warn-soft text-warn',
}

const toneIcon = {
  default: Info,
  success: CheckCircle2,
  warn: TriangleAlert,
}

export function Toaster({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] mx-auto flex w-full max-w-[430px] flex-col items-center gap-2 px-4">
      {toasts.map((t) => {
        const Icon = toneIcon[t.tone]
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-normal animate-in fade-in slide-in-from-top-2',
              toneStyles[t.tone],
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span>{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}

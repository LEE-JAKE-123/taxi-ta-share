import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/** 화면 하단에 고정되는 CTA 영역 (모바일 프레임 폭 기준) */
export function BottomBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[1280px]">
      <div
        className={cn(
          'safe-area-bottom-4 border-t border-hairline bg-surface px-5 pt-3 shadow-[0_12px_32px_rgba(18,35,29,0.12)]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function BigButton({
  className,
  variant = 'primary',
  size = 'lg',
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn('w-full', className)}
      variant={variant}
      size={size}
      {...props}
    />
  )
}

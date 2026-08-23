import { cn } from '@/lib/utils'

/** 화면 하단에 고정되는 CTA 영역 (모바일 프레임 폭 기준) */
export function BottomBar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[1068px]">
      <div
        className={cn(
          'border-t border-hairline bg-canvas/80 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3 backdrop-blur-xl backdrop-saturate-150',
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
  tone = 'primary',
  ...props
}: React.ComponentProps<'button'> & {
  tone?: 'primary' | 'secondary' | 'dark' | 'destructive' | 'foreground' | 'warn' | 'mint' | 'outline'
}) {
  const tones = {
    primary: 'rounded-full bg-action text-primary-foreground hover:bg-action/90',
    secondary: 'rounded-[11px] border border-hairline bg-canvas text-ink hover:bg-canvas-parchment',
    dark: 'rounded-lg bg-surface-dark text-white hover:bg-surface-black',
    destructive: 'rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90',
    foreground: 'rounded-lg bg-surface-dark text-white hover:bg-surface-black',
    warn: 'rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90',
    mint: 'rounded-full bg-action text-primary-foreground hover:bg-action/90',
    outline: 'rounded-[11px] border border-hairline bg-canvas text-ink hover:bg-canvas-parchment',
  }
  return (
    <button
      className={cn(
        'flex min-h-12 w-full items-center justify-center gap-2 px-6 py-3 text-[17px] font-normal outline-none transition-[transform,background-color,border-color,color] duration-150 motion-reduce:transition-none active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}

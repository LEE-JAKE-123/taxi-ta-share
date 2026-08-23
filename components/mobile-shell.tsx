import { cn } from '@/lib/utils'

/**
 * 중앙 정렬된 모바일 앱 프레임. iPhone 폭 기준(최대 430px)으로
 * 데스크톱에서도 모바일 앱 느낌을 유지한다.
 */
export function MobileShell({
  children,
  className,
  withTabBar = true,
}: {
  children: React.ReactNode
  className?: string
  withTabBar?: boolean
}) {
  return (
    <div className="flex min-h-dvh justify-center bg-canvas lg:px-8">
      <div className="relative flex w-full max-w-[1280px] flex-col bg-background lg:border-x lg:border-hairline">
        <div
          className={cn(
            'flex min-h-dvh flex-col',
            withTabBar && 'pb-24',
            className,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

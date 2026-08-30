import { MobileShell } from '@/components/mobile-shell'
import { TopBar } from '@/components/top-bar'
import { Card } from '@/components/ui/card'

export default function AdminReportsLoading() {
  const label = '신고와 고객 문의를 불러오는 중입니다.'

  return (
    <MobileShell withTabBar={false}>
      <TopBar title="신고 및 고객 문의" backHref="/admin" />
      <main
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5 sm:px-5 sm:py-6 lg:px-6"
        role="status"
        aria-live="polite"
        aria-label={label}
      >
        <span className="sr-only">{label}</span>
        <Card variant="subtle" className="border border-hairline p-5">
          <div className="h-4 w-3/4 rounded bg-hairline motion-safe:animate-pulse" />
          <div className="mt-3 h-4 w-full rounded bg-hairline motion-safe:animate-pulse" />
        </Card>
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="space-y-4 p-5" aria-hidden="true">
            <div className="h-5 w-2/5 rounded bg-surface-subtle motion-safe:animate-pulse" />
            <div className="h-4 w-full rounded bg-surface-subtle motion-safe:animate-pulse" />
            <div className="h-20 w-full rounded-[14px] bg-surface-subtle motion-safe:animate-pulse" />
          </Card>
        ))}
      </main>
    </MobileShell>
  )
}

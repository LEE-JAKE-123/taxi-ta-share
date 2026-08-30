import { MobileShell } from '@/components/mobile-shell'
import { TopBar } from '@/components/top-bar'
import { Card } from '@/components/ui/card'

export function AdminReadPage({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <MobileShell withTabBar={false}>
      <TopBar title={title} backHref="/admin" />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5 sm:px-5 sm:py-6 lg:px-6">
        <Card variant="subtle" className="border border-hairline px-5 py-4">
          <p className="text-sm leading-relaxed text-ink-secondary">
            {description}
          </p>
        </Card>
        {children}
      </main>
    </MobileShell>
  )
}

export function DeferredAdminAction({ label }: { label: string }) {
  return (
    <Card variant="subtle" className="border border-hairline p-4">
      <p className="font-semibold text-ink">{label}</p>
      <p className="mt-1 text-sm text-ink-secondary">
        시연에서는 조회만 제공합니다. 감사 로그와 승인 정책 확정 후 변경 기능을
        연결합니다.
      </p>
    </Card>
  )
}

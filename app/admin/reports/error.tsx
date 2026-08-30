'use client'

import { CircleAlert, RotateCcw } from 'lucide-react'
import { MobileShell } from '@/components/mobile-shell'
import { TopBar } from '@/components/top-bar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function AdminReportsError({ reset }: { reset: () => void }) {
  return (
    <MobileShell withTabBar={false}>
      <TopBar title="신고 및 고객 문의" backHref="/admin" />
      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-5 sm:py-12 lg:px-6">
        <Card className="w-full p-6 text-center sm:p-8" role="alert">
          <CircleAlert className="mx-auto size-7 text-danger" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold tracking-[-0.012em] text-ink">
            신고 및 고객 문의를 불러오지 못했습니다.
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
            잠시 뒤 다시 시도해 주세요. 계속되면 관리자에게 문의해 주세요.
          </p>
          <Button type="button" onClick={reset} className="mt-6 w-full sm:w-auto">
            <RotateCcw data-icon="inline-start" className="size-4" aria-hidden="true" />
            다시 시도
          </Button>
        </Card>
      </main>
    </MobileShell>
  )
}

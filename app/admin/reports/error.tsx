'use client'

import { RouteErrorState } from '@/components/route-error-state'

export default function AdminReportsError({ reset }: { reset: () => void }) {
  return <RouteErrorState title="신고 및 고객 문의를 불러오지 못했습니다." reset={reset} />
}

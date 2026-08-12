'use client'

import { RouteErrorState } from '@/components/route-error-state'

export default function SupportError({ reset }: { reset: () => void }) {
  return <RouteErrorState title="고객 문의 화면을 불러오지 못했습니다." reset={reset} />
}

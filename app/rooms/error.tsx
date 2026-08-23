'use client'

import { RouteErrorState } from '@/components/route-error-state'

export default function RoomsError({ reset }: { reset: () => void }) {
  return <RouteErrorState title="모집 방을 불러오지 못했습니다." reset={reset} />
}

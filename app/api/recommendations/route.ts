import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// This legacy endpoint returned recommendation claims without writing the
// required candidate/FareEstimate evidence. Keep it explicitly unavailable
// until it is replaced by the traced recommendation service.
export async function POST() {
  return NextResponse.json(
    {
      error:
        '장소 검색 기반 추천은 근거 저장 경로로 전환 중입니다. 현재는 홈의 저장된 모집 근거 추천을 이용해 주세요.',
    },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}

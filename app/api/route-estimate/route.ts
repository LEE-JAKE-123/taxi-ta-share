import { NextResponse } from 'next/server'
import { getCurrentUser, hasCompleteProfile } from '@/lib/auth/session'
import { estimateRoute } from '@/lib/routing'
import {
  routingErrorMessage,
  routingRetryAfter,
  routingErrorStatus,
} from '@/lib/routing/response'
import { parseRouteEstimateRequest } from '@/lib/routing/validation'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user || !hasCompleteProfile(user)) {
    return NextResponse.json(
      { error: '로그인이 필요합니다.' },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 },
    )
  }

  const parsed = parseRouteEstimateRequest(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '출발지와 목적지 좌표를 확인해 주세요.' },
      { status: 400 },
    )
  }

  try {
    const evidence = await estimateRoute(
      parsed.data.origin,
      parsed.data.destination,
    )
    const estimate = {
      provider: evidence.provider,
      distanceMeters: evidence.distanceMeters,
      durationSeconds: evidence.durationSeconds,
      estimatedFareWon: evidence.estimatedFareWon,
      calculatedAt: evidence.calculatedAt,
      expiresAt: evidence.expiresAt,
      ...(evidence.geometry ? { geometry: evidence.geometry } : {}),
    }
    return NextResponse.json(
      { estimate },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const retryAfter = routingRetryAfter(error)
    return NextResponse.json(
      { error: routingErrorMessage(error) },
      {
        status: routingErrorStatus(error),
        headers: retryAfter === undefined ? undefined : {
          'Retry-After': String(retryAfter),
        },
      },
    )
  }
}

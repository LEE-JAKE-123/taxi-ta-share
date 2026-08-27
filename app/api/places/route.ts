import { NextResponse } from 'next/server'
import { getCurrentUser, hasCompleteProfile } from '@/lib/auth/session'
import { searchPlaces } from '@/lib/routing'
import {
  routingErrorMessage,
  routingRetryAfter,
  routingErrorStatus,
} from '@/lib/routing/response'
import { parsePlaceQuery } from '@/lib/routing/validation'
import { issuePlaceSelectionToken } from '@/lib/routing/place-token'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user || !hasCompleteProfile(user)) {
    return NextResponse.json(
      { error: '로그인이 필요합니다.' },
      { status: 401 },
    )
  }

  const parsed = parsePlaceQuery(new URL(request.url).searchParams.get('q'))
  if (!parsed.success) {
    return NextResponse.json(
      { error: '장소명은 공백을 제외하고 1~100자로 입력해 주세요.' },
      { status: 400 },
    )
  }

  try {
    const results = await searchPlaces(parsed.data)
    const places = results.map((place) => ({
      ...place,
      selectionToken: issuePlaceSelectionToken(place, user.userId),
    }))
    return NextResponse.json(
      { places },
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

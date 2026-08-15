import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { processDueTransitions } from '@/lib/core/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')
  if (!secret || !authorization) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(authorization)
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return NextResponse.json(await processDueTransitions())
  } catch (error) {
    console.error('Due transition processor failed.', {
      code:
        typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : undefined,
      message: error instanceof Error ? error.message : undefined,
    })
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

import { RoutingError } from './errors'

const REQUEST_TIMEOUT_MS = 8_000

function retryAfterSeconds(value: string | null, now = Date.now()) {
  if (!value) return undefined

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds), 3_600)
  }

  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return undefined
  return Math.min(Math.max(0, Math.ceil((retryAt - now) / 1_000)), 3_600)
}

export async function fetchJson(
  url: URL | string,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      throw new RoutingError(
        'TIMEOUT',
        '지도 공급자 응답 시간이 초과되었습니다.',
        true,
      )
    }
    throw new RoutingError(
      'UPSTREAM_FAILURE',
      '지도 공급자에 연결하지 못했습니다.',
      true,
    )
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RoutingError(
        'NOT_CONFIGURED',
        '지도 공급자 인증 정보 또는 사용 권한이 올바르지 않습니다.',
      )
    }
    if (response.status === 404) {
      throw new RoutingError('NOT_FOUND', '지도 검색 또는 경로 결과가 없습니다.')
    }
    if (response.status === 408 || response.status === 504) {
      throw new RoutingError(
        'TIMEOUT',
        '지도 공급자 응답 시간이 초과되었습니다.',
        true,
      )
    }
    if (response.status === 429) {
      throw new RoutingError(
        'RATE_LIMITED',
        '지도 공급자 요청 한도를 초과했습니다.',
        true,
        retryAfterSeconds(response.headers.get('retry-after')),
      )
    }
    throw new RoutingError(
      'UPSTREAM_FAILURE',
      '지도 공급자 요청을 처리하지 못했습니다.',
      response.status >= 500,
    )
  }

  try {
    return await response.json()
  } catch {
    throw new RoutingError(
      'MALFORMED_RESPONSE',
      '지도 공급자 응답 형식이 올바르지 않습니다.',
    )
  }
}

import { RoutingError } from './errors'

export function routingErrorStatus(error: unknown) {
  if (!(error instanceof RoutingError)) return 502
  if (error.code === 'INVALID_INPUT') return 400
  if (error.code === 'NOT_FOUND') return 404
  if (error.code === 'NOT_CONFIGURED') return 503
  if (error.code === 'RATE_LIMITED') return 429
  return 502
}

export function routingRetryAfter(error: unknown) {
  if (!(error instanceof RoutingError) || error.code !== 'RATE_LIMITED') {
    return undefined
  }
  return error.retryAfterSeconds
}

export function routingErrorMessage(error: unknown) {
  if (!(error instanceof RoutingError)) {
    return '지도 요청을 처리하지 못했습니다.'
  }
  if (error.code === 'NOT_CONFIGURED') {
    return '지도 API가 아직 설정되지 않았습니다.'
  }
  if (error.code === 'NOT_FOUND') {
    return error.message
  }
  if (error.code === 'INVALID_INPUT') {
    return '입력값을 확인해 주세요.'
  }
  return '지도 공급자 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

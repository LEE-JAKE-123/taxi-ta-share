import { RoutingError } from './errors'

export type ProviderSetting = 'naver' | 'kakao' | 'auto'

export function getProviderSetting(): ProviderSetting {
  const value = process.env.MAP_PROVIDER?.trim().toLowerCase() || 'kakao'
  if (value === 'naver' || value === 'kakao' || value === 'auto') {
    return value
  }

  throw new RoutingError(
    'NOT_CONFIGURED',
    'MAP_PROVIDER 설정이 올바르지 않습니다.',
  )
}

import { afterEach, describe, expect, it } from 'vitest'
import { getProviderSetting } from './provider-setting'

const originalProvider = process.env.MAP_PROVIDER

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.MAP_PROVIDER
  } else {
    process.env.MAP_PROVIDER = originalProvider
  }
})

describe('routing provider selection', () => {
  it.each([undefined, '  '])(
    'defaults to Kakao when a deployment provider is %s',
    (provider) => {
      if (provider === undefined) {
        delete process.env.MAP_PROVIDER
      } else {
        process.env.MAP_PROVIDER = provider
      }

      expect(getProviderSetting()).toBe('kakao')
    },
  )

  it('keeps an explicit provider setting for transition verification', () => {
    process.env.MAP_PROVIDER = 'naver'

    expect(getProviderSetting()).toBe('naver')
  })

  it('rejects an unsupported provider value', () => {
    process.env.MAP_PROVIDER = 'unsupported'

    expect(() => getProviderSetting()).toThrow('MAP_PROVIDER')
  })
})

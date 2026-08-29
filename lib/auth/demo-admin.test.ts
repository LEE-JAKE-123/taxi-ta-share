import { describe, expect, it } from 'vitest'
import { isDemoAdminLoginAllowed } from './demo-admin'

const demoAdmin = {
  studentId: '123456789',
  name: '택시타쉐어관리자',
  enabled: 'true',
}

describe('isDemoAdminLoginAllowed', () => {
  it.each(['localhost:3000', '127.0.0.1:3000'])(
    'allows the exact demo identity on the loopback development host %s',
    (host) => {
      expect(
        isDemoAdminLoginAllowed({
          ...demoAdmin,
          environment: 'development',
          nodeEnvironment: 'development',
          host,
        }),
      ).toBe(true)
    },
  )

  it('allows the exact demo identity on the exact production domain', () => {
    expect(
      isDemoAdminLoginAllowed({
        ...demoAdmin,
        environment: 'production',
        nodeEnvironment: 'production',
        host: 'taxi-ta-share-phi.vercel.app',
      }),
    ).toBe(true)
  })

  it.each([
    ['development', 'development', 'localhost'],
    ['development', 'development', 'localhost:3001'],
    ['development', 'development', '127.0.0.1'],
    ['development', 'development', '127.0.0.1:3001'],
    ['development', 'development', '192.168.25.55:3000'],
    ['development', 'development', '[::1]:3000'],
    ['development', 'development', 'taxi-ta-share-phi.vercel.app'],
    ['development', 'production', 'localhost:3000'],
    ['development', undefined, '127.0.0.1:3000'],
    ['preview', 'development', 'localhost:3000'],
    ['preview', 'development', '127.0.0.1:3000'],
    ['preview', 'development', 'taxi-ta-share-phi.vercel.app'],
    ['production', 'production', 'localhost:3000'],
    ['production', 'production', '127.0.0.1:3000'],
    ['production', 'development', 'taxi-ta-share-phi.vercel.app'],
    ['production', 'production', 'preview.taxi-ta-share-phi.vercel.app'],
    ['production', 'production', 'taxi-ta-share-phi.vercel.app:443'],
    ['production', 'production', 'TAXI-TA-SHARE-PHI.VERCEL.APP'],
    [undefined, 'development', 'localhost:3000'],
    [undefined, 'production', 'taxi-ta-share-phi.vercel.app'],
    ['development', 'development', null],
  ])(
    'blocks the demo admin login for APP_ENVIRONMENT=%s, NODE_ENV=%s, and host %s',
    (environment, nodeEnvironment, host) => {
      expect(
        isDemoAdminLoginAllowed({
          ...demoAdmin,
          environment,
          nodeEnvironment,
          host,
        }),
      ).toBe(false)
    },
  )

  it.each([
    { enabled: undefined },
    { enabled: 'false' },
    { studentId: '123456788' },
    { name: '택시타쉐어관리자아님' },
  ])('requires the explicit flag and exact demo identity: %o', (override) => {
    expect(
      isDemoAdminLoginAllowed({
        ...demoAdmin,
        ...override,
        environment: 'development',
        nodeEnvironment: 'development',
        host: 'localhost:3000',
      }),
    ).toBe(false)
  })
})

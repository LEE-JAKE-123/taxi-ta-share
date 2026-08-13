import { describe, expect, it } from 'vitest'
import { isDemoAdminLoginAllowed } from './demo-admin'

describe('isDemoAdminLoginAllowed', () => {
  it('blocks the demo admin identity outside the production domain', () => {
    expect(
      isDemoAdminLoginAllowed({
        studentId: '123456789',
        name: '택시타쉐어관리자',
        enabled: 'true',
        host: 'localhost:3000',
      }),
    ).toBe(false)
  })

  it('blocks the demo admin login when the explicit flag is disabled', () => {
    expect(
      isDemoAdminLoginAllowed({
        studentId: '123456789',
        name: '택시타쉐어관리자',
        enabled: undefined,
        host: 'localhost:3000',
      }),
    ).toBe(false)
  })

  it('allows the demo admin login on the exact production domain', () => {
    expect(
      isDemoAdminLoginAllowed({
        studentId: '123456789',
        name: '택시타쉐어관리자',
        enabled: 'true',
        host: 'taxi-ta-share-phi.vercel.app',
      }),
    ).toBe(true)
  })

  it.each([
    'evil.example',
    'localhost:3000',
    'taxi-ta-share.vercel.app',
    'taxi-ta-share-git-main-example.vercel.app',
    'preview.taxi-ta-share-phi.vercel.app',
    'taxi-ta-share-phi.vercel.app:443',
    'TAXI-TA-SHARE-PHI.VERCEL.APP',
    null,
  ])('blocks the production demo admin login for host %s', (host) => {
    expect(
      isDemoAdminLoginAllowed({
        studentId: '123456789',
        name: '택시타쉐어관리자',
        enabled: 'true',
        host,
      }),
    ).toBe(false)
  })

  it.each([
    ['123456788', '택시타쉐어관리자'],
    ['123456789', '택시타쉐어관리자아님'],
  ])(
    'blocks every other identity even on the production domain',
    (studentId, name) => {
      expect(
        isDemoAdminLoginAllowed({
          studentId,
          name,
          enabled: 'true',
          host: 'taxi-ta-share-phi.vercel.app',
        }),
      ).toBe(false)
    },
  )

  it('blocks the production demo admin login when the flag is disabled', () => {
    expect(
      isDemoAdminLoginAllowed({
        studentId: '123456789',
        name: '택시타쉐어관리자',
        enabled: 'false',
        host: 'taxi-ta-share-phi.vercel.app',
      }),
    ).toBe(false)
  })
})

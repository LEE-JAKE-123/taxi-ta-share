export const DEMO_ADMIN_STUDENT_ID = '123456789'
export const DEMO_ADMIN_NAME = '택시타쉐어관리자'
export const DEMO_ADMIN_PRODUCTION_HOST = 'taxi-ta-share-phi.vercel.app'
export const DEMO_ADMIN_DEVELOPMENT_HOSTS = new Set([
  'localhost:3000',
  '127.0.0.1:3000',
])

export function isDemoAdminLoginAllowed(input: {
  studentId: string
  name: string
  enabled: string | undefined
  environment: string | undefined
  nodeEnvironment: string | undefined
  host: string | null | undefined
}) {
  const allowedHost =
    (input.environment === 'development' &&
      input.nodeEnvironment === 'development' &&
      input.host !== null &&
      input.host !== undefined &&
      DEMO_ADMIN_DEVELOPMENT_HOSTS.has(input.host)) ||
    (input.environment === 'production' &&
      input.nodeEnvironment === 'production' &&
      input.host === DEMO_ADMIN_PRODUCTION_HOST)

  return (
    input.enabled === 'true' &&
    input.studentId === DEMO_ADMIN_STUDENT_ID &&
    input.name === DEMO_ADMIN_NAME &&
    allowedHost
  )
}

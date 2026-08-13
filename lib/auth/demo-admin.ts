export const DEMO_ADMIN_STUDENT_ID = '123456789'
export const DEMO_ADMIN_NAME = '택시타쉐어관리자'
export const DEMO_ADMIN_PRODUCTION_HOST = 'taxi-ta-share-phi.vercel.app'

export function isDemoAdminLoginAllowed(input: {
  studentId: string
  name: string
  enabled: string | undefined
  host: string | null | undefined
}) {
  return (
    input.enabled === 'true' &&
    input.studentId === DEMO_ADMIN_STUDENT_ID &&
    input.name === DEMO_ADMIN_NAME &&
    input.host === DEMO_ADMIN_PRODUCTION_HOST
  )
}

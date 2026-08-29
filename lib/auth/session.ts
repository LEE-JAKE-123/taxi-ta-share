import 'server-only'

import { createHash, createHmac, randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  ensureDatabaseIdentity,
  getDatabase,
  hasDatabaseConfiguration,
} from '@/lib/db/client'
import {
  DEMO_ADMIN_STUDENT_ID,
  isDemoAdminLoginAllowed,
} from '@/lib/auth/demo-admin'

export const SESSION_COOKIE_NAME = 'taxitashare_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14

export type AuthenticatedUser = {
  userId: string
  studentId: string
  name: string
  gender: 'female' | 'male'
  schoolEmail: string
  role: 'USER' | 'ADMIN'
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
}

export function createSessionToken(signupAttemptId: string) {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters.')
  }
  return createHmac('sha256', secret)
    .update(`signup:${signupAttemptId}`)
    .digest('base64url')
}

export function createLoginSessionToken() {
  return randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function getSessionExpiry() {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  if (!hasDatabaseConfiguration()) return null

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  await ensureDatabaseIdentity()
  const sql = getDatabase()
  const rows = await sql`
    SELECT
      u.user_id AS "userId",
      u.student_id AS "studentId",
      u.name,
      u.gender,
      u.school_email AS "schoolEmail",
      u.role,
      u.account_status AS "accountStatus"
    FROM auth_sessions s
    JOIN users u ON u.user_id = s.user_id
    WHERE s.token_hash = ${hashSessionToken(token)}
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.account_status = 'ACTIVE'
    LIMIT 1
  `

  return (rows[0] as AuthenticatedUser | undefined) ?? null
}

export function hasCompleteProfile(user: AuthenticatedUser) {
  return Boolean(
    user.studentId.trim() &&
      user.name.trim() &&
      user.gender &&
      user.schoolEmail.trim(),
  )
}

export async function requireCompleteUser() {
  const user = await getCurrentUser()
  if (!user || !hasCompleteProfile(user)) redirect('/login')
  return user
}

export async function requireAdmin() {
  const user = await requireCompleteUser()
  if (user.role !== 'ADMIN') redirect('/home')
  if (user.studentId === DEMO_ADMIN_STUDENT_ID) {
    const requestHost = (await headers()).get('host')
    if (
      !isDemoAdminLoginAllowed({
        studentId: user.studentId,
        name: user.name,
        enabled: process.env.DEMO_ADMIN_LOGIN_ENABLED,
        environment: process.env.APP_ENVIRONMENT,
        nodeEnvironment: process.env.NODE_ENV,
        host: requestHost,
      })
    ) {
      redirect('/home')
    }
  }
  return user
}

'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ensureDatabaseIdentity, getDatabase } from '@/lib/db/client'
import {
  createLoginSessionToken,
  getSessionExpiry,
  hashSessionToken,
  setSessionCookie,
} from '@/lib/auth/session'
import { parseLoginForm } from '@/lib/auth/validation'
import { isDemoAdminLoginAllowed } from '@/lib/auth/demo-admin'

export type LoginState = {
  message?: string
  fieldErrors?: Record<string, string[] | undefined>
}

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = parseLoginForm(formData)
  if (!parsed.success) {
    return {
      message: '입력한 정보를 다시 확인해주세요.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const token = createLoginSessionToken()
  const tokenHash = hashSessionToken(token)
  const expiresAt = getSessionExpiry()
  let authenticatedRole: 'USER' | 'ADMIN' = 'USER'
  const requestHost = (await headers()).get('host')
  const demoAdminAllowed = isDemoAdminLoginAllowed({
    studentId: parsed.data.studentId,
    name: parsed.data.name,
    enabled: process.env.DEMO_ADMIN_LOGIN_ENABLED,
    environment: process.env.APP_ENVIRONMENT,
    nodeEnvironment: process.env.NODE_ENV,
    host: requestHost,
  })

  try {
    await ensureDatabaseIdentity()
    const sql = getDatabase()
    const rows = await sql`
      INSERT INTO auth_sessions (user_id, token_hash, expires_at)
      SELECT user_id, ${tokenHash}, ${expiresAt.toISOString()}
        FROM users
       WHERE student_id = ${parsed.data.studentId}
         AND name = ${parsed.data.name}
         AND account_status = 'ACTIVE'
         AND (
           role = 'USER'
           OR (
             role = 'ADMIN'
             AND ${demoAdminAllowed}
             AND student_id = '123456789'
             AND name = '택시타쉐어관리자'
           )
         )
      RETURNING session_id,
        (SELECT role FROM users WHERE user_id = auth_sessions.user_id) AS role
    `
    if (rows.length !== 1) {
      return { message: '학번 또는 이름이 일치하지 않습니다.' }
    }
    authenticatedRole = rows[0].role === 'ADMIN' ? 'ADMIN' : 'USER'
  } catch {
    return { message: '로그인 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' }
  }

  await setSessionCookie(token, expiresAt)
  redirect(authenticatedRole === 'ADMIN' ? '/admin' : '/home')
}

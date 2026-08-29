'use server'

import { redirect } from 'next/navigation'
import { ensureDatabaseIdentity, getDatabase } from '@/lib/db/client'
import {
  createSessionToken,
  getCurrentUser,
  getSessionExpiry,
  hashSessionToken,
  setSessionCookie,
} from '@/lib/auth/session'
import { parseSignupForm } from '@/lib/auth/validation'

export type SignupState = {
  message?: string
  fieldErrors?: Record<string, string[] | undefined>
}

export async function signupAction(
  _previousState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  if (await getCurrentUser()) redirect('/home')
  const parsed = parseSignupForm(formData)

  if (!parsed.success) {
    return {
      message: '입력한 정보를 다시 확인해주세요.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const { signupAttemptId, studentId, name, gender, schoolEmail } = parsed.data
  let token: string
  try {
    token = createSessionToken(signupAttemptId)
  } catch {
    return {
      message:
        '가입 환경이 아직 준비되지 않았어요. 운영자에게 문의해주세요.',
    }
  }
  const tokenHash = hashSessionToken(token)
  const expiresAt = getSessionExpiry()

  try {
    await ensureDatabaseIdentity()
    const sql = getDatabase()
    const results = await sql.transaction([
      sql`
        INSERT INTO users (
          signup_attempt_id,
          student_id,
          name,
          gender,
          school_email
        )
        VALUES (
          ${signupAttemptId},
          ${studentId},
          ${name},
          ${gender},
          ${schoolEmail}
        )
        ON CONFLICT (signup_attempt_id) DO NOTHING
      `,
      sql`
        INSERT INTO auth_sessions (user_id, token_hash, expires_at)
        SELECT user_id, ${tokenHash}, ${expiresAt.toISOString()}
        FROM users
        WHERE signup_attempt_id = ${signupAttemptId}
          AND signup_attempt_expires_at > now()
          AND student_id = ${studentId}
          AND name = ${name}
          AND gender = ${gender}
          AND school_email = ${schoolEmail}
          AND account_status = 'ACTIVE'
        ON CONFLICT (token_hash)
        DO UPDATE SET expires_at = EXCLUDED.expires_at, revoked_at = NULL
        RETURNING session_id
      `,
    ])

    if (results[1].length !== 1) {
      return {
        message:
          '가입 요청 정보가 이전 시도와 일치하지 않아요. 페이지를 새로 열어 다시 시도해주세요.',
      }
    }
  } catch (error) {
    const code =
      typeof error === 'object' && error && 'code' in error
        ? String(error.code)
        : ''

    if (code === '23505') {
      const constraint =
        typeof error === 'object' && error && 'constraint' in error
          ? String(error.constraint)
          : ''
      if (constraint === 'users_student_id_unique') {
        return {
          message: '이미 가입된 학번입니다.',
          fieldErrors: { studentId: ['이미 가입된 학번입니다.'] },
        }
      }
      if (constraint === 'users_school_email_unique') {
        return {
          message: '이미 가입된 학교 이메일입니다.',
          fieldErrors: { schoolEmail: ['이미 가입된 학교 이메일입니다.'] },
        }
      }
      return { message: '이미 가입된 학번 또는 학교 이메일입니다.' }
    }

    console.error('Signup failed without exposing submitted personal data.', {
      code,
    })
    return {
      message:
        '가입 정보를 저장하지 못했어요. 잠시 후 다시 시도해주세요.',
    }
  }

  await setSessionCookie(token, expiresAt)
  redirect('/home')
}

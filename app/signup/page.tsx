'use client'

import { useActionState, useEffect, useState } from 'react'
import { Info } from 'lucide-react'
import { MobileShell } from '@/components/mobile-shell'
import { TopBar } from '@/components/top-bar'
import { BottomBar, BigButton } from '@/components/bottom-bar'
import { signupAction, type SignupState } from './actions'

const initialState: SignupState = {}

export default function SignupPage() {
  const [state, action, pending] = useActionState(signupAction, initialState)
  const [signupAttemptId, setSignupAttemptId] = useState('')

  useEffect(() => {
    const attemptId = crypto.randomUUID()
    const timer = window.setTimeout(() => setSignupAttemptId(attemptId), 0)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <MobileShell withTabBar={false} className="bg-background">
      <TopBar title="회원가입" subtitle="택시타쉐어 이용을 위한 기본 정보" backHref="/" />

      <form action={action} className="flex flex-1 flex-col">
        <input
          type="hidden"
          name="signupAttemptId"
          value={signupAttemptId}
        />
        <fieldset
          disabled={pending || !signupAttemptId}
          className="flex flex-1 flex-col gap-5 px-5 py-6 pb-32 disabled:opacity-70"
        >
          <Field
            id="studentId"
            label="학번"
            error={state.fieldErrors?.studentId?.[0]}
          >
            <input
              id="studentId"
              name="studentId"
              inputMode="numeric"
              pattern="[0-9]{9}"
              autoComplete="off"
              required
              minLength={9}
              maxLength={9}
              aria-invalid={Boolean(state.fieldErrors?.studentId)}
              aria-describedby={
                state.fieldErrors?.studentId
                  ? 'studentId-error student-id-help'
                  : 'student-id-help'
              }
              placeholder="예: 202134567"
              className="app-input"
            />
            <p
              id="student-id-help"
              className="mt-2 text-xs leading-relaxed text-muted-foreground"
            >
              숫자 9자리 학번을 입력해주세요.
            </p>
          </Field>

          <Field id="name" label="이름" error={state.fieldErrors?.name?.[0]}>
            <input
              id="name"
              name="name"
              autoComplete="name"
              required
              maxLength={80}
              aria-invalid={Boolean(state.fieldErrors?.name)}
              aria-describedby={state.fieldErrors?.name ? 'name-error' : undefined}
              placeholder="이름을 입력해주세요"
              className="app-input"
            />
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">성별</legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['female', '여성'],
                ['male', '남성'],
              ].map(([value, label]) => (
                <label
                  key={value}
                  className="flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-border bg-card px-3 py-3 text-center text-sm font-semibold has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground focus-within:ring-2 focus-within:ring-ring"
                >
                  <input
                    type="radio"
                    name="gender"
                    value={value}
                    required
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
            {state.fieldErrors?.gender?.[0] ? (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {state.fieldErrors.gender[0]}
              </p>
            ) : null}
          </fieldset>

          <Field
            id="schoolEmail"
            label="학교 이메일"
            error={state.fieldErrors?.schoolEmail?.[0]}
          >
            <input
              id="schoolEmail"
              name="schoolEmail"
              type="email"
              pattern="[^@\s]+@[jJ][bB][nN][uU]\.[aA][cC]\.[kK][rR]"
              autoComplete="email"
              required
              maxLength={320}
              aria-invalid={Boolean(state.fieldErrors?.schoolEmail)}
              aria-describedby={
                state.fieldErrors?.schoolEmail
                  ? 'schoolEmail-error school-email-help'
                  : 'school-email-help'
              }
              placeholder="예: minji@jbnu.ac.kr"
              className="app-input"
            />
            <p
              id="school-email-help"
              className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              <Info className="mt-0.5 size-3.5 shrink-0" />
              @jbnu.ac.kr 학교 이메일이 필요하며 별도의 인증 절차는 없어요.
            </p>
          </Field>

          <label className="mt-1 flex cursor-pointer items-start gap-3 rounded-[18px] border border-border bg-card px-4 py-3 text-left focus-within:ring-2 focus-within:ring-ring">
            <input
              type="checkbox"
              name="privacyConsent"
              required
              className="mt-0.5 size-5 accent-primary"
            />
            <span>
              <span className="block text-sm font-medium">
                개인정보 수집·이용에 동의합니다.
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                학번·이름·성별·학교 이메일은 가입과 서비스 제공을 위해
                수집합니다. 보관 기간과 삭제 절차는 출시 전 확정할
                개인정보처리방침에 따릅니다.
              </span>
            </span>
          </label>

          <p aria-live="polite" className="text-sm text-destructive">
            {pending ? '가입 정보를 안전하게 저장하고 있어요.' : state.message}
          </p>
        </fieldset>

        <BottomBar>
          <BigButton type="submit" disabled={pending || !signupAttemptId}>
            {pending ? '가입 처리 중…' : '가입하고 시작하기'}
          </BigButton>
        </BottomBar>
      </form>
    </MobileShell>
  )
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

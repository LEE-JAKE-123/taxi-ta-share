import { randomUUID } from 'node:crypto'
import { submitSupportInquiryAction } from '@/app/core/actions'
import { MobileShell } from '@/components/mobile-shell'
import { PendingSubmitButton } from '@/components/pending-submit-button'
import { TopBar } from '@/components/top-bar'
import { Card, CardTitle } from '@/components/ui/card'
import { requireCompleteUser } from '@/lib/auth/session'

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>
}) {
  await requireCompleteUser()
  const { message, error } = await searchParams

  return (
    <MobileShell withTabBar={false}>
      <TopBar title="고객 문의" backHref="/mypage" />
      <main className="flex flex-1 flex-col gap-4 px-5 py-5">
        {message ? (
          <p role="status" className="rounded-xl bg-mint-soft px-4 py-3 text-sm">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl bg-warn-soft px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}

        <Card className="border-primary/20 bg-primary/5">
          <CardTitle>도움이 필요하신가요?</CardTitle>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            계정, 모집, 포인트와 정산 관련 문의를 남겨 주세요. 안전 문제는 방 상세 화면의 신고 기능을 이용하면 운영자가 별도로 검토합니다.
          </p>
        </Card>

        <form action={submitSupportInquiryAction}>
          <Card className="flex flex-col gap-4">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <div>
              <label htmlFor="support-category" className="mb-1.5 block text-sm font-semibold">
                문의 유형
              </label>
              <select id="support-category" name="category" className="app-input" defaultValue="" required>
                <option value="" disabled>문의 유형을 선택하세요</option>
                <option value="ACCOUNT">계정 및 프로필</option>
                <option value="MATCHING">모집 및 참여</option>
                <option value="POINTS">포인트 및 정산</option>
                <option value="SAFETY">안전 및 이용 제한</option>
                <option value="OTHER">기타</option>
              </select>
            </div>
            <div>
              <label htmlFor="support-subject" className="mb-1.5 block text-sm font-semibold">
                제목
              </label>
              <input
                id="support-subject"
                name="subject"
                className="app-input"
                minLength={2}
                maxLength={120}
                required
              />
            </div>
            <div>
              <label htmlFor="support-body" className="mb-1.5 block text-sm font-semibold">
                문의 내용
              </label>
              <textarea
                id="support-body"
                name="body"
                className="app-input min-h-40 resize-y"
                minLength={10}
                maxLength={2000}
                required
              />
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                다른 사람의 전화번호, 학교 이메일 등 불필요한 개인정보는 입력하지 마세요.
              </p>
            </div>
            <PendingSubmitButton pendingLabel="문의를 접수하는 중…">
              문의 접수하기
            </PendingSubmitButton>
          </Card>
        </form>
      </main>
    </MobileShell>
  )
}

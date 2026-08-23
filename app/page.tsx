import Link from 'next/link'
import { ArrowRight, MapPin, Route, ShieldCheck, Sparkles } from 'lucide-react'
import { redirect } from 'next/navigation'
import { MobileShell } from '@/components/mobile-shell'
import { BrandLogo, TaxiMark } from '@/components/brand-logo'
import { getCurrentUser } from '@/lib/auth/session'

export default async function OnboardingPage() {
  if (await getCurrentUser()) redirect('/home')

  return (
    <MobileShell withTabBar={false} className="bg-canvas">
      <div className="mx-auto flex w-full max-w-[960px] flex-1 flex-col px-5 pb-6 pt-6 sm:px-8 sm:pt-8">
        <header className="flex items-center justify-between">
          <BrandLogo size="md" />
          <span className="rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-semibold text-ink-secondary">
            Campus mobility
          </span>
        </header>

        <main className="flex flex-1 flex-col justify-center py-8 sm:py-14">
          <section className="route-grid relative overflow-hidden rounded-[22px] border border-hairline bg-surface px-6 py-8 sm:px-10 sm:py-12">
            <div className="absolute -right-12 -top-12 size-48 rounded-full border border-brand/20" />
            <div className="absolute -bottom-20 right-10 size-40 rounded-full border border-brand/20" />
            <div className="relative flex items-start justify-between gap-5">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-brand-strong uppercase">TaxiTaShare route</p>
                <h1 className="mt-4 text-pretty text-[34px] font-bold leading-[1.3] tracking-[-0.04em] text-ink sm:text-[42px]">
                  같은 방향이라면,
                  <br />
                  함께 더 가볍게.
                </h1>
              </div>
              <TaxiMark className="size-16 shrink-0 border-brand/20 bg-brand-soft sm:size-20" />
            </div>
            <div className="relative mt-9 flex items-center gap-3 text-sm text-ink-secondary">
              <span className="size-3 rounded-full border-[3px] border-brand bg-brand-soft" />
              <span className="h-px flex-1 bg-hairline" />
              <Route className="size-5 text-brand" aria-hidden />
              <span className="h-px flex-1 bg-hairline" />
              <MapPin className="size-5 text-brand" aria-hidden />
            </div>
            <p className="relative mt-4 max-w-md text-[15px] leading-relaxed text-ink-secondary">
              출발지와 목적지, 시간과 인원을 기준으로 안전하게 동승 방을 찾아드려요.
            </p>
          </section>

          <section className="mt-5 grid gap-px overflow-hidden rounded-[18px] border border-hairline bg-hairline sm:grid-cols-3" aria-label="서비스 특징">
            <Feature icon={MapPin} title="가까운 출발지" text="출발 위치가 가까운 방부터 확인해요." />
            <Feature icon={Sparkles} title="계산 근거 기반 추천" text="경로와 시간 조건을 바탕으로 추천해요." />
            <Feature icon={ShieldCheck} title="투명한 정산" text="확정 인원 기준으로 포인트를 정산해요." />
          </section>
        </main>

        <footer className="grid gap-3 sm:grid-cols-2">
          <Link href="/signup" className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-colors hover:bg-action-focus active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            시작하기
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link href="/login" className="flex min-h-12 items-center justify-center rounded-[14px] border border-hairline bg-surface px-6 py-3 text-base font-semibold text-ink transition-colors hover:bg-surface-subtle active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            로그인
          </Link>
        </footer>
        <p className="mt-4 text-center text-xs text-muted-foreground">대학생을 위한 택시 동승 · 비용 분담 서비스</p>
      </div>
    </MobileShell>
  )
}

function Feature({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  text: string
}) {
  return (
    <div className="bg-surface p-5">
      <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="mt-5 text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  )
}

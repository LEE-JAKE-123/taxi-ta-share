import Link from 'next/link'
import { ArrowRight, MapPin, Sparkles, ShieldCheck } from 'lucide-react'
import { redirect } from 'next/navigation'
import { MobileShell } from '@/components/mobile-shell'
import { BrandLogo, TaxiMark } from '@/components/brand-logo'
import { getCurrentUser } from '@/lib/auth/session'

export default async function OnboardingPage() {
  if (await getCurrentUser()) redirect('/home')
  return (
    <MobileShell withTabBar={false} className="bg-background">
      <div className="flex flex-1 flex-col px-6 pb-8 pt-12">
        <BrandLogo size="md" />

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="relative mb-8">
            <TaxiMark className="size-56" />
              <span className="absolute -right-3 -top-3 flex min-h-7 items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground">
              <Sparkles className="size-3.5" />
              AI 추천
            </span>
          </div>

          <h1 className="text-pretty text-[34px] font-semibold leading-tight tracking-[-0.02em]">
            같은 방향이라면,
            <br />
            택시비도 함께 나눠요
          </h1>
          <p className="mt-5 text-pretty text-[17px] leading-relaxed text-muted-foreground">
            가까운 출발지와 비슷한 목적지의
            <br />
            동승 방을 찾아드려요.
          </p>

          <ul className="mt-10 flex w-full flex-col gap-0 text-left">
            <Feature icon={MapPin} text="내 주변 출발지와 가까운 방을 우선 추천" />
            <Feature icon={Sparkles} text="AI가 우회 시간까지 계산해 매칭" />
            <Feature icon={ShieldCheck} text="확정 인원 기준의 투명한 포인트 정산" />
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Link href="/login" className="flex min-h-12 items-center justify-center rounded-full bg-primary px-6 py-3 text-[17px] font-normal text-primary-foreground transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            로그인
          </Link>
          <Link href="/signup" className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-primary px-6 py-3 text-[17px] font-normal text-primary transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            회원가입
            <ArrowRight className="size-5" />
          </Link>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          대학생을 위한 택시 동승·비용 분담 서비스
        </p>
      </div>
    </MobileShell>
  )
}

function Feature({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>
  text: string
}) {
  return (
    <li className="flex items-center gap-4 border-b border-border px-2 py-5 last:border-b-0">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
        <Icon className="size-5" />
      </span>
      <span className="text-[17px] font-normal leading-relaxed">{text}</span>
    </li>
  )
}

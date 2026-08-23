import Image from 'next/image'
import { cn } from '@/lib/utils'
import logoImage from '@/ii/logo.png.png'

/** 노란 택시 모티프 아이콘 (라인 스타일 + 채움) */
export function TaxiMark({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex overflow-hidden rounded-[12px] border border-hairline bg-white', className)}>
      <Image src={logoImage} alt="" fill sizes="112px" className="object-cover" />
    </span>
  )
}

export function BrandLogo({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const markSize =
    size === 'lg' ? 'size-11' : size === 'sm' ? 'size-7' : 'size-9'
  const textSize =
    size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-lg'
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-ink', className)}>
      <TaxiMark className={markSize} />
      <span className={cn('font-semibold tracking-[-0.035em]', textSize)}>택시타쉐어</span>
    </span>
  )
}

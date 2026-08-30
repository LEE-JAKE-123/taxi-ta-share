import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

const items = [
  ['/admin', '대시보드'],
  ['/admin/points', '포인트'],
  ['/admin/reports', '신고'],
  ['/admin/operations', '방 운영'],
  ['/admin/settlements', '정산 예외'],
  ['/admin/users', '사용자'],
  ['/admin/release', '출시 점검'],
  ['/admin/audit', '감사 로그'],
] as const

export function AdminNav() {
  return (
    <nav
      aria-label="관리자 메뉴"
      className="border-b border-hairline bg-surface"
    >
      <div className="mx-auto flex max-w-[1280px] gap-2 overflow-x-auto px-4 py-3 sm:px-5">
        {items.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={buttonVariants({
              variant: 'secondary',
              size: 'sm',
              className: 'shrink-0',
            })}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  )
}

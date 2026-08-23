'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, CarTaxiFront, Coins, User, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

const tabs = [
  { href: '/home', label: '홈', icon: Home },
  { href: '/my-rooms', label: '내 방', icon: CarTaxiFront },
  { href: '/create', label: '방 만들기', icon: Plus },
  { href: '/points', label: '포인트', icon: Coins },
  { href: '/mypage', label: '마이', icon: User },
]

export function TabBar() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[1068px]"
    >
      <div className="border-t border-hairline bg-canvas/80 backdrop-blur-xl backdrop-saturate-150">
        <ul className="flex items-stretch justify-between px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
          {tabs.map((t) => (
            <TabItem key={t.href} {...t} active={pathname === t.href} />
          ))}
        </ul>
      </div>
    </nav>
  )
}

function TabItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string
  label: string
  icon: typeof Home
  active: boolean
}) {
  return (
    <li className="flex flex-1">
      <Link
        href={href}
        className={cn(
          'flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-[11px] py-1.5 text-[11px] font-normal outline-none transition-[transform,color,background-color] duration-150 motion-reduce:transition-none active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          active ? 'text-action' : 'text-ink-muted hover:text-ink',
        )}
        aria-current={active ? 'page' : undefined}
      >
        <Icon
          className="size-5"
          strokeWidth={active ? 2.4 : 1.8}
          aria-hidden
        />
        {label}
      </Link>
    </li>
  )
}

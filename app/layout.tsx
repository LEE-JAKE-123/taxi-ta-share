import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Noto_Sans_KR, Gothic_A1 } from 'next/font/google'
import { AppProvider } from '@/components/app-provider'
import { getCurrentUser } from '@/lib/auth/session'
import './globals.css'

export const dynamic = 'force-dynamic'

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-pretendard',
  display: 'swap',
})

const gothicA1 = Gothic_A1({
  subsets: ['latin'],
  weight: ['500', '700', '800'],
  variable: '--font-gothic',
  display: 'swap',
})

export const metadata: Metadata = {
  title: '택시타쉐어 · 같은 방향이라면 택시비도 함께',
  description:
    '같은 방향으로 이동하는 대학생이 함께 택시를 타고 비용을 나누는 동승 매칭 서비스, 택시타쉐어.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#2F6B57',
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const authenticatedUser = await getCurrentUser()

  return (
    <html lang="ko" className={`bg-muted ${notoSansKr.variable} ${gothicA1.variable}`}>
      <body className="font-sans antialiased">
        <AppProvider
          authenticatedUser={
            authenticatedUser
              ? {
                  name: authenticatedUser.name,
                  studentId: authenticatedUser.studentId,
                  gender: authenticatedUser.gender,
                  email: authenticatedUser.schoolEmail,
                }
              : null
          }
        >
          {children}
        </AppProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { getUserSession } from '@/lib/auth/session'
import { createRequestClient } from '@/lib/supabase/server'
import { Toaster } from '@/components/ui/toast'
import './globals.css'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter' })
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jetbrains' })

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(process.env.APP_URL || 'http://localhost:3040'),
    title: { default: 'ys-planner', template: '%s · ys-planner' },
    openGraph: {
      title: 'ys-planner',
      siteName: 'ys-planner',
      images: [{ url: '/brand/og-image.png', width: 1200, height: 630, alt: 'ys-planner' }],
    },
  }
}

async function loadTheme(): Promise<'light' | 'dark'> {
  const session = await getUserSession()
  if (!session) return 'light'
  const { data } = await createRequestClient(session)
    .from('user_settings')
    .select('theme')
    .eq('user_id', session.uid)
    .maybeSingle()
  return data?.theme === 'dark' ? 'dark' : 'light'
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Theme serverseitig aus user_settings → kein Flackern beim Laden
  const theme = await loadTheme()
  return (
    <html lang="de" className={`${inter.variable} ${mono.variable} ${theme === 'dark' ? 'dark' : ''}`}>
      <body className="antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  )
}

import { getUserSession } from '@/lib/auth/session'
import { createRequestClient } from '@/lib/supabase/server'
import { CurrentUserProvider } from '@/components/app/current-user'
import { AppShell } from '@/components/app/app-shell'
import { LoginRedirect } from '@/components/app/login-redirect'
import type { User } from '@/lib/types'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getUserSession()
  // Ohne Session: im Browser mit vollständiger URL (inkl. ?task=…) zum Login
  if (!session) return <LoginRedirect />

  const { data: user } = await createRequestClient(session)
    .from('users')
    .select('id, email, display_name, avatar_color')
    .eq('id', session.uid)
    .maybeSingle<User>()

  const current: User = user ?? {
    id: session.uid,
    email: session.email,
    display_name: session.name,
    avatar_color: '#1F7A57',
  }

  return (
    <CurrentUserProvider user={current}>
      <AppShell>{children}</AppShell>
    </CurrentUserProvider>
  )
}

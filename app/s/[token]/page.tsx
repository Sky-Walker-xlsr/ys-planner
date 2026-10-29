import { findLinkByToken } from '@/lib/share'
import { getGuestSession } from '@/lib/auth/session'
import { GuestEntry } from '@/components/guest/guest-entry'
import { GuestPlanner } from '@/components/guest/guest-planner'
import { Logo } from '@/components/brand/Logo'

export const metadata = { title: 'Gastzugang' }

const REASONS = {
  not_found: 'Dieser Link ist ungültig.',
  revoked: 'Dieser Link wurde widerrufen.',
  expired: 'Dieser Link ist abgelaufen.',
}

export default async function SharePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { token } = await params
  const { error } = await searchParams
  const check = await findLinkByToken(token)

  if (!check.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-sm p-6 text-center">
          <Logo size={64} className="mx-auto mb-4" />
          <h1 className="text-base font-semibold">Kein Zugriff</h1>
          <p className="mt-1 text-sm text-text-2">{REASONS[check.reason]}</p>
        </div>
      </main>
    )
  }

  const link = check.link
  const session = await getGuestSession(link.id)
  if (session && session.plannerId === link.planner_id) {
    return (
      <div className="flex h-screen flex-col">
        <GuestPlanner
          plannerId={link.planner_id}
          viewer={{ kind: 'guest', id: session.gid, name: session.name || 'Gast', linkId: link.id, perm: link.permission }}
        />
      </div>
    )
  }

  return (
    <GuestEntry
      token={token}
      requireName={link.require_name}
      requirePassword={!!link.password_hash}
      error={error === 'password' ? 'Das Passwort ist falsch.' : error === 'name' ? 'Bitte gib deinen Namen ein.' : null}
    />
  )
}

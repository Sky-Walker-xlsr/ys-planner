'use client'
import { useEffect, useRef } from 'react'
import { LayoutGrid } from 'lucide-react'

export function GuestEntry({
  token,
  requireName,
  requirePassword,
  error,
}: {
  token: string
  requireName: boolean
  requirePassword: boolean
  error: string | null
}) {
  const form = useRef<HTMLFormElement>(null)
  const needsInput = requireName || requirePassword

  // Ohne Name/Passwort direkt eintreten
  useEffect(() => {
    if (!needsInput) form.current?.requestSubmit()
  }, [needsInput])

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form ref={form} method="post" action="/api/share/enter" className="card w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-on-accent"><LayoutGrid size={16} /></span>
          <span className="font-semibold">ys-planner</span>
        </div>
        <h1 className="text-base font-semibold">Gastzugang</h1>
        <p className="mb-4 text-sm text-text-2">{needsInput ? 'Für diesen geteilten Planner sind folgende Angaben nötig.' : 'Planner wird geöffnet …'}</p>
        <input type="hidden" name="token" value={token} />
        {requireName && (
          <div className="mb-3">
            <label htmlFor="guest-name" className="field-label">Dein Name</label>
            <input id="guest-name" name="name" className="input" required maxLength={60} autoComplete="name" autoFocus />
          </div>
        )}
        {requirePassword && (
          <div className="mb-3">
            <label htmlFor="guest-password" className="field-label">Passwort</label>
            <input id="guest-password" name="password" type="password" className="input" required autoComplete="current-password" autoFocus={!requireName} />
          </div>
        )}
        {error && <p className="mb-3 text-sm text-danger" role="alert">{error}</p>}
        {needsInput && <button type="submit" className="btn-primary w-full">Öffnen</button>}
      </form>
    </main>
  )
}

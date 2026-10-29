'use client'
import { useEffect } from 'react'
import { Logo } from '@/components/brand/Logo'

export function LoginRedirect() {
  useEffect(() => {
    const returnTo = window.location.pathname + window.location.search
    window.location.replace(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`)
  }, [])
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-sm text-text-2">
      <Logo size={64} />
      Weiterleitung zur Anmeldung …
    </div>
  )
}

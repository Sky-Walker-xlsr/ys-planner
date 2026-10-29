'use client'
import { useEffect } from 'react'

export function LoginRedirect() {
  useEffect(() => {
    const returnTo = window.location.pathname + window.location.search
    window.location.replace(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`)
  }, [])
  return (
    <div className="flex h-screen items-center justify-center text-sm text-text-2">
      Weiterleitung zur Anmeldung …
    </div>
  )
}

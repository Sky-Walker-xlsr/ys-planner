// Reine OAuth-Regeln für den MCP-Zugang (ohne Datenbank, damit testbar).
import { toBase64Url } from '@/lib/auth/crypto'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Nur https, http nur für Loopback (Claude Code); ohne Fragment und ohne Zugangsdaten in der URL */
export function isValidRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 2000) return false
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password) return false
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))
}

/** Für die Anzeige auf der Einwilligungs-Seite: Der Name ist frei wählbar, der Host nicht */
export function redirectHost(uri: string) {
  return new URL(uri).host
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return toBase64Url(new Uint8Array(digest))
}

/** RFC 7636: 43 bis 128 Zeichen aus dem erlaubten Alphabet */
export function isValidCodeVerifier(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9\-._~]{43,128}$/.test(v)
}

export function isValidCodeChallenge(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9\-_]{43}$/.test(v)
}

/** Browser-Anfragen nur von hier (Schutz vor DNS-Rebinding); Server-zu-Server-Aufrufe haben keinen Origin */
export function isAllowedOrigin(origin: string | null, appUrl: string) {
  return origin === null || origin === appUrl || origin === 'https://claude.ai' || origin === 'https://claude.com'
}

/** RFC 8707: Falls angegeben, muss das Token für genau diesen Server sein */
export function isValidResource(resource: string | null | undefined, serverUrl: string) {
  return !resource || resource.replace(/\/$/, '') === serverUrl
}

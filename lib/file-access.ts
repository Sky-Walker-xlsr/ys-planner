// Rechte für Datei-Routen (R2 hat kein RLS). Die Rolle kommt aus public.planner_role() mit dem JWT
// des Aufrufers – also exakt die Logik der RLS-Policies, inklusive Gast-Claims.
import type { Role } from '@/lib/types'

export type FileAction = 'read' | 'write'

/** Zugriff auf Dateien eines Tasks/Planners. Inbox-Tasks (ohne Planner) nur für ihren Owner. */
export function canAccessFiles(
  ctx: { plannerRole: Role | null; inboxOwner?: boolean },
  action: FileAction,
): boolean {
  if (ctx.inboxOwner) return true
  if (!ctx.plannerRole) return false
  return action === 'read' || ctx.plannerRole === 'owner' || ctx.plannerRole === 'editor'
}

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/

/** Normalisiert einen MIME-Typ; ungültige Angaben werden zu application/octet-stream. */
export function normalizeMime(type: string | null | undefined) {
  const t = (type ?? '').split(';')[0].trim().toLowerCase()
  return MIME_RE.test(t) ? t : 'application/octet-stream'
}

/** Dateiname für Pfad und Anzeige: ohne Pfadtrenner/Steuerzeichen, max. 200 Zeichen. */
export function safeFileName(name: string) {
  const cleaned = name.replace(/[/\\\u0000-\u001f\u007f]/g, '-').trim()
  return (cleaned || 'Datei').slice(-200)
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_KB_BYTES = 2 * 1024 * 1024

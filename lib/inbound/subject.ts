// Betreff einer Mail in Titel, Priorität und Tags zerlegen.
import type { TaskPriority } from '@/lib/types'

export const PRIORITY_TAGS: Record<string, TaskPriority> = {
  dringend: 'urgent',
  wichtig: 'important',
  mittel: 'medium',
  niedrig: 'low',
}

const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]{1,60})(?=$|\s|[.,;:!?)])/gu
const PREFIX_RE = /^\s*(fwd?|fw|wg|aw|re)\s*:\s*/i

export type ParsedSubject = {
  title: string
  priority: TaskPriority | null
  /** alle übrigen Tags (kleingeschrieben, ohne Duplikate, in Reihenfolge) */
  tags: string[]
}

export function parseSubject(subject: string | undefined | null): ParsedSubject {
  const raw = (subject ?? '').replace(/\s+/g, ' ')
  let priority: TaskPriority | null = null
  const tags: string[] = []
  for (const m of raw.matchAll(TAG_RE)) {
    const tag = m[2].toLowerCase()
    if (PRIORITY_TAGS[tag]) priority ??= PRIORITY_TAGS[tag]
    else if (!tags.includes(tag)) tags.push(tag)
  }
  let title = raw.replace(TAG_RE, '$1').replace(/\s+/g, ' ').trim()
  // Fwd:/FW:/WG:/AW:/Re: auch verschachtelt entfernen
  while (PREFIX_RE.test(title)) title = title.replace(PREFIX_RE, '').trim()
  return { title: title.slice(0, 300) || '(Ohne Betreff)', priority, tags }
}

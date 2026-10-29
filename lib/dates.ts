// Datumshelfer. Fälligkeiten sind reine Daten (YYYY-MM-DD) ohne Zeitzone.

export function todayISO(timeZone?: string): string {
  return toISODate(new Date(), timeZone)
}

export function toISODate(d: Date, timeZone?: string): string {
  if (timeZone) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  }
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Sonntag der aktuellen Woche (Wochen beginnen am Montag) */
export function endOfWeekISO(iso: string): string {
  const d = parseISODate(iso)
  const dow = (d.getDay() + 6) % 7
  return addDays(iso, 6 - dow)
}

export function startOfWeekISO(iso: string): string {
  const d = parseISODate(iso)
  const dow = (d.getDay() + 6) % 7
  return addDays(iso, -dow)
}

export function isOverdue(due: string | null, done = false): boolean {
  return !!due && !done && due < todayISO()
}

export type DueState = 'overdue' | 'soon' | 'normal'

/** Fälligkeits-Farbe: rot = überfällig, orange = heute bis in 7 Tagen, sonst neutral. Erledigte sind neutral. */
export function dueState(due: string | null, done = false): DueState | null {
  if (!due) return null
  if (done) return 'normal'
  const today = todayISO()
  if (due < today) return 'overdue'
  return due <= addDays(today, 7) ? 'soon' : 'normal'
}

/** Textfarbe zum Fälligkeitsdatum (neutral = Standard-Textfarbe, im Dark Mode weiss) */
export function dueTextClass(due: string | null, done = false): string {
  const s = dueState(due, done)
  return s === 'overdue' ? 'font-medium text-danger' : s === 'soon' ? 'font-medium text-prio-important' : 'text-text'
}

/** Rahmen + Text für Datums-Chips im Zeitplan */
export function dueChipClass(due: string | null, done = false): string {
  const s = dueState(due, done)
  return s === 'overdue' ? 'border-danger/60 text-danger' : s === 'soon' ? 'border-prio-important/60 text-prio-important' : ''
}

const shortFmt = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short' })
const longFmt = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function formatShort(iso: string | null): string {
  return iso ? shortFmt.format(parseISODate(iso)) : ''
}

export function formatLong(iso: string | null): string {
  return iso ? longFmt.format(parseISODate(iso)) : ''
}

export function formatDateTime(ts: string): string {
  return dateTimeFmt.format(new Date(ts))
}

export function relativeTime(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return 'gerade eben'
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`
  if (diff < 7 * 86400) return `vor ${Math.floor(diff / 86400)} T.`
  return formatDateTime(ts)
}

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none'

export const DUE_BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: 'Überfällig',
  today: 'Heute',
  week: 'Diese Woche',
  later: 'Später',
  none: 'Ohne Datum',
}

export function dueBucket(due: string | null): DueBucket {
  if (!due) return 'none'
  const today = todayISO()
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  if (due <= endOfWeekISO(today)) return 'week'
  return 'later'
}

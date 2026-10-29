// URLs der Datei-Routen (R2 über den Worker). Gäste authentifizieren sich mit ihrer Link-ID.
import type { Viewer } from '@/lib/store/planner-store'

export function fileUrl(path: string, viewer: Viewer, opts: { download?: boolean } = {}) {
  const q = new URLSearchParams()
  if (viewer.kind === 'guest') q.set('link', viewer.linkId)
  if (opts.download) q.set('download', '1')
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

export const kbFileUrl = (id: string, viewer: Viewer, opts?: { download?: boolean }) => fileUrl(`/api/kb/${id}`, viewer, opts)
export const taskFileUrl = (id: string, viewer: Viewer, opts?: { download?: boolean }) => fileUrl(`/api/task-files/${id}`, viewer, opts)

/** fetch() mit Ergebnis im Format von mutate(): { error } */
export async function request(url: string, init?: RequestInit): Promise<{ error: string | null; res: Response | null }> {
  try {
    const res = await fetch(url, init)
    if (res.ok) return { error: null, res }
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return { error: body.error ?? `HTTP ${res.status}`, res }
  } catch {
    return { error: 'Netzwerkfehler', res: null }
  }
}

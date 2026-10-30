'use client'
import { useRef, useState } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { ColorPicker } from '@/components/ui/color-picker'
import { toast } from '@/components/ui/toast'
import { boardBackgroundStyle } from '@/lib/design'
import { ImageConversionError, isImage, toWebp } from '@/lib/image'
import { getBrowserClient } from '@/lib/supabase/browser'
import type { UserSettings } from '@/lib/types'

const URL = '/api/settings/board-background'
const DEFAULT_COLOR = '#1F7A57'

/** Karte «Board-Hintergrund»: Standard, eigene Farbe oder eigenes Bild (WebP, max. Full HD) */
export function BoardBackgroundCard({ settings, onChange }: {
  settings: UserSettings
  onChange: (patch: Pick<UserSettings, 'board_bg_color' | 'board_bg_image_at'>) => void
}) {
  const db = getBrowserClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bild, das beim nächsten Speichern der Farbe weg muss (der State zeigt es dann schon nicht mehr)
  const imagePending = useRef(false)
  const [busy, setBusy] = useState(false)
  const { board_bg_color: color, board_bg_image_at: imageAt } = settings
  const hasCustom = !!color || !!imageAt

  async function removeImage() {
    const res = await fetch(URL, { method: 'DELETE' })
    if (!res.ok) toast('Hintergrund konnte nicht entfernt werden')
    return res.ok
  }

  // Das Farbfeld meldet beim Ziehen jede Zwischenfarbe: erst speichern, wenn es ruhig wird
  function pickColor(next: string) {
    if (imageAt) imagePending.current = true
    onChange({ board_bg_color: next, board_bg_image_at: null })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      if (imagePending.current) {
        if (!(await removeImage())) return
        imagePending.current = false
      }
      const { error } = await db.from('user_settings').update({ board_bg_color: next }).eq('user_id', settings.user_id)
      if (error) toast('Farbe konnte nicht gespeichert werden')
    }, 400)
  }

  async function upload(original: File) {
    if (!isImage(original)) return toast('Bitte eine Bilddatei wählen')
    if (timer.current) clearTimeout(timer.current)
    imagePending.current = false
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', await toWebp(original))
      const res = await fetch(URL, { method: 'POST', body: form })
      const body = (await res.json().catch(() => ({}))) as { board_bg_image_at?: string; error?: string }
      if (!res.ok || !body.board_bg_image_at) return toast(body.error ?? 'Bild konnte nicht hochgeladen werden')
      onChange({ board_bg_color: null, board_bg_image_at: body.board_bg_image_at })
    } catch (e) {
      toast(e instanceof ImageConversionError ? e.message : 'Bild konnte nicht verarbeitet werden')
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (timer.current) clearTimeout(timer.current)
    if ((imageAt || imagePending.current) && !(await removeImage())) return
    imagePending.current = false
    const { error } = await db.from('user_settings').update({ board_bg_color: null }).eq('user_id', settings.user_id)
    if (error) return toast('Hintergrund konnte nicht zurückgesetzt werden')
    onChange({ board_bg_color: null, board_bg_image_at: null })
  }

  return (
    <section className="card p-5" aria-labelledby="board-bg-title">
      <h2 id="board-bg-title" className="mb-1 text-sm font-semibold">Board-Hintergrund</h2>
      <p className="mb-4 text-xs text-text-2">Gilt nur für dich, auf allen Boards.</p>
      <div className="mb-4 h-28 rounded-md border border-line bg-bg" style={boardBackgroundStyle(settings)} aria-hidden />
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="board-bg-color" className="field-label">Farbe</label>
          <ColorPicker id="board-bg-color" value={color ?? DEFAULT_COLOR} onChange={pickColor} />
        </div>
        <div>
          <span className="field-label">Eigenes Bild</span>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={inputRef} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Upload size={15} /> {busy ? 'Lädt hoch …' : imageAt ? 'Bild ersetzen' : 'Bild hochladen'}
            </button>
            {hasCustom && (
              <button type="button" className="btn-text" onClick={() => void reset()}>
                <Trash2 size={15} /> Standard wiederherstellen
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-text-2">Wird automatisch auf Full HD verkleinert und als WebP gespeichert.</p>
        </div>
      </div>
    </section>
  )
}

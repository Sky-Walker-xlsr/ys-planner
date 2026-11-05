// Empfang von Dateien über «Direkt teilen» (identisch in ys-share: src/shared/receiver.ts).
//
// Alles, was das Gegenüber über eine Datei behauptet, ist unzuverlässig: Kopfzeilen werden streng geprüft,
// es wird nie mehr angenommen als angekündigt, und unvollständige Dateien gelten nicht als empfangen.

/** Nur diese Rasterbilder bekommen eine Vorschau und ihren Typ. SVG/HTML nie: Sie könnten Code im Ursprung ausführen. */
export function isPreviewableImageMime(mime: unknown): mime is string {
  return typeof mime === 'string' && /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(mime)
}

/** Typ für den Blob einer empfangenen Datei: alles ausser Rasterbildern als reine Bytes */
export function safeBlobType(mime: unknown): string {
  return isPreviewableImageMime(mime) ? mime : 'application/octet-stream'
}

export type FailReason = 'aborted' | 'incomplete' | 'too-large' | 'replaced'

export type ReceiverEvent =
  | { type: 'start'; id: string; name: string; size: number; mime: string; at: string }
  | { type: 'progress'; id: string; received: number }
  | { type: 'complete'; id: string; received: number; parts: Uint8Array[]; mime: string }
  | { type: 'failed'; id: string; reason: FailReason }
  /** Protokollverstoss (mehr Bytes als angekündigt oder insgesamt zu viel): Die Session beenden */
  | { type: 'limit' }

type Current = { id: string; size: number; mime: string; parts: Uint8Array[]; received: number; lastUi: number }

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null)

export class FileReceiver {
  private cur: Current | null = null
  private total = 0
  /** IDs bereits angekündigter Dateien: Eine wiederverwendete ID könnte frühere Einträge überschreiben */
  private seen = new Set<string>()

  constructor(
    private readonly maxFileBytes: number,
    private readonly maxTotalBytes = Number.POSITIVE_INFINITY,
    private readonly progressEveryMs = 150,
  ) {}

  /** Läuft gerade ein Empfang? */
  get active() {
    return this.cur !== null
  }

  /** Neue Datei angekündigt. Ein offener Empfang gilt als abgebrochen («replaced»). */
  header(m: { id?: unknown; name?: unknown; size?: unknown; mime?: unknown; at?: unknown }): ReceiverEvent[] {
    const events: ReceiverEvent[] = []
    if (this.cur) {
      events.push({ type: 'failed', id: this.cur.id, reason: 'replaced' })
      this.cur = null
    }
    const id = str(m.id, 100)
    const size = m.size
    if (!id || this.seen.has(id) || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return events
    if (size > this.maxFileBytes) return events
    const mime = safeBlobType(m.mime)
    const name = (str(m.name, 1000) ?? '').slice(0, 255) || 'Datei'
    const at = str(m.at, 40) ?? new Date().toISOString()
    this.seen.add(id)
    this.cur = { id, size, mime, parts: [], received: 0, lastUi: 0 }
    events.push({ type: 'start', id, name, size, mime, at })
    return events
  }

  /** Datenstück der laufenden Datei. Ohne laufenden Empfang wird es verworfen. */
  chunk(data: Uint8Array, now = Date.now()): ReceiverEvent[] {
    const cur = this.cur
    if (!cur) return []
    cur.received += data.byteLength
    this.total += data.byteLength
    if (this.total > this.maxTotalBytes) {
      this.cur = null
      return [{ type: 'failed', id: cur.id, reason: 'too-large' }, { type: 'limit' }]
    }
    // Nie mehr annehmen als angekündigt: Das ist ein Protokollverstoss, die Session wird beendet
    if (cur.received > cur.size) {
      this.cur = null
      return [{ type: 'failed', id: cur.id, reason: 'too-large' }, { type: 'limit' }]
    }
    // Die Entschlüsselung liefert für jedes Stück einen frischen Puffer: keine zweite Kopie nötig
    cur.parts.push(data)
    if (now - cur.lastUi >= this.progressEveryMs) {
      cur.lastUi = now
      return [{ type: 'progress', id: cur.id, received: cur.received }]
    }
    return []
  }

  /** Ende der Datei. Fehlen Bytes, gilt sie als unvollständig und wird nicht angeboten. */
  end(id: unknown): ReceiverEvent[] {
    const cur = this.cur
    if (!cur || cur.id !== id) return []
    this.cur = null
    if (cur.received !== cur.size) return [{ type: 'failed', id: cur.id, reason: 'incomplete' }]
    return [{ type: 'complete', id: cur.id, received: cur.received, parts: cur.parts, mime: cur.mime }]
  }

  /** Der Sender hat abgebrochen */
  abort(id: unknown): ReceiverEvent[] {
    const cur = this.cur
    if (!cur || cur.id !== id) return []
    this.cur = null
    return [{ type: 'failed', id: cur.id, reason: 'aborted' }]
  }

  /** Verbindung weg: offenen Empfang abschliessen */
  close(): ReceiverEvent[] {
    const cur = this.cur
    this.cur = null
    return cur ? [{ type: 'failed', id: cur.id, reason: 'aborted' }] : []
  }
}

export const FAIL_LABEL: Record<FailReason, string> = {
  aborted: 'abgebrochen',
  incomplete: 'unvollständig, verworfen',
  'too-large': 'zu gross, verworfen',
  replaced: 'abgebrochen',
}

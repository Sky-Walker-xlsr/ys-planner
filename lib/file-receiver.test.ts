import { describe, expect, it } from 'vitest'
import { FileReceiver, isPreviewableImageMime, safeBlobType } from './file-receiver'

const bytes = (n: number) => new Uint8Array(n).fill(1)
const header = (id: string, size: unknown, extra: Record<string, unknown> = {}) => ({ id, name: 'a.bin', size, mime: 'application/pdf', at: '2026-11-05T10:00:00Z', ...extra })

describe('Bildtypen', () => {
  it('nur Rasterbilder behalten ihren Typ', () => {
    expect(isPreviewableImageMime('image/png')).toBe(true)
    expect(isPreviewableImageMime('image/svg+xml')).toBe(false)
    expect(isPreviewableImageMime(42)).toBe(false)
    expect(safeBlobType('text/html')).toBe('application/octet-stream')
    expect(safeBlobType('image/jpeg')).toBe('image/jpeg')
  })
})

describe('FileReceiver', () => {
  it('empfängt eine vollständige Datei', () => {
    const r = new FileReceiver(100)
    expect(r.header(header('a', 5))[0]).toMatchObject({ type: 'start', id: 'a', size: 5, mime: 'application/octet-stream' })
    r.chunk(bytes(3), 0)
    r.chunk(bytes(2), 1)
    const [ev] = r.end('a')
    expect(ev).toMatchObject({ type: 'complete', received: 5 })
    expect(r.active).toBe(false)
  })

  it('unvollständige Datei wird verworfen statt als empfangen angezeigt', () => {
    const r = new FileReceiver(100)
    r.header(header('a', 5))
    r.chunk(bytes(3))
    expect(r.end('a')).toEqual([{ type: 'failed', id: 'a', reason: 'incomplete' }])
  })

  it('mehr Bytes als angekündigt brechen ab', () => {
    const r = new FileReceiver(100)
    r.header(header('a', 1))
    expect(r.chunk(bytes(2))).toEqual([{ type: 'failed', id: 'a', reason: 'too-large' }, { type: 'limit' }])
    expect(r.chunk(bytes(2))).toEqual([]) // weitere Stücke landen nirgends
  })

  it('neue Kopfzeile schliesst offenen Empfang als abgebrochen ab', () => {
    const r = new FileReceiver(100)
    r.header(header('a', 5))
    const ev = r.header(header('b', 5))
    expect(ev[0]).toEqual({ type: 'failed', id: 'a', reason: 'replaced' })
    expect(ev[1]).toMatchObject({ type: 'start', id: 'b' })
  })

  it('abgelehnte Kopfzeile lässt Stücke nicht in die vorherige Datei laufen', () => {
    const r = new FileReceiver(100)
    r.header(header('a', 5))
    expect(r.header(header('b', 1000))).toEqual([{ type: 'failed', id: 'a', reason: 'replaced' }])
    expect(r.chunk(bytes(3))).toEqual([])
    expect(r.end('a')).toEqual([])
  })

  it('lehnt ungültige Grössen und IDs ab', () => {
    const r = new FileReceiver(100)
    for (const size of ['5', undefined, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) expect(r.header(header('a', size))).toEqual([])
    expect(r.header({ id: 7, size: 1 })).toEqual([])
    expect(r.header(header('x'.repeat(101), 1))).toEqual([])
  })

  it('Gesamtlimit beendet die Session', () => {
    const r = new FileReceiver(100, 4)
    r.header(header('a', 10))
    expect(r.chunk(bytes(5))).toEqual([{ type: 'failed', id: 'a', reason: 'too-large' }, { type: 'limit' }])
  })

  it('Abbruch durch den Sender', () => {
    const r = new FileReceiver(100)
    r.header(header('a', 5))
    expect(r.abort('b')).toEqual([])
    expect(r.abort('a')).toEqual([{ type: 'failed', id: 'a', reason: 'aborted' }])
  })

  it('kürzt Namen und setzt Standardnamen', () => {
    const r = new FileReceiver(100)
    expect(r.header(header('a', 1, { name: 'x'.repeat(300) }))[0]).toMatchObject({ name: 'x'.repeat(255) })
    expect(r.header(header('b', 1, { name: 42 }))[1]).toMatchObject({ name: 'Datei' })
  })

  it('lehnt wiederverwendete IDs ab', () => {
    const r = new FileReceiver(100)
    r.header(header('a', 1))
    r.chunk(bytes(1))
    r.end('a')
    expect(r.header(header('a', 1))).toEqual([])
  })
})

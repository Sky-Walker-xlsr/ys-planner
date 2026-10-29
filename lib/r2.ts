import 'server-only'
import { getCloudflareContext } from '@opennextjs/cloudflare'

// Schlanke Sicht auf das R2-Binding (die vollständigen Workers-Runtime-Typen kollidieren mit den DOM-Typen).
export type R2Object = {
  key: string
  size: number
  httpMetadata?: { contentType?: string }
  body: ReadableStream
  text(): Promise<string>
}
export type R2Bucket = {
  get(key: string): Promise<R2Object | null>
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  delete(keys: string | string[]): Promise<void>
  list(options?: { prefix?: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>
}

export function filesBucket(): R2Bucket {
  return getCloudflareContext().env.FILES as unknown as R2Bucket
}

// Schlüssel (siehe wrangler.toml). Die DB-Trigger setzen storage_path identisch.
export const kbKey = (plannerId: string, fileId: string) => `kb/${plannerId}/${fileId}.md`

/**
 * Löscht Objekte nach dem Löschen der DB-Zeilen (R2 erlaubt max. 1000 Schlüssel pro Aufruf).
 * Fehler werden nur geloggt: die Zeilen sind dann schon weg, übrig bleibt höchstens ein verwaistes Objekt.
 */
export async function deleteKeys(keys: string[]) {
  try {
    const bucket = filesBucket()
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000)
      if (chunk.length) await bucket.delete(chunk)
    }
  } catch (e) {
    console.error('R2-Löschen fehlgeschlagen', keys, e)
  }
}

const INLINE_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/avif'])

/**
 * Liefert ein Objekt aus. Die Dateien kommen von derselben Origin wie die App: alles ausser
 * Rasterbildern wird als Download ausgeliefert, und CSP/nosniff verhindern Script-Ausführung.
 */
export function objectResponse(obj: R2Object, opts: { name: string; mime: string; download?: boolean }) {
  const inline = !opts.download && INLINE_TYPES.has(opts.mime)
  const encoded = encodeURIComponent(opts.name)
  return new Response(obj.body, {
    headers: {
      'Content-Type': INLINE_TYPES.has(opts.mime) || opts.mime === 'text/markdown' ? opts.mime : 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=60',
    },
  })
}

// Bilder vor dem Upload auf max. Full HD verkleinern und als WebP kodieren.
// Hochformat wird gedreht behandelt (max. 1080 × 1920); kleinere Bilder werden nicht vergrößert.
const LONG_EDGE = 1920
const SHORT_EDGE = 1080
const QUALITY = 0.82

/** Rasterbilder, die konvertiert werden (SVG bleibt Vektor und wird als Datei hochgeladen). */
export function isImage(file: File) {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml'
}

export class ImageConversionError extends Error {}

export async function toWebp(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageConversionError('Bildformat wird von diesem Browser nicht unterstützt')
  }
  const landscape = bitmap.width >= bitmap.height
  const maxW = landscape ? LONG_EDGE : SHORT_EDGE
  const maxH = landscape ? SHORT_EDGE : LONG_EDGE
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageConversionError('Bild konnte nicht verarbeitet werden')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', QUALITY))
  // Browser ohne WebP-Encoder liefern stillschweigend PNG
  if (!blob || blob.type !== 'image/webp') {
    throw new ImageConversionError('Dieser Browser kann kein WebP erzeugen')
  }
  const base = file.name.replace(/\.[^.]+$/, '') || 'Bild'
  return new File([blob], `${base}.webp`, { type: 'image/webp' })
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

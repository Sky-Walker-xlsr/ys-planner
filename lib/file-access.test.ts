import { describe, expect, it } from 'vitest'
import { isWebp } from './file-access'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('isWebp', () => {
  it('erkennt den WebP-Header', () => {
    expect(isWebp(bytes('RIFF\0\0\0\0WEBPVP8 '))).toBe(true)
  })

  it('lehnt andere Inhalte ab, auch mit RIFF-Anfang', () => {
    expect(isWebp(bytes('<svg onload="x"></svg>'))).toBe(false)
    expect(isWebp(bytes('RIFF\0\0\0\0WAVEfmt '))).toBe(false)
    expect(isWebp(bytes('RIFF'))).toBe(false)
  })
})

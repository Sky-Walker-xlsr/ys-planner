import { describe, expect, it } from 'vitest'
import {
  decryptFrame, deriveSharedKey, encryptFrame, exportPublicKey, FRAME_CHUNK, generateKeys, newSessionId, normalizeRoom,
  roomSessionId, safetyCode, SESSION_ID,
} from './direct-share'

describe('direct-share', () => {
  it('erzeugt Session-IDs im erlaubten Format', () => {
    const id = newSessionId()
    expect(id).toMatch(SESSION_ID)
    expect(newSessionId()).not.toBe(id)
  })

  it('leitet aus gleichem Raumnamen dieselbe Session-ID ab', async () => {
    const a = await roomSessionId('Blaue Giraffe')
    expect(a).toMatch(SESSION_ID)
    expect(await roomSessionId('  blaue   giraffe ')).toBe(a)
    expect(await roomSessionId('blaue giraffe 2')).not.toBe(a)
    expect(normalizeRoom('  A  B ')).toBe('a b')
  })

  it('verschlüsselt Ende-zu-Ende: beide Seiten leiten denselben Schlüssel ab', async () => {
    const [alice, bob] = await Promise.all([generateKeys(), generateKeys()])
    const [pubA, pubB] = await Promise.all([exportPublicKey(alice), exportPublicKey(bob)])
    const [keyA, keyB] = await Promise.all([deriveSharedKey(alice, pubB), deriveSharedKey(bob, pubA)])
    const data = new Uint8Array([1, 2, 3, 250])
    const frame = await encryptFrame(keyA, FRAME_CHUNK, data)
    const out = await decryptFrame(keyB, frame)
    expect(out.kind).toBe(FRAME_CHUNK)
    expect([...out.data]).toEqual([...data])
    // Fremder Schlüssel kann nicht entschlüsseln
    const eve = await generateKeys()
    const keyE = await deriveSharedKey(eve, pubA)
    await expect(decryptFrame(keyE, frame)).rejects.toThrow()
    // Prüfcode ist auf beiden Seiten gleich
    expect(await safetyCode(pubA, pubB)).toBe(await safetyCode(pubB, pubA))
  })
})

describe('Relay: Textnachrichten der Browser', async () => {
  const { sanitizePeerText } = await import('./direct-share')
  it('lässt nur key, accept und reject durch und verwirft gefälschte Server-Nachrichten', () => {
    expect(sanitizePeerText('{"type":"accept","x":1}')).toBe('{"type":"accept"}')
    for (const m of ['{"type":"peer","name":"Chef","uid":"x","first":true}', '{"type":"waiting"}', '{"type":"peer-left"}', 'kaputt', '{"type":"key","key":"<b>"}']) {
      expect(sanitizePeerText(m)).toBeNull()
    }
  })
})

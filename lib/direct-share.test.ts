import { describe, expect, it } from 'vitest'
import { chunkSize, newSessionId, orderedGuests, SESSION_ID, type PresenceMeta } from './direct-share'

const meta = (role: PresenceMeta['role'], joinedAt: number): PresenceMeta => ({ name: 'x', color: '#000', role, joinedAt })

describe('direct-share', () => {
  it('erzeugt Session-IDs im erlaubten Format', () => {
    const id = newSessionId()
    expect(id).toMatch(SESSION_ID)
    expect(newSessionId()).not.toBe(id)
  })

  it('ordnet nur Gäste nach Beitritt, der Host zählt nicht', () => {
    const list = orderedGuests([
      { key: 'b', meta: meta('guest', 20) },
      { key: 'h', meta: meta('host', 1) },
      { key: 'a', meta: meta('guest', 10) },
    ])
    expect(list.map((e) => e.key)).toEqual(['a', 'b'])
  })

  it('löst Gleichstand beim Beitritt über den Schlüssel auf', () => {
    expect(orderedGuests([{ key: 'z', meta: meta('guest', 5) }, { key: 'y', meta: meta('guest', 5) }])[0].key).toBe('y')
  })

  it('wählt die Chunk-Grösse nach der Gegenseite', () => {
    expect(chunkSize(262144)).toBe(65536)
    expect(chunkSize(16384)).toBe(16384)
    expect(chunkSize(null)).toBe(16384)
  })
})

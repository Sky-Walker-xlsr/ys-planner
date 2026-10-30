import { describe, expect, it } from 'vitest'
import { groupByAddress } from './notify-groups'

describe('groupByAddress', () => {
  const items = [{ plannerId: 'firma', t: 1 }, { plannerId: 'privat', t: 2 }, { plannerId: 'firma', t: 3 }]

  it('trennt Einträge mit eigener Ordner-Adresse ab', () => {
    const groups = groupByAddress(items, 'ich@privat.ch', (p) => (p === 'firma' ? 'ich@firma.ch' : undefined))
    expect(groups.get('ich@firma.ch')?.map((i) => i.t)).toEqual([1, 3])
    expect(groups.get('ich@privat.ch')?.map((i) => i.t)).toEqual([2])
  })

  it('bündelt alles, wenn es keine eigene Adresse gibt', () => {
    const groups = groupByAddress(items, 'ich@privat.ch', () => undefined)
    expect([...groups.keys()]).toEqual(['ich@privat.ch'])
    expect(groups.get('ich@privat.ch')).toHaveLength(3)
  })
})

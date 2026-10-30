import { describe, expect, it } from 'vitest'
import { dueMail, groupByAddress } from './notify-groups'

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

describe('dueMail', () => {
  const dates = { today: '30.10.2026', tomorrow: '31.10.2026' }
  const today = { title: 'Rechnung', when: 'today' as const }
  const tomorrow = { title: 'Offerte', when: 'tomorrow' as const }

  it('nennt einen heute fälligen Eintrag beim Namen', () => {
    const m = dueMail([today], dates)
    expect(m.subject).toBe('Heute fällig: Rechnung')
    expect(m.heading).toBe('Heute fällig (30.10.2026)')
  })

  it('bleibt für morgen wie bisher', () => {
    const m = dueMail([tomorrow, { ...tomorrow, title: 'B' }], dates)
    expect(m.subject).toBe('Morgen fällig: 2 Einträge')
    expect(m.heading).toBe('Morgen fällig (31.10.2026)')
  })

  it('bündelt beides und stellt heute voran', () => {
    const m = dueMail([tomorrow, today], dates)
    expect(m.subject).toBe('Fällig: 1 heute, 1 morgen')
    expect(m.items.map((i) => i.title)).toEqual(['Rechnung', 'Offerte'])
  })
})

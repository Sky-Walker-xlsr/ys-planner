import { describe, expect, it } from 'vitest'
import { highlight, markdownToPlain, searchDocuments } from './search'

const docs = [
  { item: 'a', name: 'Sitemap.md', content: '# Sitemap\n\nStartseite, **Über uns**, Kontakt und das [Impressum](https://x.ch).' },
  { item: 'b', name: 'Brief an Kunden.md', content: 'Grüsse aus Zürich. Die Strasse wird ab Montag gesperrt.' },
  { item: 'c', name: 'Über-Notizen.md', content: 'Nichts Besonderes.' },
]

const hits = (segs: { text: string; hit: boolean }[] | null) => (segs ?? []).filter((s) => s.hit).map((s) => s.text)

describe('Knowledge-Base-Suche', () => {
  it('findet Stichworte im Inhalt, ohne Akzente und Gross/Klein', () => {
    const r = searchDocuments('zurich', docs)
    expect(r.map((x) => x.item)).toEqual(['b'])
    expect(hits(r[0].snippet)).toEqual(['Zürich'])
  })

  it('ß und ss sind gleich', () => {
    expect(searchDocuments('straße', docs).map((x) => x.item)).toEqual(['b'])
  })

  it('Treffer im Namen zählen mehr', () => {
    expect(searchDocuments('über', docs).map((x) => x.item)).toEqual(['c', 'a'])
  })

  it('alle Begriffe müssen vorkommen (Name oder Inhalt)', () => {
    expect(searchDocuments('sitemap kontakt', docs).map((x) => x.item)).toEqual(['a'])
    expect(searchDocuments('sitemap zürich', docs)).toHaveLength(0)
  })

  it('Ausschnitt ohne Markdown-Syntax', () => {
    const r = searchDocuments('impressum', docs)
    expect(r[0].snippet!.map((s) => s.text).join('')).not.toContain('](')
  })

  it('ohne geladenen Inhalt nur Namenssuche', () => {
    expect(searchDocuments('brief', [{ item: 'x', name: 'Brief.md' }])[0]).toMatchObject({ item: 'x', snippet: null })
  })
})

describe('Markierung', () => {
  it('markiert mehrere Begriffe im Original', () => {
    expect(hits(highlight('Grüsse aus Zürich', ['grusse', 'zurich']))).toEqual(['Grüsse', 'Zürich'])
  })
  it('Markdown → Text', () => {
    expect(markdownToPlain('## Titel\n- **fett** und `code`')).toBe('Titel fett und code')
  })
})

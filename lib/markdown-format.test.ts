import { describe, expect, it } from 'vitest'
import { applyFormat, markMentions } from './markdown-format'

describe('applyFormat', () => {
  it('umschliesst die Auswahl und behält sie ausgewählt', () => {
    const r = applyFormat('ein Wort hier', 4, 8, 'bold')
    expect(r.value).toBe('ein **Wort** hier')
    expect(r.value.slice(r.start, r.end)).toBe('Wort')
  })

  it('entfernt ein vorhandenes Format', () => {
    const r = applyFormat('ein **Wort** hier', 6, 10, 'bold')
    expect(r.value).toBe('ein Wort hier')
    expect(r.value.slice(r.start, r.end)).toBe('Wort')
  })

  it('setzt ohne Auswahl den Cursor zwischen die Zeichen', () => {
    const r = applyFormat('', 0, 0, 'italic')
    expect(r).toEqual({ value: '**', start: 1, end: 1 })
  })

  it('wählt bei Links die Adresse aus', () => {
    const r = applyFormat('siehe hier', 6, 10, 'link')
    expect(r.value).toBe('siehe [hier](https://)')
    expect(r.value.slice(r.start, r.end)).toBe('https://')
  })

  it('macht aus allen ausgewählten Zeilen eine Liste', () => {
    expect(applyFormat('a\nb\nc', 0, 3, 'ul').value).toBe('- a\n- b\nc')
    expect(applyFormat('a\nb', 0, 3, 'ol').value).toBe('1. a\n2. b')
    expect(applyFormat('a', 0, 1, 'todo').value).toBe('- [ ] a')
  })

  it('wirkt auf die ganze Zeile, auch ohne Auswahl', () => {
    expect(applyFormat('x\nTitel\ny', 4, 4, 'heading').value).toBe('x\n## Titel\ny')
  })

  it('entfernt ein Zeilen-Format wieder', () => {
    expect(applyFormat('- a\n- b', 0, 7, 'ul').value).toBe('a\nb')
  })
})

describe('markMentions', () => {
  it('markiert genannte Personen, längere Namen zuerst', () => {
    expect(markMentions('Hallo @Anna Muster und @Anna', ['Anna', 'Anna Muster'])).toBe('Hallo [@Anna Muster](mention:) und [@Anna](mention:)')
  })

  it('lässt Text ohne Namen unverändert und deutet Sonderzeichen nicht als Muster', () => {
    expect(markMentions('@Anna', [])).toBe('@Anna')
    expect(markMentions('@A.B und @AxB', ['A.B'])).toBe('[@A.B](mention:) und @AxB')
  })
})

import { describe, expect, it } from 'vitest'
import { addMonths, monthGrid, monthRange, monthStart } from './dates'

describe('monthStart', () => {
  it('liefert den Monatsersten', () => {
    expect(monthStart('2026-10-30')).toBe('2026-10-01')
  })
})

describe('addMonths', () => {
  it('rechnet über Jahresgrenzen', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
  })
})

describe('monthRange', () => {
  it('enthält beide Enden', () => {
    expect(monthRange('2026-11-01', '2027-01-01')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01'])
  })
})

describe('monthGrid', () => {
  it('rückt den ersten Tag auf den Wochentag ein (Woche beginnt am Montag)', () => {
    // 1. Oktober 2026 ist ein Donnerstag, 1. Juni 2026 ein Montag, 1. November 2026 ein Sonntag
    expect(monthGrid('2026-10-01').leading).toBe(3)
    expect(monthGrid('2026-06-01').leading).toBe(0)
    expect(monthGrid('2026-11-01').leading).toBe(6)
  })

  it('enthält genau die Tage des Monats', () => {
    const { days } = monthGrid('2028-02-01')
    expect(days).toHaveLength(29)
    expect(days[0]).toBe('2028-02-01')
    expect(days[28]).toBe('2028-02-29')
  })
})

import { describe, expect, it } from 'vitest'
import { PLANNER_COLORS, textOnColor } from './design'

describe('textOnColor', () => {
  it('bleibt weiss auf allen vorgeschlagenen Farben', () => {
    for (const c of PLANNER_COLORS) expect(textOnColor(c)).toBe('#FFFFFF')
  })

  it('wird dunkel auf hellen Farben', () => {
    expect(textOnColor('#ffffff')).toBe('#1B1D21')
    expect(textOnColor('#ffee00')).toBe('#1B1D21')
  })

  it('bleibt weiss auf Schwarz', () => {
    expect(textOnColor('#000000')).toBe('#FFFFFF')
  })
})

export const LABEL_COLORS = ['blue', 'violet', 'orange', 'pink', 'teal', 'yellow'] as const
export type LabelColor = (typeof LABEL_COLORS)[number]

export const LABEL_COLOR_NAMES: Record<LabelColor, string> = {
  blue: 'Blau',
  violet: 'Violett',
  orange: 'Orange',
  pink: 'Pink',
  teal: 'Türkis',
  yellow: 'Gelb',
}

export function labelStyle(color: string): React.CSSProperties {
  return { background: `var(--label-${color}-bg)`, color: `var(--label-${color}-fg)` }
}

export const PLANNER_COLORS = ['#1F7A57', '#2563EB', '#7C3AED', '#C2410C', '#BE185D', '#0F766E', '#A16207', '#475569']

/** Lesbare Schriftfarbe auf einer frei gewählten Hintergrundfarbe (WCAG-Luminanz) */
export function textOnColor(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#1B1D21' : '#FFFFFF'
}

export const AVATAR_COLORS = ['#1F7A57', '#2563EB', '#7C3AED', '#C2410C', '#BE185D', '#0F766E', '#A16207', '#475569']

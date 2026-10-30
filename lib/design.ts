/** Vorschläge für neue Labels; jede andere Hex-Farbe ist ebenfalls möglich */
export const LABEL_COLORS = [
  '#DC2626', '#EA580C', '#D97706', '#CA8A04', '#65A30D', '#16A34A', '#059669', '#0D9488',
  '#0891B2', '#0284C7', '#2563EB', '#4F46E5', '#7C3AED', '#9333EA', '#C026D3', '#DB2777',
  '#E11D48', '#78716C', '#475569', '#1F2937',
]

/** Bestehende Labels haben teils benannte Farben (blue, violet, …), die dem Theme folgen */
export function labelStyle(color: string): React.CSSProperties {
  if (color.startsWith('#')) return { background: color, color: textOnColor(color) }
  return { background: `var(--label-${color}-bg)`, color: `var(--label-${color}-fg)` }
}

/** Persönlicher Board-Hintergrund: Bild vor Farbe, ohne beides das Standard-Design */
export function boardBackgroundStyle(s: { board_bg_color: string | null; board_bg_image_at: string | null } | null): React.CSSProperties {
  if (s?.board_bg_image_at) {
    return {
      backgroundImage: `url("/api/settings/board-background?v=${encodeURIComponent(s.board_bg_image_at)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    }
  }
  return s?.board_bg_color ? { background: s.board_bg_color } : {}
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

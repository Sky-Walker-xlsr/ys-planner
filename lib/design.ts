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

export const AVATAR_COLORS = ['#1F7A57', '#2563EB', '#7C3AED', '#C2410C', '#BE185D', '#0F766E', '#A16207', '#475569']

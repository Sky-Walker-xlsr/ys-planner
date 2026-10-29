import { Logo, type LogoVariant } from './Logo'

/** Logo + «ys-planner» (Inter 700, 17 px, −0.01em, Abstand 10 px, Theme-Textfarbe) */
export function Wordmark({ size = 30, variant = 'auto' }: { size?: number; variant?: LogoVariant }) {
  return (
    <span className="inline-flex items-center gap-[10px]">
      <Logo size={size} variant={variant} />
      <span className="text-[17px] font-bold tracking-[-0.01em] text-text">ys-planner</span>
    </span>
  )
}

// Logo «Zusammenfluss». Quellen: public/brand/logo.svg, logo-dark.svg, logo-small.svg (viewBox 96×96).
// auto: folgt dem App-Theme (Klasse .dark aus user_settings). Unter 32 px: Klein-Variante ohne Punkte.

const MARK = 'M26 28l22 26 22-26M48 54v16'

export type LogoVariant = 'auto' | 'light' | 'dark'

export function Logo({ size = 30, variant = 'auto', className }: { size?: number; variant?: LogoVariant; className?: string }) {
  const common = { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 96 96', width: size, height: size, role: 'img', 'aria-label': 'ys-planner', className }

  if (size < 32) {
    return (
      <svg {...common}>
        <rect width="96" height="96" rx="22" fill="#1F7A57" />
        <path d={MARK} fill="none" stroke="#FFFFFF" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  if (variant === 'auto') {
    return (
      <svg {...common}>
        <rect width="96" height="96" rx="22" className="fill-[#1F7A57] dark:fill-[#15171A]" />
        <path d={MARK} fill="none" className="stroke-[#FFFFFF] dark:stroke-[#4CC38A]" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="26" cy="28" r="6" className="fill-[#E3F2EB] dark:fill-[#7AD6A8]" />
        <circle cx="70" cy="28" r="6" className="fill-[#E3F2EB] dark:fill-[#7AD6A8]" />
      </svg>
    )
  }

  const dark = variant === 'dark'
  return (
    <svg {...common}>
      <rect width="96" height="96" rx="22" fill={dark ? '#15171A' : '#1F7A57'} />
      <path d={MARK} fill="none" stroke={dark ? '#4CC38A' : '#FFFFFF'} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="26" cy="28" r="6" fill={dark ? '#7AD6A8' : '#E3F2EB'} />
      <circle cx="70" cy="28" r="6" fill={dark ? '#7AD6A8' : '#E3F2EB'} />
    </svg>
  )
}

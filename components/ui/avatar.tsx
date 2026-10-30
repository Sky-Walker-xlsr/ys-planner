import { textOnColor } from '@/lib/design'
import type { User } from '@/lib/types'

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function shortName(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name
}

export function Avatar({
  name,
  color = '#5F6670',
  size = 24,
  title,
  className = '',
}: {
  name: string
  color?: string
  size?: number
  title?: string
  className?: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none ${className}`}
      style={{ width: size, height: size, background: color, fontSize: Math.max(9, Math.round(size * 0.4)) }}
      title={title ?? name}
      aria-label={title ?? name}
    >
      {initials(name)}
    </span>
  )
}

export function UserAvatar({ user, size = 24, className }: { user: User | undefined; size?: number; className?: string }) {
  if (!user) return <Avatar name="?" size={size} className={className} />
  return <Avatar name={user.display_name} color={user.avatar_color} size={size} className={className} />
}

export function AvatarStack({ users, max = 4, size = 28 }: { users: User[]; max?: number; size?: number }) {
  const shown = users.slice(0, max)
  const rest = users.length - shown.length
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((u) => (
        <UserAvatar key={u.id} user={u} size={size} className="ring-2 ring-surface" />
      ))}
      {rest > 0 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-bg text-text-2 text-xs font-medium ring-2 ring-surface border border-line"
          style={{ width: size, height: size }}
          title={`${rest} weitere`}
        >
          +{rest}
        </span>
      )}
    </div>
  )
}

export function PlannerIcon({ name, color, size = 20 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold"
      style={{ width: size, height: size, background: color, color: textOnColor(color), fontSize: Math.round(size * 0.5) }}
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

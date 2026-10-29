'use client'
import { useEffect, useRef, useState } from 'react'
import { labelStyle } from '@/lib/design'
import type { TaskPriority } from '@/lib/types'
import { PRIORITY_LABEL } from '@/lib/types'

export function Switch({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  id?: string
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm" htmlFor={id}>
      <span>{label}</span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-accent' : 'bg-line'
        }`}
      >
        <span
          className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-[6px] px-3 text-sm font-medium transition-colors cursor-pointer ${
            value === o.value ? 'bg-surface text-text shadow-sm' : 'text-text-2 hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function LabelPill({ name, color, onRemove }: { name: string; color: string; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={labelStyle(color)}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Label ${name} entfernen`} className="cursor-pointer opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </span>
  )
}

export function PrioritySquare({ priority, size = 8 }: { priority: TaskPriority; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-[2px]"
      style={{ width: size, height: size, background: `var(--prio-${priority})` }}
      aria-hidden
    />
  )
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const strong = priority === 'urgent' || priority === 'important'
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${strong ? 'font-medium text-text' : 'text-text-2'}`}>
      <PrioritySquare priority={priority} />
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Popover mit Klick-ausserhalb- und Escape-Schliessen */
export function Popover({
  trigger,
  children,
  align = 'left',
  width = 240,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
  align?: 'left' | 'right'
  width?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [innerOpen, setInnerOpen] = useState(false)
  const open = controlledOpen ?? innerOpen
  const setOpen = (v: boolean) => {
    setInnerOpen(v)
    onOpenChange?.(v)
  }
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  })

  const close = () => setOpen(false)
  return (
    <div ref={ref} className="relative inline-block">
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && (
        <div
          className={`card absolute z-40 mt-1 p-1.5 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ width }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  onClick,
  children,
  danger,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg disabled:opacity-50 cursor-pointer ${
        danger ? 'text-danger' : 'text-text'
      }`}
    >
      {children}
    </button>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-bg">
      <input
        type="checkbox"
        className="size-4 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 flex-1">{label}</span>
    </label>
  )
}

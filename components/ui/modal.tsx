'use client'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 560,
  header,
  bodyClassName = 'p-5',
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subtitle?: React.ReactNode
  children: React.ReactNode
  maxWidth?: number
  header?: React.ReactNode
  bodyClassName?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  // onClose ist meist bei jedem Rendern eine neue Funktion. Hinge der Effekt davon ab, würde er bei
  // jedem Neu-Rendern (z. B. durch das Aktualisieren der Daten) den Fokus aus dem Eingabefeld holen.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="w-full rounded-dialog bg-surface border border-line shadow-2xl outline-none my-auto"
        style={{ maxWidth }}
      >
        {header ?? (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-text-2">{subtitle}</p>}
            </div>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="Schliessen">
              <X size={18} />
            </button>
          </div>
        )}
        <div className={bodyClassName}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

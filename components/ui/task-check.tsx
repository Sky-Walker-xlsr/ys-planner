'use client'
import { Check } from 'lucide-react'
import type { TaskStatus } from '@/lib/types'

/** Abhaken wechselt zwischen «Erledigt» und «Nicht begonnen» */
export const toggledStatus = (status: TaskStatus): TaskStatus => (status === 'done' ? 'not_started' : 'done')

/** Runde Checkbox links vom Task-Titel. Der Klick öffnet weder den Task noch folgt er dem Link der Zeile. */
export function TaskCheck({ title, done, disabled, onToggle }: { title: string; done: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`${title} erledigt`}
      title={done ? 'Wieder öffnen' : 'Als erledigt markieren'}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`flex size-[18px] shrink-0 items-center justify-center rounded-full border cursor-pointer disabled:cursor-default ${
        done ? 'border-accent bg-accent text-on-accent' : 'border-text-2 hover:border-accent'
      }`}
    >
      {done && <Check size={12} strokeWidth={3} />}
    </button>
  )
}

'use client'
import { useState } from 'react'
import { Plus } from 'lucide-react'

/** «+ Aufgabe hinzufügen» – gestrichelter Button, wird zum Eingabefeld */
export function AddTaskInline({ onAdd, compact = false }: { onAdd: (title: string) => Promise<unknown> | void; compact?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')

  async function submit() {
    const t = title.trim()
    if (!t) {
      setEditing(false)
      return
    }
    setTitle('')
    await onAdd(t)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`flex w-full items-center gap-1.5 rounded-md border border-dashed border-line text-sm text-text-2 hover:border-accent hover:text-accent cursor-pointer ${
          compact ? 'px-2 py-1' : 'px-3 py-2'
        }`}
      >
        <Plus size={15} /> Aufgabe hinzufügen
      </button>
    )
  }
  return (
    <input
      className="input"
      autoFocus
      placeholder="Titel eingeben und Enter drücken"
      aria-label="Titel der neuen Aufgabe"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => void submit().then(() => setEditing(false))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void submit()
        if (e.key === 'Escape') {
          setTitle('')
          setEditing(false)
        }
      }}
    />
  )
}

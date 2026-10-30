'use client'
import { useState } from 'react'
import { PLANNER_COLORS } from '@/lib/design'

const HEX = /^#[0-9a-f]{6}$/i

/** Vorschläge plus freie Wahl: Farbfeld des Browsers oder Hex-Wert von Hand */
export function ColorPicker({ id, value, onChange }: { id: string; value: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const current = value.toLowerCase()
  const invalid = draft !== null && !HEX.test(draft)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PLANNER_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Farbe ${c}`}
          aria-pressed={c.toLowerCase() === current}
          onClick={() => { setDraft(null); onChange(c) }}
          className={`size-7 rounded-md cursor-pointer ${c.toLowerCase() === current ? 'ring-2 ring-offset-2 ring-accent ring-offset-surface' : ''}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        aria-label="Beliebige Farbe wählen"
        title="Beliebige Farbe wählen"
        className="size-7 cursor-pointer rounded-md border border-line bg-transparent p-0"
        value={current}
        onChange={(e) => { setDraft(null); onChange(e.target.value) }}
      />
      <input
        id={id}
        className={`input w-24 font-mono ${invalid ? 'border-danger' : ''}`}
        aria-label="Farbe als Hex-Wert"
        aria-invalid={invalid}
        maxLength={7}
        spellCheck={false}
        value={draft ?? value}
        onChange={(e) => {
          const v = e.target.value.trim()
          const hex = v.startsWith('#') ? v : `#${v}`
          setDraft(hex)
          if (HEX.test(hex)) onChange(hex)
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  )
}

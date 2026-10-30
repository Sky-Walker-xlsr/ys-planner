'use client'
import { useEffect, useRef, useState, type RefObject } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { Bold, Code, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Quote, Strikethrough } from 'lucide-react'
import { applyFormat, markMentions, type FormatKind } from '@/lib/markdown-format'

const MENTION_URL = 'mention:'

/** Formatierter Text. Bilder bleiben aus: Fremde Bild-Adressen würden Mitglieder beim Lesen verraten. */
export function Markdown({ text, mentions = [] }: { text: string; mentions?: string[] }) {
  return (
    <div className="md-preview text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        disallowedElements={['img']}
        unwrapDisallowed
        urlTransform={(url) => (url === MENTION_URL ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) =>
            href === MENTION_URL ? (
              <span className="rounded bg-accent-soft px-0.5 font-medium text-accent-soft-text">{children}</span>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>{children}</a>
            ),
        }}
      >
        {markMentions(text, mentions)}
      </ReactMarkdown>
    </div>
  )
}

/**
 * Textfeld, das mit dem Inhalt wächst: Eine unsichtbare Kopie im selben Grid-Feld gibt die Höhe vor,
 * das Popup scrollt dann als Ganzes.
 */
export function GrowingTextarea({ className, mirrorStyle, ref, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string
  className: string
  ref?: React.Ref<HTMLTextAreaElement>
  /** Für .input: Die Klasse legt für Nicht-Textareas eine feste Höhe fest */
  mirrorStyle?: React.CSSProperties
}) {
  return (
    <div className="grid min-w-0">
      <div aria-hidden className={`${className} invisible whitespace-pre-wrap break-words [grid-area:1/1]`} style={mirrorStyle}>
        {props.value + '\n'}
      </div>
      <textarea {...props} ref={ref} className={`${className} resize-none overflow-hidden [grid-area:1/1]`} />
    </div>
  )
}

export const INPUT_MIRROR: React.CSSProperties = { height: 'auto', paddingBlock: '0.5rem' }

const BUTTONS: { kind: FormatKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'bold', label: 'Fett (Ctrl+B)', icon: <Bold size={14} /> },
  { kind: 'italic', label: 'Kursiv (Ctrl+I)', icon: <Italic size={14} /> },
  { kind: 'strike', label: 'Durchgestrichen', icon: <Strikethrough size={14} /> },
  { kind: 'heading', label: 'Überschrift', icon: <Heading2 size={14} /> },
  { kind: 'ul', label: 'Liste', icon: <List size={14} /> },
  { kind: 'ol', label: 'Nummerierte Liste', icon: <ListOrdered size={14} /> },
  { kind: 'todo', label: 'Checkliste', icon: <ListChecks size={14} /> },
  { kind: 'quote', label: 'Zitat', icon: <Quote size={14} /> },
  { kind: 'code', label: 'Code', icon: <Code size={14} /> },
  { kind: 'link', label: 'Link (Ctrl+K)', icon: <Link2 size={14} /> },
]

const SHORTCUTS: Record<string, FormatKind> = { b: 'bold', i: 'italic', k: 'link' }

function format(el: HTMLTextAreaElement | null, onChange: (value: string) => void, kind: FormatKind) {
  if (!el) return
  const r = applyFormat(el.value, el.selectionStart, el.selectionEnd, kind)
  onChange(r.value)
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(r.start, r.end)
  })
}

/** Ctrl/Cmd+B, I und K in einem Markdown-Feld; true, wenn die Taste verarbeitet wurde */
export function handleFormatShortcut(e: React.KeyboardEvent<HTMLTextAreaElement>, onChange: (value: string) => void) {
  const kind = e.ctrlKey || e.metaKey ? SHORTCUTS[e.key.toLowerCase()] : undefined
  if (!kind) return false
  e.preventDefault()
  format(e.currentTarget, onChange, kind)
  return true
}

export function FormatToolbar({ target, onChange }: { target: RefObject<HTMLTextAreaElement | null>; onChange: (value: string) => void }) {
  return (
    <div className="mb-1 flex flex-wrap gap-0.5" role="toolbar" aria-label="Formatierung">
      {BUTTONS.map((b) => (
        <button
          key={b.kind}
          type="button"
          className="btn-icon size-6"
          aria-label={b.label}
          title={b.label}
          // Der Fokus bleibt im Textfeld, sonst würde es speichern und sich schliessen
          onMouseDown={(e) => { e.preventDefault(); format(target.current, onChange, b.kind) }}
        >
          {b.icon}
        </button>
      ))}
    </div>
  )
}

/** Zeigt den formatierten Text; ein Klick öffnet die Bearbeitung mit Werkzeugleiste. Speichert beim Verlassen. */
export function RichTextField({ value, onSave, disabled, placeholder, label, id, rows = 1, boxed }: {
  value: string
  onSave: (value: string) => void
  disabled: boolean
  placeholder: string
  label: string
  id?: string
  rows?: number
  /** Mit Rahmen wie ein Eingabefeld (Task-Beschreibung) */
  boxed?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const editing = draft !== null

  // Cursor ans Ende, damit man direkt weiterschreiben kann
  useEffect(() => {
    if (!editing || !ref.current) return
    ref.current.focus()
    ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length)
  }, [editing])

  const box = boxed ? 'input min-h-24' : 'w-full rounded-md border border-transparent px-1 py-0.5 text-sm outline-none hover:border-line focus:border-accent'

  if (editing) {
    return (
      <div>
        <FormatToolbar target={ref} onChange={setDraft} />
        <GrowingTextarea
          id={id}
          ref={ref}
          aria-label={label}
          className={boxed ? box : `${box} bg-transparent`}
          mirrorStyle={boxed ? INPUT_MIRROR : undefined}
          rows={rows}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { handleFormatShortcut(e, setDraft) }}
          onBlur={() => {
            if (draft !== value) onSave(draft)
            setDraft(null)
          }}
        />
      </div>
    )
  }

  if (disabled) return value ? <div className="px-1"><Markdown text={value} /></div> : null

  return (
    <div
      id={id}
      role="button"
      tabIndex={0}
      aria-label={`${label} bearbeiten`}
      className={`${box} h-auto cursor-text`}
      style={boxed ? INPUT_MIRROR : undefined}
      onClick={() => setDraft(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); setDraft(value) }
      }}
    >
      {value ? <Markdown text={value} /> : <span className="text-sm text-text-2">{placeholder}</span>}
    </div>
  )
}

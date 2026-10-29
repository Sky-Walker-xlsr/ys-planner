'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { normalizeWithMap, searchTerms } from '@/lib/search'

// Suchen im Dokument (Ctrl/Cmd+F). Ist der Quelltext sichtbar (Bearbeiten/Geteilt), wird dort gesucht und
// navigiert – markiert über eine Ebene hinter der textarea (SourceHighlights). In der Vorschau markiert die
// CSS Custom Highlight API alle Treffer; im reinen Vorschau-Modus wird dort navigiert.

export type Match = { start: number; end: number }
export type SourceFind = { matches: Match[]; current: number } | null

const HL = 'kb-find'
const HL_CURRENT = 'kb-find-current'

function highlightsSupported() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS
}

function clearHighlights() {
  if (!highlightsSupported()) return
  CSS.highlights.delete(HL)
  CSS.highlights.delete(HL_CURRENT)
}

export function findInText(text: string, query: string): Match[] {
  const term = searchTerms(query).join(' ')
  if (!term) return []
  const { norm, map } = normalizeWithMap(text)
  const out: Match[] = []
  for (let at = norm.indexOf(term); at !== -1; at = norm.indexOf(term, at + term.length)) out.push({ start: map[at], end: map[at + term.length] })
  return out
}

function previewRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const m of findInText(node.textContent ?? '', query)) {
      const r = document.createRange()
      r.setStart(node, m.start)
      r.setEnd(node, m.end)
      ranges.push(r)
    }
  }
  return ranges
}

export function FindBar({
  open,
  initialQuery,
  onClose,
  previewRef,
  textareaRef,
  content,
  onSourceFind,
}: {
  open: boolean
  initialQuery: string
  onClose: () => void
  previewRef: RefObject<HTMLDivElement | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  content: string
  /** Treffer im Quelltext für die Markierungsebene (null = keine) */
  onSourceFind: (f: SourceFind) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [index, setIndex] = useState(0)
  const [count, setCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const ranges = useRef<Range[]>([])
  const matches = useRef<Match[]>([])
  const inSource = useRef(false)

  // Fokus synchron nach dem Rendern: sonst landen schnell getippte Zeichen noch im Editor
  useLayoutEffect(() => {
    if (open) {
      setQuery(initialQuery)
      setIndex(0)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [open, initialQuery])

  // Treffer bestimmen: Quelltext, sobald sichtbar; sonst Vorschau
  useEffect(() => {
    if (!open) return
    const root = previewRef.current
    inSource.current = !!textareaRef.current
    matches.current = inSource.current ? findInText(content, query) : []
    ranges.current = root ? previewRanges(root, query) : []
    const n = inSource.current ? matches.current.length : ranges.current.length
    setCount(n)
    setIndex((i) => (n ? Math.min(i, n - 1) : 0))
  }, [open, query, content, previewRef, textareaRef])

  // Markieren und zur aktuellen Fundstelle springen
  useEffect(() => {
    if (!open) return
    const root = previewRef.current
    if (highlightsSupported()) {
      CSS.highlights.set(HL, new Highlight(...ranges.current))
      const cur = inSource.current ? undefined : ranges.current[index]
      if (cur) CSS.highlights.set(HL_CURRENT, new Highlight(cur))
      else CSS.highlights.delete(HL_CURRENT)
    }
    if (inSource.current) {
      onSourceFind({ matches: matches.current, current: index })
      const m = matches.current[index]
      if (m) textareaRef.current?.setSelectionRange(m.start, m.end)
    } else {
      onSourceFind(null)
      const cur = ranges.current[index]
      if (cur && root) {
        const rect = cur.getBoundingClientRect()
        const box = root.getBoundingClientRect()
        if (rect.top < box.top || rect.bottom > box.bottom) root.scrollTop += rect.top - box.top - box.height / 3
      }
    }
  }, [open, index, count, query, content, previewRef, textareaRef, onSourceFind])

  useEffect(() => {
    if (open) return
    clearHighlights()
    onSourceFind(null)
  }, [open, onSourceFind])
  useEffect(() => () => clearHighlights(), [])

  const step = useCallback((dir: 1 | -1) => setIndex((i) => (count ? (i + dir + count) % count : 0)), [count])

  function close() {
    onClose()
    // Im Quelltext bleibt die Fundstelle ausgewählt
    const m = matches.current[index]
    if (m && inSource.current && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(m.start, m.end)
    }
  }

  if (!open) return null
  return (
    <div className="flex items-center gap-1 border-b border-line bg-surface px-4 py-1.5" role="search">
      <input
        ref={inputRef}
        className="input h-7 max-w-xs"
        placeholder="Im Dokument suchen"
        aria-label="Im Dokument suchen"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); close() }
        }}
      />
      <span className="min-w-16 text-center text-xs text-text-2" aria-live="polite">
        {query.trim() ? (count ? `${index + 1} / ${count}` : 'Keine Treffer') : ''}
      </span>
      <button type="button" className="btn-icon size-7" aria-label="Vorheriger Treffer" disabled={!count} onClick={() => step(-1)}><ChevronUp size={16} /></button>
      <button type="button" className="btn-icon size-7" aria-label="Nächster Treffer" disabled={!count} onClick={() => step(1)}><ChevronDown size={16} /></button>
      <button type="button" className="btn-icon size-7" aria-label="Suche schliessen" onClick={close}><X size={16} /></button>
    </div>
  )
}

/**
 * Markierungsebene hinter der textarea: gleicher Text, gleiche Schrift und Abstände, Text unsichtbar,
 * nur die Treffer haben einen Hintergrund. Scrollt mit der textarea mit und bringt den aktuellen Treffer
 * ins Bild (auch bei umgebrochenen Zeilen).
 */
export function SourceHighlights({
  content,
  find,
  textareaRef,
  className,
}: {
  content: string
  find: SourceFind
  textareaRef: RefObject<HTMLTextAreaElement | null>
  className: string
}) {
  const layer = useRef<HTMLDivElement>(null)

  // Scroll der textarea spiegeln
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const sync = () => {
      if (layer.current) layer.current.scrollTop = ta.scrollTop
    }
    sync()
    ta.addEventListener('scroll', sync)
    return () => ta.removeEventListener('scroll', sync)
  }, [textareaRef, find])

  // Aktuellen Treffer in den sichtbaren Bereich holen
  useEffect(() => {
    const ta = textareaRef.current
    const mark = layer.current?.querySelector<HTMLElement>('[data-current]')
    if (!ta || !mark) return
    const top = mark.offsetTop
    if (top < ta.scrollTop || top + mark.offsetHeight > ta.scrollTop + ta.clientHeight) {
      ta.scrollTop = Math.max(0, top - ta.clientHeight / 3)
    }
    if (layer.current) layer.current.scrollTop = ta.scrollTop
  }, [find, textareaRef])

  if (!find?.matches.length) return null
  const parts: React.ReactNode[] = []
  let pos = 0
  find.matches.forEach((m, i) => {
    if (m.start > pos) parts.push(content.slice(pos, m.start))
    parts.push(
      <mark key={i} data-current={i === find.current ? '' : undefined}
        className={`rounded-sm text-transparent ${i === find.current ? 'bg-amber-400 dark:bg-amber-500/70' : 'bg-yellow-200 dark:bg-yellow-500/40'}`}>
        {content.slice(m.start, m.end)}
      </mark>,
    )
    pos = m.end
  })
  parts.push(content.slice(pos) + '\n')

  return (
    <div ref={layer} aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent ${className}`}>
      {parts}
    </div>
  )
}

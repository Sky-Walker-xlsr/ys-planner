'use client'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { normalizeWithMap, searchTerms } from '@/lib/search'

// Suchen im Dokument (Ctrl/Cmd+F). Vorschau: Markierung per CSS Custom Highlight API,
// Quelltext: Auswahl der Fundstelle und Scrollen dorthin.

type Match = { start: number; end: number }

const HL = 'kb-find'
const HL_CURRENT = 'kb-find-current'

function highlightsSupported() {
  return typeof CSS !== 'undefined' && 'highlights' in CSS
}

function findInText(text: string, query: string): Match[] {
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
}: {
  open: boolean
  initialQuery: string
  onClose: () => void
  previewRef: RefObject<HTMLDivElement | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  content: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [index, setIndex] = useState(0)
  const [count, setCount] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const ranges = useRef<Range[]>([])
  const matches = useRef<Match[]>([])

  useEffect(() => {
    if (open) {
      setQuery(initialQuery)
      setIndex(0)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [open, initialQuery])

  // Treffer neu bestimmen (Vorschau hat Vorrang, sonst Quelltext)
  useEffect(() => {
    if (!open) return
    const root = previewRef.current
    ranges.current = root ? previewRanges(root, query) : []
    matches.current = root ? [] : findInText(content, query)
    const n = root ? ranges.current.length : matches.current.length
    setCount(n)
    setIndex((i) => (n ? Math.min(i, n - 1) : 0))
  }, [open, query, content, previewRef])

  // Markieren und zur aktuellen Fundstelle scrollen
  useEffect(() => {
    if (!open) return
    if (highlightsSupported()) {
      CSS.highlights.set(HL, new Highlight(...ranges.current))
      const cur = ranges.current[index]
      if (cur) CSS.highlights.set(HL_CURRENT, new Highlight(cur))
      else CSS.highlights.delete(HL_CURRENT)
    }
    const cur = ranges.current[index]
    const root = previewRef.current
    if (cur && root) {
      const rect = cur.getBoundingClientRect()
      const box = root.getBoundingClientRect()
      if (rect.top < box.top || rect.bottom > box.bottom) root.scrollTop += rect.top - box.top - box.height / 3
    }
    const m = matches.current[index]
    const ta = textareaRef.current
    if (m && ta && !root) {
      ta.setSelectionRange(m.start, m.end)
      const line = content.slice(0, m.start).split('\n').length - 1
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20
      ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 3)
    }
  }, [open, index, count, query, content, previewRef, textareaRef])

  // Markierungen beim Schliessen entfernen
  useEffect(() => {
    if (open || !highlightsSupported()) return
    CSS.highlights.delete(HL)
    CSS.highlights.delete(HL_CURRENT)
  }, [open])
  useEffect(() => () => {
    if (highlightsSupported()) {
      CSS.highlights.delete(HL)
      CSS.highlights.delete(HL_CURRENT)
    }
  }, [])

  const step = useCallback((dir: 1 | -1) => setIndex((i) => (count ? (i + dir + count) % count : 0)), [count])

  function close() {
    onClose()
    // Im Quelltext bleibt die Fundstelle ausgewählt
    const m = matches.current[index]
    if (m && textareaRef.current && !previewRef.current) {
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

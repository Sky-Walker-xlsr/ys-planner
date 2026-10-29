'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { usePlanner } from '@/lib/store/planner-store'
import { kbFileUrl } from '@/lib/file-urls'
import { searchDocuments, type Segment } from '@/lib/search'
import type { KbFile } from '@/lib/types'

// Inhalte der KB-Dateien (aus R2) für die Volltextsuche; neu geladen, wenn sich updated_at ändert
const cache = new Map<string, { updatedAt: string; text: string }>()

function useKbContents(files: KbFile[]) {
  const { viewer } = usePlanner()
  const [, setVersion] = useState(0)
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)

  const load = useCallback(async () => {
    if (busy.current) return
    const todo = files.filter((f) => cache.get(f.id)?.updatedAt !== f.updated_at)
    if (!todo.length) return
    busy.current = true
    setLoading(true)
    const queue = [...todo]
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        const res = await fetch(kbFileUrl(f.id, viewer), { cache: 'no-store' }).catch(() => null)
        if (res?.ok) cache.set(f.id, { updatedAt: f.updated_at, text: await res.text() })
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    busy.current = false
    setLoading(false)
    setVersion((v) => v + 1)
  }, [files, viewer])

  const contents = (id: string) => cache.get(id)?.text
  return { load, loading, contents }
}

export function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.hit ? (
          <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/40">{s.text}</mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

/** Volltextsuche über Namen und Inhalte der Knowledge Base */
export function KbSearch({ files, onOpen }: { files: KbFile[]; onOpen: (id: string, query: string) => void }) {
  const { load, loading, contents } = useKbContents(files)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const results = useMemo(
    () => (q.trim() ? searchDocuments(q, files.map((f) => ({ item: f, name: f.name, content: contents(f.id) }))) : []),
    // contents liest aus dem Cache; loading-Wechsel löst die Neuberechnung aus
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, files, loading],
  )

  function choose(f: KbFile) {
    setOpen(false)
    onOpen(f.id, q.trim())
  }

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
      <input
        type="search"
        className="input pl-8"
        placeholder="In der Knowledge Base suchen …"
        aria-label="Knowledge Base durchsuchen"
        value={q}
        onFocus={() => { setOpen(true); void load() }}
        onBlur={() => setOpen(false)}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active].item) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && q.trim() && (
        <div className="card absolute left-0 top-full z-30 mt-1 max-h-[60vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto p-1 shadow-lg" role="listbox">
          {results.map((r, i) => (
            <button
              key={r.item.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(r.item) }}
              onMouseEnter={() => setActive(i)}
              className={`block w-full cursor-pointer rounded-md px-3 py-2 text-left ${i === active ? 'bg-bg' : ''}`}
            >
              <span className="block truncate text-sm font-medium"><Marked segments={r.title} /></span>
              {r.snippet && (
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-text-2"><Marked segments={r.snippet} /></span>
              )}
            </button>
          ))}
          {!results.length && <p className="px-3 py-2 text-sm text-text-2">{loading ? 'Durchsucht Inhalte …' : 'Keine Treffer'}</p>}
          {results.length > 0 && loading && <p className="px-3 py-1 text-xs text-text-2">Durchsucht weitere Inhalte …</p>}
        </div>
      )}
    </div>
  )
}

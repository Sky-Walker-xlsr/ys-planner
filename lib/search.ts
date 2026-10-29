// Suche für die Knowledge Base: unscharf gegenüber Gross-/Kleinschreibung und Akzenten (ä ↔ a, ß ↔ ss),
// mehrere Begriffe (alle müssen vorkommen), Treffer im Namen zählen mehr. Liefert einen Ausschnitt
// mit markierten Fundstellen.

/** Normalisiert Text und merkt sich pro normalisiertem Zeichen die Position im Original. */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = ''
  const map: number[] = []
  let i = 0
  for (const ch of text) {
    const n = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss')
    for (let k = 0; k < n.length; k++) map.push(i)
    norm += n
    i += ch.length
  }
  map.push(i)
  return { norm, map }
}

export const normalize = (s: string) => normalizeWithMap(s).norm

export function searchTerms(query: string): string[] {
  return [...new Set(normalize(query).split(/\s+/).filter((t) => t.length > 0))]
}

/** Markdown grob in Fliesstext umwandeln (für Suche und Ausschnitt) */
export function markdownToPlain(md: string): string {
  return md
    .replace(/```[^\n]*\n/g, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type Segment = { text: string; hit: boolean }

/** Zerlegt Text in Abschnitte, Fundstellen der Begriffe sind markiert */
export function highlight(text: string, terms: string[]): Segment[] {
  if (!terms.length || !text) return [{ text, hit: false }]
  const { norm, map } = normalizeWithMap(text)
  const marks: [number, number][] = []
  for (const t of terms) {
    for (let at = norm.indexOf(t); at !== -1; at = norm.indexOf(t, at + t.length)) marks.push([map[at], map[at + t.length]])
  }
  marks.sort((a, b) => a[0] - b[0])
  const out: Segment[] = []
  let pos = 0
  for (const [s, e] of marks) {
    if (e <= pos) continue
    const start = Math.max(s, pos)
    if (start > pos) out.push({ text: text.slice(pos, start), hit: false })
    out.push({ text: text.slice(start, e), hit: true })
    pos = e
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false })
  return out
}

export type SearchResult<T> = { item: T; score: number; title: Segment[]; snippet: Segment[] | null }

const BEFORE = 50
const AFTER = 110

/** Ausschnitt rund um die erste Fundstelle, an Wortgrenzen gekürzt */
function snippetAround(plain: string, normPlain: { norm: string; map: number[] }, terms: string[]): Segment[] | null {
  let first = -1
  let len = 0
  for (const t of terms) {
    const at = normPlain.norm.indexOf(t)
    if (at !== -1 && (first === -1 || at < first)) {
      first = at
      len = t.length
    }
  }
  if (first === -1) return null
  const s = normPlain.map[first]
  const e = normPlain.map[first + len]
  let from = Math.max(0, s - BEFORE)
  let to = Math.min(plain.length, e + AFTER)
  if (from > 0) from = plain.indexOf(' ', from) + 1 || from
  if (to < plain.length) to = plain.lastIndexOf(' ', to) > e ? plain.lastIndexOf(' ', to) : to
  const text = `${from > 0 ? '… ' : ''}${plain.slice(from, to).trim()}${to < plain.length ? ' …' : ''}`
  return highlight(text, terms)
}

/**
 * Sucht in Namen und Inhalten. Alle Begriffe müssen im Namen oder im Inhalt vorkommen.
 * content: Markdown-Inhalt oder undefined (noch nicht geladen → nur Namenssuche).
 */
export function searchDocuments<T>(
  query: string,
  docs: { item: T; name: string; content?: string }[],
  limit = 20,
): SearchResult<T>[] {
  const terms = searchTerms(query)
  if (!terms.length) return []
  const results: SearchResult<T>[] = []
  for (const d of docs) {
    const name = normalize(d.name)
    const plain = d.content ? markdownToPlain(d.content) : ''
    const np = normalizeWithMap(plain)
    let score = 0
    let ok = true
    for (const t of terms) {
      const inName = name.includes(t)
      let count = 0
      for (let at = np.norm.indexOf(t); at !== -1 && count < 5; at = np.norm.indexOf(t, at + t.length)) count++
      if (!inName && !count) {
        ok = false
        break
      }
      score += (inName ? 10 : 0) + (name.startsWith(t) ? 5 : 0) + count
    }
    if (!ok) continue
    results.push({ item: d.item, score, title: highlight(d.name, terms), snippet: plain ? snippetAround(plain, np, terms) : null })
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

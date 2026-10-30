// Werkzeugleiste für Markdown-Felder: wendet ein Format auf die Auswahl an.

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'heading' | 'ul' | 'ol' | 'todo' | 'quote'

const WRAP: Partial<Record<FormatKind, string>> = { bold: '**', italic: '*', strike: '~~', code: '`' }
const LINE: Partial<Record<FormatKind, string>> = { heading: '## ', ul: '- ', ol: '1. ', todo: '- [ ] ', quote: '> ' }

export type FormatResult = { value: string; start: number; end: number }

export function applyFormat(value: string, start: number, end: number, kind: FormatKind): FormatResult {
  const selected = value.slice(start, end)

  if (kind === 'link') {
    const label = selected || 'Text'
    const url = 'https://'
    const next = `${value.slice(0, start)}[${label}](${url})${value.slice(end)}`
    const urlStart = start + label.length + 3
    return { value: next, start: urlStart, end: urlStart + url.length }
  }

  const wrap = WRAP[kind]
  if (wrap) {
    // Bereits formatiert: wieder entfernen
    if (value.slice(start - wrap.length, start) === wrap && value.slice(end, end + wrap.length) === wrap) {
      return {
        value: value.slice(0, start - wrap.length) + selected + value.slice(end + wrap.length),
        start: start - wrap.length,
        end: end - wrap.length,
      }
    }
    return { value: value.slice(0, start) + wrap + selected + wrap + value.slice(end), start: start + wrap.length, end: end + wrap.length }
  }

  // Zeilen-Formate gelten für alle ausgewählten Zeilen
  const prefix = LINE[kind]!
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const nextBreak = value.indexOf('\n', end)
  const lineEnd = nextBreak === -1 ? value.length : nextBreak
  const lines = value.slice(lineStart, lineEnd).split('\n')
  const remove = lines.every((l) => l.startsWith(prefix))
  const block = lines.map((l, i) => {
    if (remove) return l.slice(prefix.length)
    return (kind === 'ol' ? `${i + 1}. ` : prefix) + l
  }).join('\n')
  const next = value.slice(0, lineStart) + block + value.slice(lineEnd)
  return { value: next, start: lineStart, end: lineStart + block.length }
}

/** Fügt Erwähnungen als Sonder-Links ein, damit sie auch in formatiertem Text erkannt werden */
export function markMentions(text: string, names: string[]) {
  if (!names.length) return text
  const escaped = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return text.replace(new RegExp(`@(${escaped.join('|')})`, 'g'), (m) => `[${m}](mention:)`)
}

/** Beschreibung als Klartext für die Vorschau auf der Karte: ohne Markdown-Zeichen, auf einer Zeile */
export function markdownPreview(text: string, maxLength = 300) {
  return text
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

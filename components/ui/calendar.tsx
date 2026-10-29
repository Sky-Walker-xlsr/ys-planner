'use client'
import { useMemo, useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Segmented } from '@/components/ui/controls'
import { addDays, parseISODate, startOfWeekISO, todayISO, toISODate } from '@/lib/dates'

// Monats-/Wochenkalender für Zeitplan-Ansichten. Tage sind dnd-kit-Droppables mit id `day:{YYYY-MM-DD}`.

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const monthFmt = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'short' })

export type CalendarMode = 'month' | 'week'

export function useCalendar() {
  const [mode, setMode] = useState<CalendarMode>('month')
  const [anchor, setAnchor] = useState(todayISO())

  const days = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeekISO(anchor)
      return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }
    const a = parseISODate(anchor)
    const first = toISODate(new Date(a.getFullYear(), a.getMonth(), 1))
    const start = startOfWeekISO(first)
    const last = toISODate(new Date(a.getFullYear(), a.getMonth() + 1, 0))
    const out: string[] = []
    for (let d = start; d <= last || out.length % 7 !== 0; d = addDays(d, 1)) out.push(d)
    return out
  }, [mode, anchor])

  function shift(dir: 1 | -1) {
    if (mode === 'week') setAnchor(addDays(anchor, 7 * dir))
    else {
      const a = parseISODate(anchor)
      setAnchor(toISODate(new Date(a.getFullYear(), a.getMonth() + dir, 1)))
    }
  }

  return { mode, setMode, anchor, setAnchor, days, shift }
}

export type CalendarState = ReturnType<typeof useCalendar>

export function CalendarHeader({ cal }: { cal: CalendarState }) {
  const { mode, setMode, anchor, setAnchor, days, shift } = cal
  const title = mode === 'month' ? monthFmt.format(parseISODate(anchor)) : `${dayFmt.format(parseISODate(days[0]))} – ${dayFmt.format(parseISODate(days[6]))}`
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button type="button" className="btn-secondary" onClick={() => setAnchor(todayISO())}>Heute</button>
      <button type="button" className="btn-icon" aria-label="Zurück" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
      <button type="button" className="btn-icon" aria-label="Weiter" onClick={() => shift(1)}><ChevronRight size={18} /></button>
      <h2 className="text-base font-semibold capitalize">{title}</h2>
      <div className="ml-auto">
        <Segmented label="Zeitraum" value={mode} onChange={setMode} options={[{ value: 'month', label: 'Monat' }, { value: 'week', label: 'Woche' }]} />
      </div>
    </div>
  )
}

export function CalendarGrid({ cal, renderDay }: { cal: CalendarState; renderDay: (date: string) => ReactNode }) {
  const { mode, anchor, days } = cal
  const today = todayISO()
  const currentMonth = parseISODate(anchor).getMonth()
  return (
    <div className="card grid flex-1 grid-cols-7 overflow-hidden" style={{ gridAutoRows: mode === 'week' ? '1fr' : 'minmax(110px, 1fr)' }}>
      {WEEKDAYS.map((d) => (
        <div key={d} className="border-b border-line bg-bg px-2 py-1 text-xs font-medium text-text-2">{d}</div>
      ))}
      {days.map((d) => (
        <Day key={d} date={d} isToday={d === today} muted={mode === 'month' && parseISODate(d).getMonth() !== currentMonth}>
          {renderDay(d)}
        </Day>
      ))}
    </div>
  )
}

function Day({ date, isToday, muted, children }: { date: string; isToday: boolean; muted: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` })
  return (
    <div ref={setNodeRef} className={`min-w-0 border-b border-r border-line p-1.5 ${isOver ? 'bg-accent-soft' : ''} ${muted ? 'bg-bg/50' : ''}`}>
      <div className={`mb-1 text-xs ${isToday ? 'inline-flex size-5 items-center justify-center rounded-full bg-accent font-semibold text-on-accent' : muted ? 'text-text-2' : ''}`}>
        {parseISODate(date).getDate()}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

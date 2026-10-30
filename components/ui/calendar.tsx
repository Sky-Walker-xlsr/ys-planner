'use client'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Segmented } from '@/components/ui/controls'
import { addDays, addMonths, monthGrid, monthRange, monthStart, parseISODate, startOfWeekISO, todayISO } from '@/lib/dates'

// Zeitplan-Ansichten: Monate untereinander (scrollbar, lädt nach) oder eine Woche.
// Tage sind dnd-kit-Droppables mit id `day:{YYYY-MM-DD}`; jeder Tag kommt deshalb nur einmal vor.

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const monthFmt = new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'short' })

const MONTHS_BEFORE = 6
const MONTHS_AFTER = 12
const LOAD_MORE = 6
/** Abstand zum Rand der Liste in Pixeln, ab dem weitere Monate geladen werden */
const LOAD_MARGIN = 500

export type CalendarMode = 'month' | 'week'

export function useCalendar() {
  const [mode, setModeState] = useState<CalendarMode>('month')
  const [anchor, setAnchor] = useState(todayISO())
  const [range, setRange] = useState(() => {
    const month = monthStart(todayISO())
    return { first: addMonths(month, -MONTHS_BEFORE), last: addMonths(month, MONTHS_AFTER) }
  })
  // Sprungziel für die Monatsliste; der Zähler erlaubt denselben Monat mehrmals
  const [jump, setJump] = useState({ month: monthStart(todayISO()), n: 0 })

  const weekDays = useMemo(() => {
    const start = startOfWeekISO(anchor)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [anchor])

  function goToMonth(iso: string) {
    const month = monthStart(iso)
    setRange((r) => ({ first: month < r.first ? month : r.first, last: month > r.last ? month : r.last }))
    setAnchor(iso)
    setJump((j) => ({ month, n: j.n + 1 }))
  }

  function shift(dir: 1 | -1) {
    if (mode === 'week') setAnchor(addDays(anchor, 7 * dir))
    else goToMonth(addMonths(monthStart(anchor), dir))
  }

  function goToToday() {
    if (mode === 'week') setAnchor(todayISO())
    else goToMonth(todayISO())
  }

  function setMode(next: CalendarMode) {
    setModeState(next)
    if (next === 'month') goToMonth(anchor)
  }

  /** Beim Scrollen: sichtbarer Monat; ein Tag im selben Monat (z. B. heute) bleibt als Anker erhalten */
  function setVisibleMonth(month: string) {
    setAnchor((a) => (monthStart(a) === month ? a : month))
  }

  function loadMore(dir: 1 | -1) {
    setRange((r) => (dir === 1
      ? { ...r, last: addMonths(r.last, LOAD_MORE) }
      : { ...r, first: addMonths(r.first, -LOAD_MORE) }))
  }

  return { mode, setMode, anchor, weekDays, shift, goToToday, range, jump, setVisibleMonth, loadMore }
}

export type CalendarState = ReturnType<typeof useCalendar>

export function CalendarHeader({ cal }: { cal: CalendarState }) {
  const { mode, setMode, anchor, weekDays, shift, goToToday } = cal
  const title = mode === 'month' ? monthFmt.format(parseISODate(anchor)) : `${dayFmt.format(parseISODate(weekDays[0]))} – ${dayFmt.format(parseISODate(weekDays[6]))}`
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button type="button" className="btn-secondary" onClick={goToToday}>Heute</button>
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
  if (cal.mode === 'month') return <MonthStack cal={cal} renderDay={renderDay} />
  const today = todayISO()
  return (
    <div className="card grid flex-1 grid-cols-7 overflow-hidden" style={{ gridAutoRows: '1fr' }}>
      <WeekdayCells />
      {cal.weekDays.map((d) => <Day key={d} date={d} isToday={d === today}>{renderDay(d)}</Day>)}
    </div>
  )
}

function MonthStack({ cal, renderDay }: { cal: CalendarState; renderDay: (date: string) => ReactNode }) {
  const { range, jump, setVisibleMonth, loadMore } = cal
  const ref = useRef<HTMLDivElement>(null)
  const heightBeforePrepend = useRef<number | null>(null)
  const today = todayISO()
  const months = useMemo(() => monthRange(range.first, range.last), [range.first, range.last])

  // Sprung, auch beim ersten Anzeigen und nach dem Wechsel aus der Wochenansicht
  useLayoutEffect(() => {
    const el = ref.current
    const section = el?.querySelector<HTMLElement>(`[data-month="${jump.month}"]`)
    if (el && section) el.scrollTop += section.getBoundingClientRect().top - el.getBoundingClientRect().top
  }, [jump])

  // Monate oben einfügen darf die sichtbare Stelle nicht verschieben
  useLayoutEffect(() => {
    const el = ref.current
    if (el && heightBeforePrepend.current !== null) {
      el.scrollTop += el.scrollHeight - heightBeforePrepend.current
      heightBeforePrepend.current = null
    }
  }, [range.first])

  const frame = useRef<number | null>(null)
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])

  function onScroll() {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const el = ref.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      for (const section of el.querySelectorAll<HTMLElement>('[data-month]')) {
        if (section.getBoundingClientRect().bottom > top + 80) {
          setVisibleMonth(section.dataset.month!)
          break
        }
      }
      if (el.scrollTop < LOAD_MARGIN && heightBeforePrepend.current === null) {
        heightBeforePrepend.current = el.scrollHeight
        loadMore(-1)
      } else if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MARGIN) {
        loadMore(1)
      }
    })
  }

  return (
    <div ref={ref} onScroll={onScroll} className="card min-h-0 flex-1 overflow-y-auto" style={{ overflowAnchor: 'none' }}>
      {months.map((month) => {
        const { leading, days } = monthGrid(month)
        return (
          <section key={month} data-month={month} aria-label={monthFmt.format(parseISODate(month))}>
            <div className="sticky top-0 z-10 bg-surface">
              <h3 className="px-3 pb-1 pt-3 text-sm font-semibold capitalize">{monthFmt.format(parseISODate(month))}</h3>
              <div className="grid grid-cols-7"><WeekdayCells /></div>
            </div>
            <div className="grid grid-cols-7" style={{ gridAutoRows: 'minmax(110px, auto)' }}>
              {Array.from({ length: leading }, (_, i) => (
                <div key={i} className="border-b border-r border-line bg-bg/50" aria-hidden />
              ))}
              {days.map((d) => <Day key={d} date={d} isToday={d === today}>{renderDay(d)}</Day>)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function WeekdayCells() {
  return WEEKDAYS.map((d) => (
    <div key={d} className="border-b border-line bg-bg px-2 py-1 text-xs font-medium text-text-2">{d}</div>
  ))
}

function Day({ date, isToday, children }: { date: string; isToday: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` })
  return (
    <div ref={setNodeRef} className={`min-w-0 border-b border-r border-line p-1.5 ${isOver ? 'bg-accent-soft' : ''}`}>
      <div className={`mb-1 text-xs ${isToday ? 'inline-flex size-5 items-center justify-center rounded-full bg-accent font-semibold text-on-accent' : ''}`}>
        {parseISODate(date).getDate()}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

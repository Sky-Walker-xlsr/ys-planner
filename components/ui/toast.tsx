'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

type ToastItem = { id: number; message: string }
let listeners: ((items: ToastItem[]) => void)[] = []
let items: ToastItem[] = []
let nextId = 1

export function toast(message: string) {
  const item = { id: nextId++, message }
  items = [...items, item]
  listeners.forEach((l) => l(items))
  setTimeout(() => dismiss(item.id), 5000)
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id)
  listeners.forEach((l) => l(items))
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([])
  useEffect(() => {
    listeners.push(setList)
    return () => {
      listeners = listeners.filter((l) => l !== setList)
    }
  }, [])
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="card flex items-center gap-3 px-4 py-2.5 text-sm shadow-lg">
          <span>{t.message}</span>
          <button type="button" className="btn-icon size-6" aria-label="Schliessen" onClick={() => dismiss(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

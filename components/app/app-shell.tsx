'use client'
import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Sidebar } from '@/components/sidebar/sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden" onClick={() => setMobileOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="h-full shadow-2xl">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
          <div className="flex-1 bg-black/40" />
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
          <button type="button" className="btn-icon" aria-label="Navigation öffnen" onClick={() => setMobileOpen(true)}>
            <Menu size={18} />
          </button>
          <span className="font-semibold">ys-planner</span>
        </div>
        {children}
      </main>
    </div>
  )
}

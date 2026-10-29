'use client'
import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Search } from 'lucide-react'
import { UserAvatar } from '@/components/ui/avatar'
import type { Role, User } from '@/lib/types'
import { ROLE_LABEL } from '@/lib/types'

export type MemberRow = {
  user: User
  role: Role
  origin: 'creator' | 'direct' | 'folder'
  folderName?: string
}

const ORIGIN_TEXT = (m: MemberRow) =>
  m.origin === 'creator' ? 'Ersteller' : m.origin === 'folder' ? `via Ordner «${m.folderName ?? ''}»` : 'direkt eingeladen'

export function MembersPanel({
  db,
  members,
  canManage,
  onInvite,
  onRoleChange,
  onRemove,
}: {
  db: SupabaseClient
  members: MemberRow[]
  canManage: boolean
  onInvite: (userId: string, role: Role) => Promise<void>
  onRoleChange: (userId: string, role: Role) => Promise<void>
  onRemove: (userId: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [selected, setSelected] = useState<User | null>(null)
  const [role, setRole] = useState<Role>('editor')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const q = query.trim().replace(/[,()%*\\]/g, ' ')
    if (selected || q.length < 2) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      const { data } = await db
        .from('users')
        .select('id, email, display_name, avatar_color')
        .or(`display_name.ilike.*${q}*,email.ilike.*${q}*`)
        .order('display_name')
        .limit(8)
      setResults((data ?? []) as User[])
    }, 200)
    return () => clearTimeout(t)
  }, [query, selected, db])

  const memberIds = new Set(members.filter((m) => m.origin !== 'folder').map((m) => m.user.id))

  async function invite() {
    if (!selected) return
    setBusy(true)
    try {
      await onInvite(selected.id, role)
      setSelected(null)
      setQuery('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Mitglieder einladen</h3>
        {canManage ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <label htmlFor="member-search" className="sr-only">User suchen</label>
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
              <input
                id="member-search"
                className="input pl-8"
                placeholder="Name oder E-Mail"
                autoComplete="off"
                value={selected ? selected.display_name : query}
                onChange={(e) => {
                  setSelected(null)
                  setQuery(e.target.value)
                }}
              />
              {results.length > 0 && (
                <ul className="card absolute z-10 mt-1 max-h-64 w-full overflow-y-auto p-1 shadow-lg" role="listbox">
                  {results.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        disabled={memberIds.has(u.id)}
                        onClick={() => {
                          setSelected(u)
                          setResults([])
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg disabled:opacity-50 cursor-pointer"
                      >
                        <UserAvatar user={u} size={24} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{u.display_name}</span>
                          <span className="block truncate text-xs text-text-2">{u.email}</span>
                        </span>
                        {memberIds.has(u.id) && <span className="ml-auto text-xs text-text-2">bereits Mitglied</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <label htmlFor="invite-role" className="sr-only">Rolle</label>
            <select id="invite-role" className="input sm:w-36" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="editor">Bearbeiter</option>
              <option value="viewer">Leser</option>
              <option value="owner">Owner</option>
            </select>
            <button type="button" className="btn-primary" disabled={!selected || busy} onClick={invite}>
              Einladen
            </button>
          </div>
        ) : (
          <p className="text-sm text-text-2">Nur Owner können Mitglieder einladen.</p>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-line rounded-card border border-line">
        {members.map((m) => (
          <li key={`${m.user.id}:${m.origin}`} className="flex items-center gap-3 px-3 py-2">
            <UserAvatar user={m.user} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.user.display_name}</div>
              <div className="truncate text-xs text-text-2">
                {m.user.email} · {ORIGIN_TEXT(m)}
              </div>
            </div>
            {m.origin === 'direct' && canManage ? (
              <>
                <label htmlFor={`role-${m.user.id}`} className="sr-only">Rolle von {m.user.display_name}</label>
                <select
                  id={`role-${m.user.id}`}
                  className="input w-36"
                  value={m.role}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === 'remove') void onRemove(m.user.id)
                    else void onRoleChange(m.user.id, v as Role)
                  }}
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Bearbeiter</option>
                  <option value="viewer">Leser</option>
                  <option value="remove">Entfernen</option>
                </select>
              </>
            ) : (
              <span className="w-36 text-right text-sm text-text-2">{ROLE_LABEL[m.role]}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

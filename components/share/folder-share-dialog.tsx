'use client'
import { useCallback, useEffect, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { getBrowserClient } from '@/lib/supabase/browser'
import type { Folder, FolderMember, Role, User } from '@/lib/types'
import { MembersPanel, type MemberRow } from './members-panel'

export function FolderShareDialog({
  folder,
  canManage,
  onClose,
}: {
  folder: Folder
  canManage: boolean
  onClose: () => void
}) {
  const db = getBrowserClient()
  const [members, setMembers] = useState<MemberRow[]>([])

  const load = useCallback(async () => {
    const { data: fm } = await db.from('folder_members').select('*').eq('folder_id', folder.id)
    const rows = (fm ?? []) as FolderMember[]
    const { data: users } = rows.length
      ? await db.from('users').select('id, email, display_name, avatar_color').in('id', rows.map((r) => r.user_id))
      : { data: [] }
    const byId = new Map(((users ?? []) as User[]).map((u) => [u.id, u]))
    setMembers(
      rows
        .filter((r) => byId.has(r.user_id))
        .map<MemberRow>((r) => ({
          user: byId.get(r.user_id)!,
          role: r.role,
          origin: r.user_id === folder.owner_id ? 'creator' : 'direct',
        }))
        .sort((a, b) => (a.origin === 'creator' ? -1 : b.origin === 'creator' ? 1 : a.user.display_name.localeCompare(b.user.display_name))),
    )
  }, [db, folder])

  useEffect(() => {
    void load()
  }, [load])

  async function invite(userId: string, role: Role) {
    const res = await fetch(`/api/folders/${folder.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    })
    if (!res.ok) toast('Einladung fehlgeschlagen')
    await load()
  }

  async function changeRole(userId: string, role: Role) {
    const { error } = await db.from('folder_members').update({ role }).eq('folder_id', folder.id).eq('user_id', userId)
    if (error) toast('Rolle konnte nicht geändert werden')
    await load()
  }

  async function remove(userId: string) {
    const { error } = await db.from('folder_members').delete().eq('folder_id', folder.id).eq('user_id', userId)
    if (error) toast('Mitglied konnte nicht entfernt werden')
    await load()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Ordner «${folder.name}» teilen`}
      subtitle="Mitglieder erhalten Zugriff auf alle Planner in diesem Ordner."
      maxWidth={620}
    >
      <MembersPanel
        db={db}
        members={members}
        canManage={canManage}
        onInvite={invite}
        onRoleChange={changeRole}
        onRemove={remove}
      />
    </Modal>
  )
}

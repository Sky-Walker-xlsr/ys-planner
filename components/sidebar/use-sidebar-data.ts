'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBrowserClient } from '@/lib/supabase/browser'
import type { Favorite, Folder, FolderMember, Planner, PlannerMember, Role } from '@/lib/types'
import { ROLE_RANK } from '@/lib/types'

export type SidebarData = {
  loaded: boolean
  folders: Folder[]
  folderMembers: FolderMember[]
  planners: Planner[]
  plannerMembers: PlannerMember[]
  favorites: Favorite[]
  myTaskCount: number
  /** offene Tasks im Eingang */
  inboxCount: number
}

export function useSidebarData(userId: string) {
  const db = getBrowserClient()
  const [data, setData] = useState<SidebarData>({
    loaded: false, folders: [], folderMembers: [], planners: [], plannerMembers: [], favorites: [], myTaskCount: 0, inboxCount: 0,
  })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const [folders, folderMembers, planners, plannerMembers, favorites, count, inbox] = await Promise.all([
      db.from('folders').select('*').order('position'),
      db.from('folder_members').select('*'),
      db.from('planners').select('*').order('position'),
      db.from('planner_members').select('*').eq('user_id', userId),
      db.from('favorites').select('*').eq('user_id', userId).order('position'),
      db
        .from('task_assignees')
        .select('task_id, tasks!inner(status)', { count: 'exact', head: true })
        .eq('user_id', userId)
        .neq('tasks.status', 'done'),
      db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .is('planner_id', null)
        .eq('owner_id', userId)
        .neq('status', 'done'),
    ])
    setData({
      loaded: true,
      folders: (folders.data ?? []) as Folder[],
      folderMembers: (folderMembers.data ?? []) as FolderMember[],
      planners: (planners.data ?? []) as Planner[],
      plannerMembers: (plannerMembers.data ?? []) as PlannerMember[],
      favorites: (favorites.data ?? []) as Favorite[],
      myTaskCount: count.count ?? 0,
      inboxCount: inbox.count ?? 0,
    })
  }, [db, userId])

  const scheduleLoad = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(), 300)
  }, [load])

  useEffect(() => {
    void load()
    const channel = db.channel('db:sidebar')
    for (const table of ['folders', 'folder_members', 'planners', 'planner_members', 'favorites', 'task_assignees', 'tasks']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleLoad)
    }
    channel.subscribe()
    return () => {
      void db.removeChannel(channel)
    }
  }, [db, load, scheduleLoad])

  const roles = useMemo(() => {
    const folderRole = new Map<string, Role>()
    for (const fm of data.folderMembers) if (fm.user_id === userId) folderRole.set(fm.folder_id, fm.role)
    const plannerRole = new Map<string, Role>()
    for (const p of data.planners) {
      const direct = data.plannerMembers.find((m) => m.planner_id === p.id)?.role
      const viaFolder = p.folder_id ? folderRole.get(p.folder_id) : undefined
      const best = [direct, viaFolder].filter(Boolean).sort((a, b) => ROLE_RANK[b!] - ROLE_RANK[a!])[0]
      if (best) plannerRole.set(p.id, best)
    }
    return { folderRole, plannerRole }
  }, [data, userId])

  return { data, setData, reload: load, roles, db }
}

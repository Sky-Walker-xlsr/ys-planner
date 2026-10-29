'use client'
import { useMemo } from 'react'
import { useCurrentUser } from '@/components/app/current-user'
import { PlannerProvider, type Viewer } from '@/lib/store/planner-store'
import { PlannerView } from './planner-view'

export function UserPlannerPage({ plannerId }: { plannerId: string }) {
  const me = useCurrentUser()
  const viewer = useMemo<Viewer>(
    () => ({ kind: 'user', id: me.id, name: me.display_name, color: me.avatar_color }),
    [me],
  )
  return (
    <PlannerProvider key={plannerId} plannerId={plannerId} viewer={viewer}>
      <PlannerView />
    </PlannerProvider>
  )
}

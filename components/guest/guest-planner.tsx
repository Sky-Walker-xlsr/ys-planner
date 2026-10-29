'use client'
import { useMemo } from 'react'
import { PlannerProvider, type Viewer } from '@/lib/store/planner-store'
import { PlannerView } from '@/components/planner/planner-view'

export function GuestPlanner({ plannerId, viewer }: { plannerId: string; viewer: Extract<Viewer, { kind: 'guest' }> }) {
  const v = useMemo<Viewer>(() => viewer, [viewer.id, viewer.linkId, viewer.perm, viewer.name]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <PlannerProvider plannerId={plannerId} viewer={v}>
      <PlannerView guest />
    </PlannerProvider>
  )
}

import { UserPlannerPage } from '@/components/planner/user-planner-page'

export default async function Page({ params }: { params: Promise<{ plannerId: string }> }) {
  const { plannerId } = await params
  return <UserPlannerPage plannerId={plannerId} />
}

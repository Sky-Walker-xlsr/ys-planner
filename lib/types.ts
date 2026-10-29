export type Role = 'owner' | 'editor' | 'viewer'
export type TaskStatus = 'not_started' | 'in_progress' | 'done'
export type TaskPriority = 'urgent' | 'important' | 'medium' | 'low'

export type User = { id: string; email: string; display_name: string; avatar_color: string }
export type UserSettings = {
  user_id: string
  theme: 'light' | 'dark'
  notify_enabled: boolean
  notify_email: string | null
  notify_on_assign: boolean
  notify_on_due: boolean
  notify_on_mention: boolean
  notify_on_invite: boolean
}

export type Folder = { id: string; owner_id: string; name: string; position: number }
export type FolderMember = { folder_id: string; user_id: string; role: Role }
export type Planner = { id: string; owner_id: string; folder_id: string | null; name: string; color: string; position: number }
export type PlannerMember = { planner_id: string; user_id: string; role: Role }
export type Favorite = { user_id: string; planner_id: string; position: number }

export type Bucket = { id: string; planner_id: string; name: string; position: number }
export type Label = { id: string; planner_id: string; name: string; color: string }
export type Task = {
  id: string
  planner_id: string
  bucket_id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  start_date: string | null
  due_date: string | null
  position: number
  created_by: string | null
  created_by_guest: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}
export type TaskAssignee = { task_id: string; user_id: string; planner_id: string }
export type TaskLabel = { task_id: string; label_id: string; planner_id: string }
export type TaskSection = { id: string; task_id: string; planner_id: string; title: string; due_date: string | null; position: number }
export type SectionItem = { id: string; section_id: string; planner_id: string; title: string; done: boolean; position: number }
export type Comment = {
  id: string
  task_id: string
  planner_id: string
  author_user_id: string | null
  guest_id: string | null
  guest_name: string | null
  body: string
  mentions: string[]
  created_at: string
}
export type KbFile = {
  id: string
  planner_id: string
  name: string
  storage_path: string
  updated_by: string | null
  updated_by_guest: string | null
  updated_at: string
}
export type TaskAttachment = { task_id: string; kb_file_id: string; planner_id: string }

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Nicht begonnen',
  in_progress: 'In Arbeit',
  done: 'Erledigt',
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: 'Dringend',
  important: 'Wichtig',
  medium: 'Mittel',
  low: 'Niedrig',
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Bearbeiter',
  viewer: 'Leser',
}

export const ROLE_RANK: Record<Role, number> = { owner: 3, editor: 2, viewer: 1 }

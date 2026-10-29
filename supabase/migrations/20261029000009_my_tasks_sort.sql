-- ys-planner: Sortierung und Gruppierung von «Meine Aufgaben» pro User
alter table public.user_settings
  add column my_tasks_sort text not null default 'due'
    check (my_tasks_sort in ('due', 'priority', 'priority_due', 'due_priority')),
  add column my_tasks_grouped boolean not null default true;

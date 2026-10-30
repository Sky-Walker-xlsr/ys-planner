-- ys-planner: Beschreibung pro Abschnitt, steht im Task-Popup zwischen Titel und Punkten
alter table public.task_sections add column description text not null default '' check (length(description) <= 20000);

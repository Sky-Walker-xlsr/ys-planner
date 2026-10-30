-- ys-planner: Pro Task wählbar, ob der Anfang der Beschreibung auf der Board-Karte steht
alter table public.tasks add column show_description boolean not null default false;

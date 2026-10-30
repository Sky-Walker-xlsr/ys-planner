-- ys-planner: Erinnerung pro User abgelöst durch tasks.remind_at (Tabelle war leer)
drop function public.claim_due_reminders(integer);
drop table public.task_reminders;
drop function app.tg_task_reminder_rearm();

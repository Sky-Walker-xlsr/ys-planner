# ys-planner – To-do

## Erinnerung im Task-Popup

Im Task-Popup ein Feld «Erinnern am …» (Datum + Uhrzeit), an dem man sich per Mail an den Task erinnern lassen kann.

- Nur verfügbar, wenn in den Einstellungen eine Benachrichtigungs-Mail gesetzt ist (`user_settings.notify_email`); sonst Feld deaktiviert mit Hinweis auf die Einstellungen.
- Erinnerung gilt pro User (nicht für alle Mitglieder des Tasks).
- Versand per Resend im bestehenden Mail-Template, mit Link zum Task.

Offene Punkte zur Umsetzung:
- Tabelle `task_reminders (task_id, user_id, remind_at, sent_at)` mit RLS (nur eigene Zeilen, Lesezugriff auf den Task nötig).
- Versand: Cron Trigger häufiger als täglich (z. B. alle 5 Min.) oder Cloudflare Queues/Durable-Object-Alarm für genaue Zeitpunkte – Genauigkeit klären.
- Zeitzone: Eingabe in Europe/Zurich, Speicherung als `timestamptz`.
- Gilt auch für Inbox-Tasks?

## Beschreibungsfeld im Task-Popup wächst mit

Bei langer Beschreibung soll das Feld (und damit das Popup) mit dem Inhalt höher werden, statt intern zu scrollen.

- Textarea automatisch an die Inhaltshöhe anpassen (z. B. `field-sizing: content` bzw. Höhe per `scrollHeight`), mit sinnvoller Mindesthöhe.
- Das Popup selbst bleibt auf die Fensterhöhe begrenzt und scrollt dann als Ganzes.

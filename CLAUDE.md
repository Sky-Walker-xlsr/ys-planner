# CLAUDE.md

@AGENTS.md

Planner-Web-App im Stil von MS Planner, live auf https://planner.salm.li. Die UI ist Deutsch und für den Desktop gebaut. Details zu Architektur und Einrichtung stehen in `docs/SETUP.md`.

## Befehle

```bash
npm run dev          # Dev-Server auf Port 3040
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # Vitest, Tests liegen neben dem Code (lib/**/*.test.ts)
npm run test:rls     # supabase/tests/rls.test.sql gegen DATABASE_URL, läuft in BEGIN … ROLLBACK
npm run preview      # OpenNext-Build und wrangler dev
npm run deploy       # Build und Deploy auf Cloudflare
```

## Achtung: Lokal ist nicht isoliert

`npm run dev` nutzt die **Produktions-Datenbank** aus `.env.local` und den **echten R2-Bucket** (`remote = true` in `wrangler.toml`). Der Hinweis in `docs/SETUP.md`, Wrangler simuliere den Bucket lokal, ist veraltet. Änderungen beim lokalen Testen betreffen also echte Daten.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `app/(app)/` | Eingeloggte Seiten: Board (`p/[plannerId]`), `meine-aufgaben`, `alle-tasks`, `eingang`, `einstellungen` |
| `app/s/[token]/` | Share-Links für Gäste |
| `app/api/` | Route Handler: Auth, Dateien, Cron, Mail-Eingang |
| `app/mcp/`, `app/oauth/`, `lib/mcp/` | MCP-Zugang mit OAuth 2.1 |
| `lib/auth/` | OIDC, Session-Cookie, Supabase-JWTs |
| `lib/supabase/` | Browser- und Server-Client |
| `lib/inbound/` | Mail an Planner |
| `lib/notify.ts`, `lib/mail.ts` | Benachrichtigungen und Versand über Resend |
| `worker.ts` | Worker-Einstieg: OpenNext, `scheduled` (Cron), `email` (Email Routing) |
| `supabase/migrations/` | Schema, Funktionen, Trigger, RLS |

## Regeln

- **Rechte gehören in die Datenbank:** Daten laufen mit dem JWT des Users, RLS entscheidet. Neue Rechtelogik baut auf `planner_role()` und `folder_role()` auf.
- **Service-Client nur serverseitig:** `createServiceClient()` umgeht RLS und ist nur für Login, Share-Link-Prüfung, Mails und Cron gedacht.
- **R2 hat kein RLS:** Jeder Dateizugriff läuft über einen Route Handler, der die Rolle prüft (`lib/file-access.ts`).
- **Migrationen:** Neue Datei in `supabase/migrations/` mit fortlaufendem Zeitstempel, bestehende nicht ändern. Bei neuen Tabellen oder Policies `supabase/tests/rls.test.sql` ergänzen.
- **Trigger beachten:** Sie setzen Positionen (`max + 1024`), Owner, `created_by` und die Mitgliedschaft des Erstellers. Diese Werte nicht zusätzlich in der App setzen.
- **Der Ersteller bleibt Owner:** Der Trigger verbietet, seine Mitgliedschaft zu löschen. Beim Aufräumen eines Users zuerst seine Planner und Ordner löschen, dann den User.
- **Mails:** Zuweisen, Kommentare und Einladungen schicken Mails aus den Route Handlern. Direktes SQL löst keine aus.
- **Markdown ohne Bilder:** `components/ui/rich-text.tsx` zeigt bewusst keine Bilder an, damit fremde Bild-Adressen niemanden beim Lesen verraten.
- **Texte:** UI-Texte auf Deutsch, mit Schweizer Schreibweise (`ss` statt `ß`).
- **Secrets:** Nie in `wrangler.toml` oder ins Repo, das Repo ist öffentlich. Secrets gehen über `wrangler secret put`, neue Variablen auch in `.env.example` eintragen.

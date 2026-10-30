# ys-planner

Planner-Web-App im Stil von MS Planner: Boards mit Buckets, Raster, Zeitplan, Diagramme, Knowledge Base pro Planner, Ordner-Freigaben, Share-Links für Gäste, Live-Updates und E-Mail-Benachrichtigungen.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Cloudflare Workers via `@opennextjs/cloudflare` · Supabase (Postgres, RLS, Realtime) · Cloudflare R2 (Dateien) · Zitadel (OIDC) · Resend

---

## Architektur in Kürze

| Thema | Umsetzung |
|---|---|
| Login | Zitadel, Authorization Code + PKCE (`oauth4webapi`). Zitadel liefert nur die Identität. |
| Benutzer | Beim Login wird `public.users` per `zitadel_sub` angelegt bzw. aktualisiert (Service-Role). |
| App-Session | Signiertes, httpOnly Cookie `ys_planner_session` (HS256, `SESSION_SECRET`, 14 Tage). |
| Datenzugriff | Der Server stellt kurzlebige **Supabase-JWTs** aus (10 Min., `role: authenticated`, `sub` = `users.id`). Browser- und Server-Client bekommen sie über die `accessToken`-Option; `/api/token` erneuert sie automatisch. RLS und Realtime greifen dadurch mit der echten User-ID. |
| Gäste | `/s/{token}` prüft Link, Passwort, Ablauf und Widerruf und setzt ein Gast-Cookie. Gast-JWT: zufällige `sub`, Claims `share_link_id`, `planner_id`, `share_permission`, `guest_name`. RLS prüft den Link bei **jeder** Abfrage, Widerruf wirkt also sofort. |
| Rechte | Eine SQL-Funktion `planner_role(planner_id)` liefert die effektive Rolle (höchste aus `planner_members` und `folder_members` bzw. Gast-Link). Alle Policies bauen darauf auf. |
| Dateien | Cloudflare R2 (Binding `FILES`, Bucket `planner-files`). R2 hat kein RLS: Jeder Zugriff läuft über Route Handler, die die Metadaten-Zeile mit dem JWT des Aufrufers lesen (RLS) und `planner_role()` prüfen, also dieselbe Logik wie die Policies, inklusive Gast-Claims. Metadaten liegen in Postgres. |
| Service-Role | Nur serverseitig: Login, Share-Link-Erstellung/-Prüfung, Mailversand, Cron. |
| Ordner | Ordner können verschachtelt sein. Freigaben gelten für den Ordner und alles darunter, die höchste Rolle der Kette zählt. Wer nur einen Unterordner hat, sieht den Elternordner nicht, aber dessen Mitglieder. |
| Benachrichtigungen | Zuweisen, Kommentare und Einladungen laufen über Route-Handler (mit User-JWT, RLS aktiv). Die Mail geht danach per `after()` raus. Fälligkeiten: Cron Trigger. |

### Entscheidung: eigene JWTs mit Supabase JWT Signing Keys

Laut aktueller Supabase-Doku ([JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys)) kann man einen **eigenen privaten Schlüssel importieren** (ES256 empfohlen) und damit selbst Tokens ausstellen. Supabase verifiziert sie über die JWKS des Projekts, und das gilt für Data API, Realtime und Storage. Das alte JWT-Secret (HS256) ist laut Doku „nicht mehr empfohlen“.

**Third-Party Auth** (auch „Custom OIDC“) wurde verworfen. Dort wäre `sub` die Zitadel-ID statt `users.id`, und es gäbe keinen Weg, Gast-Tokens mit eigenen Claims auszustellen.

Folge: ys-planner signiert mit einem ES256-Schlüssel (`SUPABASE_JWT_PRIVATE_KEY`), der in Supabase als aktiver Signing Key importiert ist. Die `kid` im JWT-Header muss der importierten entsprechen.

---

## Lokales Setup

Voraussetzungen: Node.js 22+, npm.

```bash
npm install
cp .env.example .env.local   # Werte ausfüllen, siehe unten
npm run dev                  # http://localhost:3040
```

| Befehl | Zweck |
|---|---|
| `npm run dev` | Dev-Server auf Port 3040 |
| `npm run build` | Next-Build |
| `npm run typecheck` / `npm run lint` | Prüfungen |
| `npm run gen:signing-key` | Neuen ES256-JWK für Supabase erzeugen |
| `npm run test:rls` | RLS-Tests gegen `DATABASE_URL` |
| `npm test` | Worker-Tests (Mail an Planner, Vitest) |
| `npm run preview` | Lokal als Cloudflare Worker (wrangler dev) |
| `npm run deploy` | Build + Deploy auf Cloudflare |

Secrets erzeugen:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Supabase-Setup

1. **Projekt anlegen** (Supabase Cloud). Unter *Project Settings → API Keys* den Publishable Key (`sb_publishable_…`) und einen Secret Key (`sb_secret_…`) kopieren und in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` bzw. `SUPABASE_SECRET_KEY` eintragen.

2. **Signing Key importieren**
   ```bash
   npm run gen:signing-key      # gibt den privaten JWK als eine Zeile aus
   ```
   - Die Ausgabe kommt nach `SUPABASE_JWT_PRIVATE_KEY`.
   - Im Dashboard: *Project Settings → JWT Keys*. Falls nötig zuerst vom Legacy-Secret auf Signing Keys migrieren.
   - Dann *Create Standby Key → Import an existing private key*, JWK einfügen, danach **Rotate keys**.
   - Prüfen: `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` enthält die `kid`.

3. **Schema einspielen** (Tabellen, Funktionen, RLS, Realtime-Publication):
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push              # alle Migrationen
   npx supabase db push --include-seed   # optional: zusätzlich Demodaten (supabase/seed.sql)
   ```

4. **Realtime:** Unter *Realtime → Settings* „Allow public access“ deaktivieren. Presence läuft über private Channels (`planner:{id}`), abgesichert durch Policies auf `realtime.messages`.

5. **Demodaten übernehmen (optional):** Die Seed-User haben fiktive `zitadel_sub`. Nach deinem ersten Login:
   ```sql
   delete from public.users where email = '<deine mail>' and zitadel_sub not like 'seed|%';
   update public.users set zitadel_sub = '<deine sub>', email = '<deine mail>' where email = 'anna.meier@example.com';
   ```

### Migrationen

| Datei | Inhalt |
|---|---|
| `…0001_schema.sql` | Enums, Tabellen, Indizes |
| `…0002_functions_triggers.sql` | `planner_role()`, `folder_role()`, Gast-Helfer, Trigger (updated_at, Positionen, Ersteller als Owner, Autor aus JWT, Aktivitätsprotokoll) |
| `…0003_rls.sql` | Alle RLS-Policies, Spaltenrechte für `share_links` |
| `…0004_storage_realtime.sql` | Bucket `knowledge-base` (privat, nur `text/markdown`, max. 2 MB), Storage-Policies, Realtime-Publication, Presence-Policies |
| `…0005_task_files.sql` | Datei-Uploads an Tasks (`task_files`, damals Bucket `task-files`) |
| `…0006_r2_paths.sql` | Trigger setzen R2-Schlüssel (`kb/…`, `tasks/…`); Mail-Anhänge bis 25 MB |
| `…0007_drop_supabase_storage.sql` | Erst **nach** der Storage-Migration: strenge Pfad-Checks, Supabase-Storage-Policies entfernen |
| `…0008_mail_inbox.sql` | Eingang (`tasks.planner_id`/`bucket_id` nullable, `owner_id`, `mail_sender`), `user_tags`, `user_sender_emails`, `planners.mail_tag`, `user_settings.inbox_local`, Verschiebe-Trigger (Tags → Labels) |
| `…0009_my_tasks_sort.sql` | `user_settings.my_tasks_sort` / `my_tasks_grouped` (Sortierung von «Meine Aufgaben») |

### RLS-Tests

`supabase/tests/rls.test.sql` prüft knapp 100 Fälle für Owner, Bearbeiter, Leser, Ordner-Mitglied, Gast-read, Gast-edit, Fremde sowie widerrufene, abgelaufene und gefälschte Gast-Links, inklusive der Rechte, auf die sich die R2-Routen stützen. Die Datei läuft komplett in `BEGIN … ROLLBACK`, jede Prüfung zusätzlich in einer Subtransaktion. Es bleiben **keine Daten** zurück, auch nicht gegen Produktion.

```bash
DATABASE_URL="postgresql://postgres.<ref>:<passwort>@<host>:5432/postgres" npm run test:rls
```
(Connection-String: *Project Settings → Database*, Rolle `postgres`, Session-Pooler oder Direktverbindung.)

---

## Cloudflare R2

Alle Dateien liegen im R2-Bucket `planner-files` (Account `yannicksalm.ch`, siehe `account_id` in `wrangler.toml`):

| Schlüssel | Inhalt |
|---|---|
| `kb/{planner_id}/{kb_file_id}.md` | Knowledge Base |
| `tasks/{task_id}/{file_id}-{dateiname}` | Task-Anhänge |
| `inbox/{user_id}/{task_id}/{file_id}-{dateiname}` | Anhänge von Eingangs-Tasks (per Mail) |

Einrichten (einmalig, bereits erledigt):
```bash
npx wrangler r2 bucket create planner-files
```
Das Binding `FILES` steht in `wrangler.toml`. Lokal (`npm run dev`) simuliert Wrangler den Bucket unter `.wrangler/state`. Nach Änderungen an `wrangler.toml`: `npx wrangler types --env-interface CloudflareEnv --include-runtime=false cloudflare-env.d.ts`.

Routen (alle mit Rechteprüfung, Gäste übergeben `?link=<share_link_id>`):

| Route | Zweck |
|---|---|
| `GET/PUT/DELETE /api/kb/{fileId}` | Knowledge-Base-Inhalt lesen, speichern (max. 2 MB, Markdown), löschen |
| `POST /api/tasks/{id}/files` | Datei an Task hochladen (max. 10 MB) |
| `GET/DELETE /api/task-files/{fileId}` | Task-Datei ausliefern (`?download` erzwingt Download) bzw. löschen |
| `DELETE /api/tasks/{id}`, `DELETE /api/planners/{id}` | Löschen inkl. aller Dateien in R2 |

Downloads werden durch den Worker gestreamt. Da sie von der App-Domain kommen, werden nur Rasterbilder inline ausgeliefert. Alles andere geht als Download raus, mit `X-Content-Type-Options: nosniff` und `Content-Security-Policy: sandbox`.

### Storage-Migration (Supabase Storage → R2)

Einmalig, für Dateien aus der Zeit vor R2:

1. Code mit R2-Unterstützung deployen und Migration `…0006_r2_paths.sql` anwenden. Neue Dateien landen ab jetzt in R2. Alte Zeilen liefern bis Schritt 2 `503 Speicher-Migration ausstehend`, es geht also nichts verloren.
2. Kopieren und verifizieren:
   ```bash
   node --env-file=.env.local scripts/migrate-storage-to-r2.mjs --dry-run
   node --env-file=.env.local scripts/migrate-storage-to-r2.mjs
   ```
   Das Skript lädt jedes Objekt aus `knowledge-base` bzw. `task-files`, schreibt es per Wrangler nach R2, liest es zurück und vergleicht die SHA-256-Prüfsumme. Erst danach stellt es `storage_path` um. Bei Fehlern endet es mit Exit-Code 1 und kann einfach erneut laufen.
3. Verifizieren: Das Skript meldet „Alle Dateien kopiert und verifiziert“. Zusätzlich darf diese Abfrage keine Zeilen liefern:
   ```sql
   select id from kb_files where storage_path not like 'kb/%'
   union all select id from task_files where storage_path !~ '^(tasks|inbox)/';
   ```
4. Migration `…0007_drop_supabase_storage.sql` anwenden (Pfad-Checks, Storage-Policies weg).
5. **Erst dann** die Supabase-Buckets löschen: Dashboard → *Storage* → `knowledge-base` und `task-files` → *Delete bucket*. Supabase erlaubt das Löschen nicht per SQL.

---

## Mail an Planner (Cloudflare Email Routing)

Jeder User hat genau eine zufällige Adresse `{zufall}@salm.li` (`user_settings.inbox_local`, Domain über `INBOX_DOMAIN`). Er sieht sie in den Einstellungen unter «Mail an Planner» und kann sie neu generieren, die alte gilt dann sofort nicht mehr. Plus-Adressen gibt es nicht.

**Ablauf:** Email Routing (Catch-all) → `worker.ts › email()` → interne Route `POST /api/inbound` (geschützt mit `CRON_SECRET`) → `lib/inbound/process.ts`. Lehnt die Route ab, ruft der Worker `message.setReject(…)` auf.

- **Absender:** Erlaubt sind nur die Zitadel-Mail des Users und bestätigte Adressen aus `user_sender_emails`. Bestätigt wird über einen Link per Resend, gültig 24 h. Zusätzlich muss im obersten `Authentication-Results`-Header DKIM oder SPF für die Domain des Absenders `pass` sein. Alles andere wird abgelehnt.
- **Betreff:** `#dringend`, `#wichtig`, `#mittel` und `#niedrig` setzen die Priorität. `#tag` passend zum Mail-Tag eines Planners legt den Task in dessen ersten Bucket (dafür ist die Rolle Bearbeiter nötig). Kommt ein Tag mehrfach vor, gewinnt der eigene Planner, sonst landet der Task im Eingang, mit Hinweis in der Bestätigungsmail. Übrige Tags werden im Planner zu Labels, im Eingang zu persönlichen Tags. `Fwd:`, `FW:`, `WG:`, `AW:` und `Re:` werden entfernt. Ist der Betreff leer, heisst der Task «(Ohne Betreff)».
- **Inhalt:** Die Beschreibung ist der Text-Teil der Mail, ersatzweise das HTML als Markdown. Anhänge landen in R2 (`task_files`), insgesamt bis 25 MB, alles darüber wird übersprungen. Inline-Bilder unter 10 KB (Signaturen) werden ignoriert. Der Absender wird in `tasks.mail_sender` gespeichert.
- **Eingang** (`/eingang`): Tasks ohne Planner, nur für ihren Owner sichtbar (RLS). Verschieben geht per Dialog oder per Drag & Drop auf einen Planner in der Seitenleiste. Dabei werden die Tags zu Labels (Trigger `tg_tasks_after_move`), die Dateien wandern von `inbox/…` nach `tasks/…`.
- **Tests:** `npm test` (Vitest, `lib/inbound/process.test.ts`).

### Einrichten

1. Zone `salm.li` muss in Cloudflare aktiv sein, im Account «Yannick Dev» wie der Worker.
2. Dashboard → `salm.li` → *Email* → *Email Routing* → aktivieren. Cloudflare legt dabei MX- und SPF-Einträge an. **Achtung:** Danach geht jede Mail an `@salm.li` über Cloudflare. Bestehende Postfächer auf `salm.li` funktionieren nicht mehr.
3. *Routing rules* → *Catch-all address* → Aktion **Send to a Worker** → `ys-planner` → aktivieren.
4. Testen: Eine Mail von deiner Login-Adresse an die Adresse aus den Einstellungen schicken.

---

## Zitadel-App-Konfiguration

In der Zitadel-Konsole: Projekt → *Neue Applikation* → **Web**.

| Einstellung | Wert |
|---|---|
| Authentifizierungsmethode | **PKCE** (Auth-Methode „None“, kein Secret) |
| Antworttyp / Berechtigungstyp | Code / Authorization Code |
| Redirect URIs | `http://localhost:3040/api/auth/callback`, `https://<domain>/api/auth/callback` |
| Post-Logout URIs | `http://localhost:3040/`, `https://<domain>/` |
| Development Mode | an, solange `http://localhost` verwendet wird |
| Token-Einstellungen | **„User Info inside ID Token“ aktivieren** (Name und E-Mail werden aus dem ID-Token gelesen) |

`.env`: `ZITADEL_ISSUER=https://<zitadel-domain>` (ohne Pfad und ohne `/` am Ende), `ZITADEL_CLIENT_ID=<Client-ID>`, `ZITADEL_CLIENT_SECRET` leer lassen. Wer statt PKCE „Code“ mit Secret nutzt, muss die Methode **Post** wählen und das Secret setzen.

Eingeladen werden können nur User, die sich mindestens einmal angemeldet haben (sie stehen dann in `public.users`).

---

## Resend

1. Domain in Resend verifizieren (DNS-Einträge).
2. API-Key erstellen → `RESEND_API_KEY`.
3. Absender setzen: `MAIL_FROM="ys-planner <planner@deine-domain.ch>"`.

Mails gehen nur raus, wenn in den Einstellungen des Empfängers `notify_enabled` und das jeweilige Häkchen gesetzt sind. Empfänger ist `notify_email`, standardmässig die Zitadel-Mail, frei änderbar.

---

## Deployment auf Cloudflare

1. `wrangler.toml` anpassen: `[vars]` (öffentliche Werte), optional `[[routes]]` mit eigener Domain. `APP_URL` muss exakt der öffentlichen URL entsprechen und in Zitadel als Redirect-URI eingetragen sein.
2. Secrets setzen (je eigene, neue Werte für Produktion):
   ```bash
   npx wrangler secret put SUPABASE_SECRET_KEY
   npx wrangler secret put SUPABASE_JWT_PRIVATE_KEY
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put SHARE_LINK_SECRET   # nach Go-live nicht mehr ändern (bestehende Links)
   npx wrangler secret put CRON_SECRET
   npx wrangler secret put RESEND_API_KEY
   ```
3. Die `NEXT_PUBLIC_*`-Werte werden beim Build ins Client-Bundle übernommen und müssen deshalb auch beim Build vorhanden sein (`.env.local` bzw. `.env.production`).
4. Deploy:
   ```bash
   npm run deploy
   ```

### Cron Trigger

`worker.ts` umhüllt den OpenNext-Worker und ergänzt einen `scheduled`-Handler. Cloudflare-Crons laufen in UTC, deshalb sind zwei Zeiten konfiguriert: `0 5 * * *` (Sommerzeit) und `0 6 * * *` (Winterzeit). `/api/cron/due` läuft nur, wenn es in Europe/Zurich 07:00 ist. Pro User wird eine gebündelte Mail mit allen morgen fälligen Aufgaben und Abschnitten verschickt.

Der dritte Cron (`*/5 * * * *`) ruft `/api/cron/reminders` auf und verschickt die Erinnerungen aus dem Task-Popup, also auf bis zu 5 Minuten genau. Sie gehen an alle Zugewiesenen (im Eingang an den Besitzer), an die Benachrichtigungs-Mail oder sonst an die Login-Mail, und unabhängig von den Benachrichtigungs-Einstellungen. Keine Mail geht raus, wenn der Task erledigt ist oder niemand zugewiesen ist.

Manuell auslösen (z. B. zum Testen):
```bash
curl -X POST "https://<domain>/api/cron/due?force=1" -H "Authorization: Bearer $CRON_SECRET"
```

---

## Umgebungsvariablen

Siehe `.env.example`.

| Variable | Wo | Beschreibung |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | var | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | var | Publishable Key |
| `SUPABASE_SECRET_KEY` | secret | Secret Key (Service-Role), nur Server |
| `SUPABASE_JWT_PRIVATE_KEY` | secret | Privater ES256-JWK, in Supabase importiert |
| `APP_URL` | var | Öffentliche Basis-URL |
| `SESSION_SECRET` | secret | Signiert Session- und Gast-Cookies |
| `SHARE_LINK_SECRET` | secret | Verschlüsselt Share-Link-Tokens (zum erneuten Kopieren) |
| `CRON_SECRET` | secret | Schützt `/api/cron/due`, `/api/cron/reminders` und `/api/inbound` (interne Worker-Aufrufe) |
| `ZITADEL_ISSUER`, `ZITADEL_CLIENT_ID` | var | OIDC |
| `ZITADEL_CLIENT_SECRET` | secret | nur ohne PKCE |
| `RESEND_API_KEY` | secret | Resend |
| `MAIL_FROM` | var | Absender |
| `INBOX_DOMAIN` | var | Domain der Mail-an-Planner-Adressen (`salm.li`) |
| `DATABASE_URL` | lokal | nur für `npm run test:rls` |

---

## Hinweise zu Designentscheidungen

- **Share-Link-Tokens:** In der DB liegen ein SHA-256-Hash (Lookup) und eine AES-GCM-verschlüsselte Kopie. Nur so kann der Owner unter „Aktive Links“ einen Link später erneut kopieren. Hashes sind per Spaltenrechten für Clients nicht lesbar.
- **Passwörter für Share-Links:** PBKDF2-SHA256 (100'000 Iterationen, Maximum in Workers).
- **Ordner und Planner verschieben:** Nur der Owner des Planners, der zugleich Owner des Zielordners ist (Trigger `tg_planners_before`). Der Ersteller eines Planners oder Ordners bleibt immer Owner.
- **Gäste** sehen weder Ordner noch andere Planner. Mitglieder des Planners (inkl. Ordner-Mitglieder) sehen sie, damit Zuweisen möglich ist.
- **Positionen** sind Fließkommazahlen (Fractional Indexing). Neue Einträge bekommen per Trigger `max + 1024`.

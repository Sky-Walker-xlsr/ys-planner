'use client'
import { useEffect, useState } from 'react'
import { useCurrentUser } from '@/components/app/current-user'
import { Avatar } from '@/components/ui/avatar'
import { Checkbox, Switch } from '@/components/ui/controls'
import { toast } from '@/components/ui/toast'
import { getBrowserClient } from '@/lib/supabase/browser'
import type { UserSettings } from '@/lib/types'
import { BoardBackgroundCard } from './board-background-card'
import { MailInboxCard } from './mail-inbox-card'
import { McpCard } from './mcp-card'

export function SettingsView() {
  const me = useCurrentUser()
  const db = getBrowserClient()
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void db.from('user_settings').select('*').eq('user_id', me.id).maybeSingle<UserSettings>().then(({ data }) => {
      setSettings(
        data ?? {
          user_id: me.id, theme: 'light', notify_enabled: true, notify_email: me.email,
          notify_on_assign: true, notify_on_due: true, notify_on_mention: true, notify_on_invite: true,
          board_bg_color: null, board_bg_image_at: null,
        },
      )
    })
  }, [db, me])

  async function setTheme(theme: 'light' | 'dark') {
    if (!settings) return
    document.documentElement.classList.toggle('dark', theme === 'dark')
    setSettings({ ...settings, theme })
    const { error } = await db.from('user_settings').upsert({ user_id: me.id, theme })
    if (error) toast('Darstellung konnte nicht gespeichert werden')
  }

  async function saveNotifications(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setSaving(true)
    const { error } = await db.from('user_settings').upsert({
      user_id: me.id,
      notify_enabled: settings.notify_enabled,
      notify_email: settings.notify_email?.trim() || null,
      notify_on_assign: settings.notify_on_assign,
      notify_on_due: settings.notify_on_due,
      notify_on_mention: settings.notify_on_mention,
      notify_on_invite: settings.notify_on_invite,
    })
    setSaving(false)
    if (error?.message.includes('notify_email_not_confirmed')) {
      toast('Diese Adresse ist nicht bestätigt. Hinterlege sie zuerst unter «Mail an Planner».')
      return
    }
    toast(error ? 'Einstellungen konnten nicht gespeichert werden' : 'Gespeichert')
  }

  const set = <K extends keyof UserSettings>(k: K, v: UserSettings[K]) => settings && setSettings({ ...settings, [k]: v })

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="border-b border-line bg-surface px-5 py-4">
        <h1 className="text-lg font-semibold">Konto-Einstellungen</h1>
      </header>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-5">
        <section className="card p-5" aria-labelledby="profile-title">
          <h2 id="profile-title" className="mb-4 text-sm font-semibold">Profil</h2>
          <div className="flex items-center gap-4">
            <Avatar name={me.display_name} color={me.avatar_color} size={52} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{me.display_name}</div>
              <div className="truncate text-sm text-text-2">{me.email}</div>
              <div className="mt-1 text-xs text-text-2">Login über Zitadel · Profildaten werden dort verwaltet</div>
            </div>
          </div>
          <form action="/api/auth/logout" method="post" className="mt-4">
            <button type="submit" className="btn-secondary">Abmelden</button>
          </form>
        </section>

        <MailInboxCard />

        <McpCard />

        <section className="card p-5" aria-labelledby="theme-title">
          <h2 id="theme-title" className="mb-4 text-sm font-semibold">Darstellung</h2>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby="theme-title">
            <ThemeTile label="Hell" value="light" current={settings?.theme} onSelect={setTheme} />
            <ThemeTile label="Dunkel" value="dark" current={settings?.theme} onSelect={setTheme} />
          </div>
        </section>

        {settings && <BoardBackgroundCard settings={settings} onChange={(patch) => setSettings({ ...settings, ...patch })} />}

        <section className="card p-5" aria-labelledby="notify-title">
          <h2 id="notify-title" className="mb-4 text-sm font-semibold">E-Mail-Benachrichtigungen</h2>
          {settings && (
            <form onSubmit={saveNotifications} className="flex flex-col gap-4">
              <Switch id="notify-enabled" label={settings.notify_enabled ? 'Aktiv' : 'Inaktiv'} checked={settings.notify_enabled} onChange={(v) => set('notify_enabled', v)} />
              <div>
                <label htmlFor="notify-email" className="field-label">E-Mail-Adresse für Benachrichtigungen</label>
                <input id="notify-email" type="email" className="input" disabled={!settings.notify_enabled}
                  value={settings.notify_email ?? ''} onChange={(e) => set('notify_email', e.target.value)} />
                <p className="mt-1 text-xs text-text-2">Erlaubt sind deine Login-Mail und bestätigte Adressen aus «Mail an Planner».</p>
              </div>
              <fieldset disabled={!settings.notify_enabled} className="flex flex-col disabled:opacity-60">
                <legend className="field-label">Benachrichtigen bei</legend>
                <Checkbox label="Aufgabe zugewiesen" checked={settings.notify_on_assign} onChange={(v) => set('notify_on_assign', v)} />
                <Checkbox label="Fälligkeit: am Vortag und am Tag selbst (Aufgabe oder Abschnitt)" checked={settings.notify_on_due} onChange={(v) => set('notify_on_due', v)} />
                <Checkbox label="In Kommentar erwähnt" checked={settings.notify_on_mention} onChange={(v) => set('notify_on_mention', v)} />
                <Checkbox label="Zu Planner oder Ordner eingeladen" checked={settings.notify_on_invite} onChange={(v) => set('notify_on_invite', v)} />
              </fieldset>
              <div>
                <button type="submit" className="btn-primary" disabled={saving}>Speichern</button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  )
}

function ThemeTile({
  label,
  value,
  current,
  onSelect,
}: {
  label: string
  value: 'light' | 'dark'
  current: 'light' | 'dark' | undefined
  onSelect: (v: 'light' | 'dark') => void
}) {
  const selected = current === value
  const c = value === 'light'
    ? { bg: '#F5F6F8', surface: '#FFFFFF', side: '#FAFAFB', line: '#E3E5E8', text: '#1B1D21', accent: '#1F7A57' }
    : { bg: '#15171A', surface: '#1E2125', side: '#191B1E', line: '#2E3237', text: '#E8EAED', accent: '#4CC38A' }
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(value)}
      className={`rounded-card border-2 p-2 text-left cursor-pointer ${selected ? 'border-accent' : 'border-line hover:border-text-2'}`}
    >
      <div className="flex h-24 overflow-hidden rounded-md border" style={{ background: c.bg, borderColor: c.line }} aria-hidden>
        <div className="w-1/4 border-r p-1.5" style={{ background: c.side, borderColor: c.line }}>
          <div className="mb-1 h-1.5 rounded" style={{ background: c.accent }} />
          <div className="mb-1 h-1 rounded" style={{ background: c.line }} />
          <div className="h-1 rounded" style={{ background: c.line }} />
        </div>
        <div className="flex flex-1 gap-1.5 p-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-1 flex-col gap-1">
              <div className="h-1.5 w-2/3 rounded" style={{ background: c.text, opacity: 0.6 }} />
              <div className="h-6 rounded border" style={{ background: c.surface, borderColor: c.line }} />
              <div className="h-6 rounded border" style={{ background: c.surface, borderColor: c.line }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 px-1 text-sm font-medium">{label}</div>
    </button>
  )
}

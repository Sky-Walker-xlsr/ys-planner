'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { ArrowLeftRight, Check, Copy, Download, FileIcon, Lock, Paperclip, Send, X } from 'lucide-react'
import { useCurrentUser } from '@/components/app/current-user'
import { Avatar } from '@/components/ui/avatar'
import { toast } from '@/components/ui/toast'
import { getBrowserClient } from '@/lib/supabase/browser'
import { formatBytes } from '@/lib/image'
import {
  chunkSize, ICE_SERVERS, MAX_FILE_BYTES, newSessionId, orderedGuests, SESSION_ID,
  type PresenceMeta, type Signal, type WireMessage,
} from '@/lib/direct-share'

type Phase =
  | { kind: 'idle' }
  | { kind: 'waiting' } // Host wartet auf jemanden
  | { kind: 'request'; peer: Peer } // Host: jemand möchte beitreten
  | { kind: 'joining' } // Gast wartet auf Annahme
  | { kind: 'connecting'; peer: Peer }
  | { kind: 'connected'; peer: Peer }
  | { kind: 'ended'; reason: string; peer?: Peer }

type Peer = { key: string; name: string; color: string }

type Item =
  | { kind: 'msg'; id: string; mine: boolean; text: string; at: string }
  | { kind: 'file'; id: string; mine: boolean; name: string; size: number; mime: string; at: string; done: number; url?: string }

const hostFlag = (id: string) => `p2p-host:${id}`

/** Direkt teilen: Eine Session für genau zwei Personen, Inhalte gehen per WebRTC von Browser zu Browser */
export function DirectShare() {
  const me = useCurrentUser()
  const router = useRouter()
  const pathname = usePathname()
  const sessionId = useSearchParams().get('s')
  const valid = !!sessionId && SESSION_ID.test(sessionId)

  function start() {
    const id = newSessionId()
    try {
      sessionStorage.setItem(hostFlag(id), '1')
    } catch {
      /* ohne Storage: Host nur bis zum Neuladen */
    }
    router.replace(`${pathname}?s=${id}`)
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="border-b border-line bg-surface px-5 py-4">
        <h1 className="text-lg font-semibold">Direkt teilen</h1>
        <p className="text-sm text-text-2">
          Dateien und Nachrichten direkt zwischen zwei Browsern. Nichts wird hochgeladen oder gespeichert.
        </p>
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-5">
        {sessionId && !valid && <p className="text-sm text-danger">Dieser Link ist ungültig.</p>}
        {!sessionId && <StartCard onStart={start} />}
        {valid && <Session key={sessionId} sessionId={sessionId} me={me} onLeave={() => router.replace(pathname)} />}
      </div>
    </div>
  )
}

function StartCard({ onStart }: { onStart: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <ArrowLeftRight size={28} className="text-accent" />
      <p className="max-w-md text-sm text-text-2">
        Starte eine Session und schick den Link einer Person. Sobald du sie annimmst, könnt ihr Dateien und Nachrichten
        austauschen, Ende-zu-Ende verschlüsselt. Wenn ihr beide auf «Fertig» klickt, wird die Session geschlossen.
      </p>
      <button type="button" className="btn-primary" onClick={onStart}>Session starten</button>
    </div>
  )
}

function Session({ sessionId, me, onLeave }: { sessionId: string; me: { id: string; display_name: string; avatar_color: string }; onLeave: () => void }) {
  const db = getBrowserClient()
  const isHost = useMemo(() => {
    try {
      return sessionStorage.getItem(hostFlag(sessionId)) === '1'
    } catch {
      return false
    }
  }, [sessionId])
  // Eigener Schlüssel pro Tab: So kannst du auch Dateien zwischen zwei eigenen Geräten schicken
  const myKey = useMemo(() => `${me.id}:${crypto.randomUUID().slice(0, 8)}`, [me.id])

  const [phase, setPhaseState] = useState<Phase>({ kind: isHost ? 'waiting' : 'joining' })
  const phaseRef = useRef(phase)
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  const [items, setItems] = useState<Item[]>([])
  const [myDone, setMyDone] = useState(false)
  const [peerDone, setPeerDone] = useState(false)
  const [busy, setBusy] = useState(0) // laufende Übertragungen (senden + empfangen)
  const doneRef = useRef({ me: false, peer: false })
  useEffect(() => {
    doneRef.current = { me: myDone, peer: peerDone }
  }, [myDone, peerDone])

  const channel = useRef<RealtimeChannel | null>(null)
  const pc = useRef<RTCPeerConnection | null>(null)
  const dc = useRef<RTCDataChannel | null>(null)
  const pendingIce = useRef<RTCIceCandidateInit[]>([])
  const urls = useRef<string[]>([])
  const incoming = useRef<{ id: string; size: number; mime: string; parts: ArrayBuffer[]; received: number; lastUi: number } | null>(null)
  const sendQueue = useRef<Promise<void>>(Promise.resolve())

  const signal = useCallback((s: Signal) => {
    void channel.current?.send({ type: 'broadcast', event: 'signal', payload: s })
  }, [])

  const leaveChannel = useCallback(() => {
    if (channel.current) void db.removeChannel(channel.current)
    channel.current = null
  }, [db])

  const end = useCallback(
    (reason: string) => {
      if (phaseRef.current.kind === 'ended') return
      const peer = 'peer' in phaseRef.current ? phaseRef.current.peer : undefined
      setPhase({ kind: 'ended', reason, peer })
      dc.current?.close()
      pc.current?.close()
      dc.current = null
      pc.current = null
      leaveChannel()
      try {
        sessionStorage.removeItem(hostFlag(sessionId))
      } catch {
        /* egal */
      }
    },
    [leaveChannel, sessionId, setPhase],
  )

  const patchItem = useCallback((id: string, patch: Partial<Item>) => {
    setItems((list) => list.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i)))
  }, [])

  // ---------------------------------------------------------------- DataChannel
  const setupChannel = useCallback(
    (ch: RTCDataChannel, peer: Peer) => {
      dc.current = ch
      ch.binaryType = 'arraybuffer'
      ch.bufferedAmountLowThreshold = 1024 * 1024
      ch.onopen = () => {
        setPhase({ kind: 'connected', peer })
        // Verbunden: Die Signalisierung wird nicht mehr gebraucht, niemand sonst kann beitreten
        leaveChannel()
      }
      ch.onclose = () =>
        end(doneRef.current.me && doneRef.current.peer ? 'Ihr seid beide fertig. Die Session ist geschlossen.' : 'Die Verbindung wurde getrennt.')
      ch.onmessage = (e) => {
        if (typeof e.data !== 'string') {
          const cur = incoming.current
          if (!cur) return
          const buf = e.data as ArrayBuffer
          cur.parts.push(buf)
          cur.received += buf.byteLength
          if (Date.now() - cur.lastUi > 150) {
            cur.lastUi = Date.now()
            patchItem(cur.id, { done: cur.received })
          }
          return
        }
        let m: WireMessage
        try {
          m = JSON.parse(e.data) as WireMessage
        } catch {
          return
        }
        if (m.t === 'msg') {
          setItems((l) => [...l, { kind: 'msg', id: m.id, mine: false, text: String(m.text).slice(0, 10_000), at: m.at }])
        } else if (m.t === 'file') {
          if (m.size > MAX_FILE_BYTES) return
          incoming.current = { id: m.id, size: m.size, mime: m.mime, parts: [], received: 0, lastUi: 0 }
          setBusy((b) => b + 1)
          setItems((l) => [...l, { kind: 'file', id: m.id, mine: false, name: String(m.name).slice(0, 255), size: m.size, mime: m.mime, at: m.at, done: 0 }])
        } else if (m.t === 'end') {
          const cur = incoming.current
          if (!cur || cur.id !== m.id) return
          incoming.current = null
          const url = URL.createObjectURL(new Blob(cur.parts, { type: cur.mime || 'application/octet-stream' }))
          urls.current.push(url)
          patchItem(cur.id, { done: cur.received, url })
          setBusy((b) => b - 1)
        } else if (m.t === 'done') {
          setPeerDone(!!m.value)
        }
      }
    },
    [end, leaveChannel, patchItem, setPhase],
  )

  const createPeer = useCallback(
    (peer: Peer) => {
      const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pc.current = conn
      conn.onicecandidate = (e) => {
        if (e.candidate) signal({ kind: 'ice', from: myKey, to: peer.key, candidate: e.candidate.toJSON() })
      }
      conn.onconnectionstatechange = () => {
        if (conn.connectionState === 'failed') {
          end('Es konnte keine direkte Verbindung aufgebaut werden. Vermutlich blockiert ein Netzwerk direkte Verbindungen.')
        }
      }
      return conn
    },
    [end, myKey, signal],
  )

  // ---------------------------------------------------------------- Signalisierung
  useEffect(() => {
    const ch = db.channel(`p2p:${sessionId}`, { config: { private: true, presence: { key: myKey } } })
    channel.current = ch
    const joinedAt = Date.now()
    let hostSeen = false

    const peers = () => {
      const state = ch.presenceState<PresenceMeta>()
      return Object.entries(state)
        .filter(([key]) => key !== myKey)
        .map(([key, metas]) => ({ key, meta: metas[metas.length - 1] }))
        .filter((e) => e.meta)
    }
    const toPeer = (e: { key: string; meta: PresenceMeta }): Peer => ({ key: e.key, name: e.meta.name, color: e.meta.color })

    ch.on('presence', { event: 'sync' }, () => {
      const list = peers()
      const p = phaseRef.current
      if (isHost) {
        const first = orderedGuests(list)[0]
        if (p.kind === 'waiting' && first) setPhase({ kind: 'request', peer: toPeer(first) })
        else if (p.kind === 'request' && !list.some((e) => e.key === p.peer.key)) setPhase({ kind: 'waiting' })
        return
      }
      const host = list.find((e) => e.meta.role === 'host')
      if (host) hostSeen = true
      if (p.kind !== 'joining') return
      if (!host) {
        if (hostSeen) end('Die Session ist nicht mehr verfügbar.')
        return
      }
      // Ist schon jemand vor mir da, ist die Session besetzt
      const mine = { key: myKey, meta: { name: '', color: '', role: 'guest' as const, joinedAt } }
      if (orderedGuests([...list, mine])[0].key !== myKey) end('Die Session ist bereits besetzt. Sie ist nur für zwei Personen.')
    })

    ch.on('broadcast', { event: 'signal' }, async ({ payload }) => {
      const s = payload as Signal
      if (s.to !== myKey) return
      const p = phaseRef.current
      try {
        if (s.kind === 'reject') return end('Die Anfrage wurde abgelehnt.')
        if (s.kind === 'bye') return end('Die andere Person hat die Session beendet.')
        if (s.kind === 'accept' && !isHost && p.kind === 'joining') {
          const host = peers().find((e) => e.key === s.from)
          const peer: Peer = host ? toPeer(host) : { key: s.from, name: 'Gegenüber', color: '#5F6670' }
          setPhase({ kind: 'connecting', peer })
          const conn = createPeer(peer)
          conn.ondatachannel = (e) => setupChannel(e.channel, peer)
          return
        }
        const conn = pc.current
        if (!conn || !('peer' in p) || p.peer?.key !== s.from) return
        if (s.kind === 'offer' && !isHost) {
          await conn.setRemoteDescription(s.sdp)
          for (const c of pendingIce.current.splice(0)) await conn.addIceCandidate(c)
          const answer = await conn.createAnswer()
          await conn.setLocalDescription(answer)
          signal({ kind: 'answer', from: myKey, to: s.from, sdp: answer })
        } else if (s.kind === 'answer' && isHost) {
          await conn.setRemoteDescription(s.sdp)
          for (const c of pendingIce.current.splice(0)) await conn.addIceCandidate(c)
        } else if (s.kind === 'ice') {
          if (conn.remoteDescription) await conn.addIceCandidate(s.candidate)
          else pendingIce.current.push(s.candidate)
        }
      } catch (e) {
        console.error(e)
        end('Die Verbindung konnte nicht aufgebaut werden.')
      }
    })

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void ch.track({ name: me.display_name, color: me.avatar_color, role: isHost ? 'host' : 'guest', joinedAt } satisfies PresenceMeta)
      } else if (status === 'CHANNEL_ERROR' && phaseRef.current.kind !== 'connected') {
        end('Die Session konnte nicht geöffnet werden.')
      }
    })

    // Gast: Ist nach einigen Sekunden kein Host da, gibt es die Session nicht (mehr)
    const timeout = isHost
      ? null
      : setTimeout(() => {
          if (phaseRef.current.kind === 'joining' && !hostSeen) end('Die Session ist nicht mehr verfügbar. Bitte um einen neuen Link.')
        }, 6000)

    return () => {
      if (timeout) clearTimeout(timeout)
      if (channel.current === ch) leaveChannel()
    }
  }, [db, sessionId, myKey, isHost, me.display_name, me.avatar_color, createPeer, setupChannel, signal, end, leaveChannel, setPhase])

  // Verbindungsaufbau hängt (z. B. Gegenüber hat den Tab geschlossen)
  useEffect(() => {
    if (phase.kind !== 'connecting') return
    const t = setTimeout(() => end('Die Verbindung konnte nicht aufgebaut werden.'), 25_000)
    return () => clearTimeout(t)
  }, [phase.kind, end])

  // Aufräumen beim Verlassen der Seite
  useEffect(() => {
    const list = urls.current
    return () => {
      dc.current?.close()
      pc.current?.close()
      list.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  // Warnen, solange die Session läuft oder empfangene Dateien noch nicht gespeichert sind
  useEffect(() => {
    const active = phase.kind === 'connected' || phase.kind === 'connecting' || items.some((i) => i.kind === 'file' && !i.mine)
    if (!active) return
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [phase.kind, items])

  // Beide fertig: Session schliessen
  useEffect(() => {
    if (myDone && peerDone && busy === 0 && phase.kind === 'connected') {
      // Kurz warten, damit das eigene «done» sicher beim Gegenüber ankommt
      const t = setTimeout(() => end('Ihr seid beide fertig. Die Session ist geschlossen.'), 300)
      return () => clearTimeout(t)
    }
  }, [myDone, peerDone, busy, phase.kind, end])

  // ---------------------------------------------------------------- Aktionen
  async function accept(peer: Peer) {
    setPhase({ kind: 'connecting', peer })
    signal({ kind: 'accept', from: myKey, to: peer.key })
    const conn = createPeer(peer)
    setupChannel(conn.createDataChannel('share', { ordered: true }), peer)
    const offer = await conn.createOffer()
    await conn.setLocalDescription(offer)
    signal({ kind: 'offer', from: myKey, to: peer.key, sdp: offer })
  }

  function reject(peer: Peer) {
    signal({ kind: 'reject', from: myKey, to: peer.key })
    setPhase({ kind: 'waiting' })
  }

  function leave() {
    const p = phaseRef.current
    if ('peer' in p && p.peer && channel.current) signal({ kind: 'bye', from: myKey, to: p.peer.key })
    end('Du hast die Session beendet.')
    onLeave()
  }

  function send(m: WireMessage) {
    const ch = dc.current
    if (!ch || ch.readyState !== 'open') return false
    ch.send(JSON.stringify(m))
    return true
  }

  function sendText(text: string) {
    const m: WireMessage = { t: 'msg', id: crypto.randomUUID(), text, at: new Date().toISOString() }
    if (!send(m)) return false
    setItems((l) => [...l, { kind: 'msg', id: m.id, mine: true, text, at: m.at }])
    return true
  }

  async function waitForBuffer(ch: RTCDataChannel) {
    if (ch.bufferedAmount <= 4 * 1024 * 1024) return
    await new Promise<void>((resolve) => {
      const done = () => {
        ch.removeEventListener('bufferedamountlow', done)
        ch.removeEventListener('close', done)
        resolve()
      }
      ch.addEventListener('bufferedamountlow', done)
      ch.addEventListener('close', done)
    })
  }

  function sendFiles(files: File[]) {
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        toast(`${file.name}: grösser als ${formatBytes(MAX_FILE_BYTES)}`)
        continue
      }
      const id = crypto.randomUUID()
      const at = new Date().toISOString()
      setItems((l) => [...l, { kind: 'file', id, mine: true, name: file.name, size: file.size, mime: file.type, at, done: 0 }])
      setBusy((b) => b + 1)
      // Nacheinander senden: Die Chunks einer Datei dürfen sich nicht mit einer anderen mischen
      sendQueue.current = sendQueue.current.then(async () => {
        const ch = dc.current
        try {
          if (!ch || ch.readyState !== 'open') throw new Error('closed')
          ch.send(JSON.stringify({ t: 'file', id, name: file.name, size: file.size, mime: file.type, at } satisfies WireMessage))
          const size = chunkSize(pc.current?.sctp?.maxMessageSize)
          let lastUi = 0
          for (let off = 0; off < file.size; off += size) {
            await waitForBuffer(ch)
            if (ch.readyState !== 'open') throw new Error('closed')
            ch.send(await file.slice(off, off + size).arrayBuffer())
            if (Date.now() - lastUi > 150) {
              lastUi = Date.now()
              patchItem(id, { done: Math.min(file.size, off + size) })
            }
          }
          ch.send(JSON.stringify({ t: 'end', id } satisfies WireMessage))
          patchItem(id, { done: file.size })
        } catch {
          toast(`${file.name} konnte nicht gesendet werden`)
        } finally {
          setBusy((b) => b - 1)
        }
      })
    }
  }

  function toggleDone() {
    const next = !myDone
    if (send({ t: 'done', value: next })) setMyDone(next)
  }

  // ---------------------------------------------------------------- Ansicht
  const link = typeof window !== 'undefined' ? `${window.location.origin}/direkt?s=${sessionId}` : ''

  if (phase.kind === 'waiting' || phase.kind === 'request') {
    return (
      <div className="card flex flex-col gap-4 p-6">
        <div>
          <h2 className="font-semibold">Session ist offen</h2>
          <p className="mt-1 text-sm text-text-2">Schick diesen Link einer Person. Die Session ist nur für euch zwei.</p>
        </div>
        <div className="flex gap-2">
          <input className="input flex-1 font-mono text-xs" readOnly value={link} aria-label="Einladungslink" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard.writeText(link).then(() => toast('Link kopiert'))}>
            <Copy size={14} /> Kopieren
          </button>
        </div>
        {phase.kind === 'request' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-card border border-accent bg-accent-soft p-3" role="alert">
            <Avatar name={phase.peer.name} color={phase.peer.color} size={28} />
            <span className="flex-1 text-sm"><strong>{phase.peer.name}</strong> möchte beitreten.</span>
            <button type="button" className="btn-secondary" onClick={() => reject(phase.peer)}>Ablehnen</button>
            <button type="button" className="btn-primary" onClick={() => void accept(phase.peer)}>Annehmen</button>
          </div>
        ) : (
          <p className="text-sm text-text-2">Warte auf die andere Person …</p>
        )}
        <div><button type="button" className="btn-text" onClick={leave}>Session abbrechen</button></div>
      </div>
    )
  }

  if (phase.kind === 'joining' || phase.kind === 'connecting') {
    return (
      <div className="card flex flex-col gap-3 p-6">
        <h2 className="font-semibold">{phase.kind === 'joining' ? 'Warte auf Annahme …' : 'Verbindung wird aufgebaut …'}</h2>
        <p className="text-sm text-text-2">
          {phase.kind === 'joining' ? 'Die Person, die dir den Link geschickt hat, muss dich annehmen.' : `Direkte Verbindung zu ${phase.peer.name}.`}
        </p>
        <div><button type="button" className="btn-text" onClick={leave}>Abbrechen</button></div>
      </div>
    )
  }

  const ended = phase.kind === 'ended'
  const peer = phase.kind === 'connected' || phase.kind === 'ended' ? phase.peer : undefined
  if (ended && items.length === 0) {
    return (
      <div className="card flex flex-col gap-3 p-6">
        <h2 className="font-semibold">Session beendet</h2>
        <p className="text-sm text-text-2">{phase.reason}</p>
        <div><button type="button" className="btn-primary" onClick={onLeave}>Neue Session</button></div>
      </div>
    )
  }

  return (
    <div className="card flex min-h-[420px] flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        {peer && <Avatar name={peer.name} color={peer.color} size={28} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{peer?.name ?? 'Session'}</div>
          <div className="flex items-center gap-1 text-xs text-text-2">
            <Lock size={11} />
            {ended ? 'Session geschlossen' : 'Direkt verbunden, Ende-zu-Ende verschlüsselt'}
            {!ended && peerDone && ' · ist fertig'}
          </div>
        </div>
        {!ended && (
          <>
            <button type="button" className={myDone ? 'btn-secondary border-accent text-accent' : 'btn-primary'} onClick={toggleDone} disabled={busy > 0}
              title={busy > 0 ? 'Warte, bis alle Übertragungen fertig sind' : undefined}>
              <Check size={14} /> {myDone ? 'Fertig, warte auf Gegenüber' : 'Fertig'}
            </button>
            <button type="button" className="btn-icon" aria-label="Session verlassen" title="Session verlassen" onClick={leave}>
              <X size={18} />
            </button>
          </>
        )}
      </div>

      <Timeline items={items} />

      {ended ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-sm">
          <span className="flex-1 text-text-2">{phase.reason} Empfangene Dateien bleiben nur bis zum Verlassen der Seite verfügbar.</span>
          <button type="button" className="btn-secondary" onClick={onLeave}>Neue Session</button>
        </div>
      ) : (
        <Composer onText={sendText} onFiles={sendFiles} />
      )}
    </div>
  )
}

function Timeline({ items }: { items: Item[] }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [items.length])
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4" aria-live="polite">
      {items.length === 0 && <p className="m-auto text-sm text-text-2">Noch nichts ausgetauscht. Zieh Dateien hierher oder schreib eine Nachricht.</p>}
      {items.map((i) => (
        <div key={i.id} className={`flex ${i.mine ? 'justify-end' : 'justify-start'}`}>
          {i.kind === 'msg' ? (
            <p className={`max-w-[75%] whitespace-pre-wrap break-words rounded-card px-3 py-2 text-sm ${i.mine ? 'bg-accent text-on-accent' : 'bg-bg'}`}>{i.text}</p>
          ) : (
            <FileBubble item={i} />
          )}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

function FileBubble({ item }: { item: Extract<Item, { kind: 'file' }> }) {
  const pct = item.size ? Math.round((item.done / item.size) * 100) : 100
  const complete = item.mine ? item.done >= item.size : !!item.url
  return (
    <div className="flex w-72 max-w-full items-center gap-3 rounded-card border border-line bg-surface p-3">
      <FileIcon size={20} className="shrink-0 text-text-2" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={item.name}>{item.name}</div>
        <div className="text-xs text-text-2">
          {formatBytes(item.size)} · {complete ? (item.mine ? 'gesendet' : 'empfangen') : `${pct} %`}
        </div>
        {!complete && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {item.url && (
        <a href={item.url} download={item.name} className="btn-icon" aria-label={`${item.name} herunterladen`} title="Herunterladen">
          <Download size={16} />
        </a>
      )}
    </div>
  )
}

function Composer({ onText, onFiles }: { onText: (text: string) => boolean; onFiles: (files: File[]) => void }) {
  const [text, setText] = useState('')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = text.trim()
    if (v && onText(v)) setText('')
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      }}
      className={`flex items-end gap-2 border-t px-4 py-3 ${over ? 'border-accent bg-accent-soft' : 'border-line'}`}
    >
      <input ref={input} type="file" multiple hidden onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
      <button type="button" className="btn-icon" aria-label="Dateien senden" title="Dateien senden" onClick={() => input.current?.click()}>
        <Paperclip size={18} />
      </button>
      <textarea
        className="input flex-1 resize-none"
        rows={1}
        placeholder={over ? 'Loslassen zum Senden' : 'Nachricht schreiben'}
        aria-label="Nachricht"
        value={text}
        maxLength={10_000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit(e)
          }
        }}
      />
      <button type="submit" className="btn-primary" disabled={!text.trim()} aria-label="Senden">
        <Send size={14} />
      </button>
    </form>
  )
}

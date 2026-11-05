'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeftRight, Check, Copy, Download, FileIcon, Lock, Paperclip, Send, X } from 'lucide-react'
import { useCurrentUser } from '@/components/app/current-user'
import { Avatar } from '@/components/ui/avatar'
import { toast } from '@/components/ui/toast'
import { formatBytes } from '@/lib/image'
import {
  CHUNK_BYTES, decryptFrame, deriveSharedKey, encryptFrame, exportPublicKey, FRAME_CHUNK, FRAME_JSON, generateKeys, MAX_FILE_BYTES,
  MIN_ROOM_LENGTH, newSessionId, normalizeRoom, roomSessionId, safetyCode, SESSION_ID, type RelayMessage, type WireMessage,
} from '@/lib/direct-share'

type Phase =
  | { kind: 'idle' }
  | { kind: 'waiting' } // Host wartet auf jemanden
  | { kind: 'request'; peer: Peer } // Host: jemand möchte beitreten
  | { kind: 'joining'; peer?: Peer } // Gast wartet auf Annahme
  | { kind: 'connecting'; peer: Peer }
  | { kind: 'connected'; peer: Peer }
  | { kind: 'ended'; reason: string; peer?: Peer }

type Peer = { key: string; name: string }

type Item =
  | { kind: 'msg'; id: string; mine: boolean; text: string; at: string }
  | { kind: 'file'; id: string; mine: boolean; name: string; size: number; mime: string; at: string; done: number; url?: string }

const hostFlag = (id: string) => `p2p-host:${id}`

/** Direkt teilen: Eine Session für genau zwei Personen, Inhalte gehen Ende-zu-Ende verschlüsselt über den Relay (lib/direct-relay.ts) */
export function DirectShare() {
  const me = useCurrentUser()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const room = params.get('raum')
  const linkId = params.get('s')
  const [roomId, setRoomId] = useState<{ room: string; id: string } | null>(null)
  useEffect(() => {
    if (!room) return
    let alive = true
    void roomSessionId(room).then((id) => {
      if (alive) setRoomId({ room, id })
    })
    return () => {
      alive = false
    }
  }, [room])
  const sessionId = room ? (roomId?.room === room ? roomId.id : null) : linkId
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
          Dateien und Nachrichten zwischen zwei Geräten, Ende-zu-Ende verschlüsselt. Nichts wird gespeichert.
        </p>
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-5">
        {!room && linkId && !valid && <p className="text-sm text-danger">Dieser Link ist ungültig.</p>}
        {!room && !linkId && (
          <StartCard onStart={start} onRoom={(name) => router.replace(`${pathname}?raum=${encodeURIComponent(normalizeRoom(name))}`)} />
        )}
        {valid && (
          <Session key={sessionId} sessionId={sessionId} room={room ?? undefined} me={me} onLeave={() => router.replace(pathname)} />
        )}
      </div>
    </div>
  )
}

function StartCard({ onStart, onRoom }: { onStart: () => void; onRoom: (name: string) => void }) {
  const [name, setName] = useState('')
  const ok = normalizeRoom(name).length >= MIN_ROOM_LENGTH
  return (
    <div className="flex flex-col gap-4">
      <form
        className="card flex flex-col gap-3 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) onRoom(name)
        }}
      >
        <div>
          <h2 className="font-semibold">Raum per Name</h2>
          <p className="mt-1 text-sm text-text-2">
            Gebt beide denselben Raumnamen ein, auch auf zwei eigenen Geräten. Sobald zwei im Raum sind, verbindet ihr euch
            automatisch. Wähle einen Namen, den niemand errät.
          </p>
        </div>
        <div className="flex gap-2">
          <input className="input flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. blaue-giraffe-42"
            aria-label="Raumname" maxLength={100} autoComplete="off" />
          <button type="submit" className="btn-primary" disabled={!ok}>Raum betreten</button>
        </div>
        {name && !ok && <p className="text-xs text-text-2">Mindestens {MIN_ROOM_LENGTH} Zeichen.</p>}
      </form>
      <div className="card flex flex-col items-center gap-3 p-6 text-center">
        <ArrowLeftRight size={28} className="text-accent" />
        <p className="max-w-md text-sm text-text-2">
          Oder starte eine Session per Link: Du schickst den Link einer Person und nimmst sie an, sobald sie beitritt.
        </p>
        <button type="button" className="btn-secondary" onClick={onStart}>Session per Link starten</button>
      </div>
      <p className="text-center text-xs text-text-2">
        Dateien und Nachrichten werden im Browser verschlüsselt, der Server leitet sie nur weiter und speichert nichts. Wenn ihr beide auf «Fertig»
        klickt, wird die Session geschlossen.
      </p>
    </div>
  )
}

function Session({ sessionId, room, me, onLeave }: {
  sessionId: string
  /** Raum per Name: kein Annehmen, die zwei im Raum verbinden sich automatisch */
  room?: string
  me: { id: string; display_name: string; avatar_color: string }
  onLeave: () => void
}) {
  void me
  const linkHost = useMemo(() => {
    if (room) return false
    try {
      return sessionStorage.getItem(hostFlag(sessionId)) === '1'
    } catch {
      return false
    }
  }, [sessionId, room])

  const [phase, setPhaseState] = useState<Phase>({ kind: room || linkHost ? 'waiting' : 'joining' })
  const phaseRef = useRef(phase)
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  const [items, setItems] = useState<Item[]>([])
  const [myDone, setMyDone] = useState(false)
  const [peerDone, setPeerDone] = useState(false)
  const [busy, setBusy] = useState(0) // laufende Übertragungen (senden + empfangen)
  const [code, setCode] = useState<string | null>(null)
  const doneRef = useRef({ me: false, peer: false })
  useEffect(() => {
    doneRef.current = { me: myDone, peer: peerDone }
  }, [myDone, peerDone])

  const ws = useRef<WebSocket | null>(null)
  const keys = useRef<Promise<{ pair: CryptoKeyPair; pub: string }> | null>(null)
  const shared = useRef<CryptoKey | null>(null)
  const sentKey = useRef(false)
  const urls = useRef<string[]>([])
  const incoming = useRef<{ id: string; size: number; mime: string; parts: Uint8Array[]; received: number; lastUi: number } | null>(null)
  // Reihenfolge sichern: Verschlüsseln und Entschlüsseln sind asynchron
  const sendChain = useRef<Promise<void>>(Promise.resolve())
  const recvChain = useRef<Promise<void>>(Promise.resolve())
  const fileQueue = useRef<Promise<void>>(Promise.resolve())

  const end = useCallback(
    (reason: string) => {
      if (phaseRef.current.kind === 'ended') return
      const peer = 'peer' in phaseRef.current ? phaseRef.current.peer : undefined
      setPhase({ kind: 'ended', reason, peer })
      shared.current = null
      try {
        ws.current?.close(1000)
      } catch {
        /* egal */
      }
      ws.current = null
      try {
        sessionStorage.removeItem(hostFlag(sessionId))
      } catch {
        /* egal */
      }
    },
    [sessionId, setPhase],
  )

  const patchItem = useCallback((id: string, patch: Partial<Item>) => {
    setItems((list) => list.map((i) => (i.id === id ? ({ ...i, ...patch } as Item) : i)))
  }, [])

  const sendPlain = useCallback((m: RelayMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m))
  }, [])

  /** Verschlüsselt senden, in Reihenfolge. Resolved, sobald der Frame im Sendepuffer liegt. */
  const sendFrame = useCallback((kind: number, data: Uint8Array) => {
    const next = sendChain.current.then(async () => {
      const sock = ws.current
      const key = shared.current
      if (!sock || !key || sock.readyState !== WebSocket.OPEN) throw new Error('closed')
      const frame = await encryptFrame(key, kind, data)
      // Backpressure: nicht mehr als ein paar MB im Puffer
      while (sock.bufferedAmount > 8 * 1024 * 1024) {
        if (sock.readyState !== WebSocket.OPEN) throw new Error('closed')
        await new Promise((r) => setTimeout(r, 20))
      }
      sock.send(frame)
    })
    sendChain.current = next.catch(() => {})
    return next
  }, [])

  const sendMessage = useCallback(
    (m: WireMessage) => sendFrame(FRAME_JSON, new TextEncoder().encode(JSON.stringify(m))),
    [sendFrame],
  )

  const sendMyKey = useCallback(() => {
    if (sentKey.current || !keys.current) return
    sentKey.current = true
    void keys.current.then(({ pub }) => sendPlain({ type: 'key', key: pub }))
  }, [sendPlain])

  const onFrame = useCallback(
    (kind: number, data: Uint8Array) => {
      if (kind === FRAME_CHUNK) {
        const cur = incoming.current
        if (!cur) return
        cur.parts.push(data.slice())
        cur.received += data.byteLength
        if (Date.now() - cur.lastUi > 150) {
          cur.lastUi = Date.now()
          patchItem(cur.id, { done: cur.received })
        }
        return
      }
      let m: WireMessage
      try {
        m = JSON.parse(new TextDecoder().decode(data)) as WireMessage
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
        const url = URL.createObjectURL(new Blob(cur.parts as BlobPart[], { type: cur.mime || 'application/octet-stream' }))
        urls.current.push(url)
        patchItem(cur.id, { done: cur.received, url })
        setBusy((b) => b - 1)
      } else if (m.t === 'done') {
        setPeerDone(!!m.value)
      }
    },
    [patchItem],
  )

  // ---------------------------------------------------------------- Verbindung zum Relay
  useEffect(() => {
    let closed = false
    let alone: ReturnType<typeof setTimeout> | null = null
    keys.current = generateKeys().then(async (pair) => ({ pair, pub: await exportPublicKey(pair) }))
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const sock = new WebSocket(`${proto}://${location.host}/api/direkt/ws?id=${sessionId}`)
    sock.binaryType = 'arraybuffer'
    ws.current = sock
    // Keepalive: Ohne Verkehr trennt Cloudflare die Verbindung; der Relay antwortet automatisch
    const ping = setInterval(() => {
      if (sock.readyState === WebSocket.OPEN) sock.send('ping')
    }, 20_000)

    sock.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        const frame = ev.data as ArrayBuffer
        recvChain.current = recvChain.current.then(async () => {
          const key = shared.current
          if (!key) return
          try {
            const { kind, data } = await decryptFrame(key, frame)
            onFrame(kind, data)
          } catch {
            /* manipuliert oder falscher Schlüssel: verwerfen */
          }
        })
        return
      }
      if (ev.data === 'pong') return
      let m: RelayMessage
      try {
        m = JSON.parse(ev.data) as RelayMessage
      } catch {
        return
      }
      const p = phaseRef.current
      if (m.type === 'waiting') {
        // Link-Gast allein im Raum: Der Gastgeber ist nicht (mehr) da
        if (!room && !linkHost) {
          alone = setTimeout(() => end('Die Session ist nicht mehr verfügbar. Bitte um einen neuen Link.'), 4000)
        }
      } else if (m.type === 'peer') {
        if (alone) clearTimeout(alone)
        const peer: Peer = { key: m.uid, name: m.name }
        if (room) {
          setPhase({ kind: 'connecting', peer })
          sendMyKey()
        } else if (linkHost) {
          setPhase({ kind: 'request', peer })
        } else {
          setPhase({ kind: 'joining', peer })
        }
      } else if (m.type === 'accept') {
        if (p.kind === 'joining' && p.peer) {
          setPhase({ kind: 'connecting', peer: p.peer })
          sendMyKey()
        }
      } else if (m.type === 'reject') {
        end('Die Anfrage wurde abgelehnt.')
      } else if (m.type === 'key') {
        if (!keys.current || !('peer' in p) || !p.peer) return
        const peer = p.peer
        const theirs = m.key
        void keys.current.then(async ({ pair, pub }) => {
          shared.current = await deriveSharedKey(pair, theirs)
          sendMyKey()
          setCode(await safetyCode(pub, theirs))
          if (phaseRef.current.kind !== 'ended') setPhase({ kind: 'connected', peer })
        })
      } else if (m.type === 'peer-left') {
        if (p.kind === 'request') return setPhase({ kind: 'waiting' })
        if (p.kind === 'waiting') return
        end(doneRef.current.me && doneRef.current.peer
          ? 'Ihr seid beide fertig. Die Session ist geschlossen.'
          : 'Die andere Person hat die Session verlassen.')
      }
    }

    sock.onclose = (ev) => {
      if (closed) return
      if (ev.code === 4002) {
        return end(room ? 'In diesem Raum sind schon zwei. Wähle einen anderen Namen.' : 'Die Session ist bereits besetzt. Sie ist nur für zwei Personen.')
      }
      end(doneRef.current.me && doneRef.current.peer ? 'Ihr seid beide fertig. Die Session ist geschlossen.' : 'Die Verbindung wurde getrennt.')
    }
    sock.onerror = () => console.warn('[direkt] WebSocket-Fehler')

    return () => {
      closed = true
      clearInterval(ping)
      if (alone) clearTimeout(alone)
      try {
        sock.close(1000)
      } catch {
        /* egal */
      }
      if (ws.current === sock) ws.current = null
    }
  }, [sessionId, room, linkHost, end, setPhase, sendMyKey, onFrame])

  // Aufräumen beim Verlassen der Seite
  useEffect(() => {
    const list = urls.current
    return () => list.forEach((u) => URL.revokeObjectURL(u))
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
  function accept(peer: Peer) {
    setPhase({ kind: 'connecting', peer })
    sendPlain({ type: 'accept' })
    sendMyKey()
  }

  function reject() {
    sendPlain({ type: 'reject' })
    setPhase({ kind: 'waiting' })
  }

  function leave() {
    end('Du hast die Session beendet.')
    onLeave()
  }

  function sendText(text: string) {
    if (!shared.current) return false
    const m: WireMessage = { t: 'msg', id: crypto.randomUUID(), text, at: new Date().toISOString() }
    sendMessage(m).catch(() => toast('Nachricht konnte nicht gesendet werden'))
    setItems((l) => [...l, { kind: 'msg', id: m.id, mine: true, text, at: m.at }])
    return true
  }

  function sendFiles(files: File[]) {
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        toast(`${file.name}: grösser als ${formatBytes(MAX_FILE_BYTES)}`)
        continue
      }
      const id = crypto.randomUUID()
      const at = new Date().toISOString()
      const preview = isImage(file.type) ? URL.createObjectURL(file) : undefined
      if (preview) urls.current.push(preview)
      setItems((l) => [...l, { kind: 'file', id, mine: true, name: file.name, size: file.size, mime: file.type, at, done: 0, url: preview }])
      setBusy((b) => b + 1)
      // Dateien strikt nacheinander: Die Chunks einer Datei dürfen sich nicht mit einer anderen mischen
      fileQueue.current = fileQueue.current.then(async () => {
        try {
          await sendMessage({ t: 'file', id, name: file.name, size: file.size, mime: file.type, at })
          let lastUi = 0
          for (let off = 0; off < file.size; off += CHUNK_BYTES) {
            await sendFrame(FRAME_CHUNK, new Uint8Array(await file.slice(off, off + CHUNK_BYTES).arrayBuffer()))
            if (Date.now() - lastUi > 150) {
              lastUi = Date.now()
              patchItem(id, { done: Math.min(file.size, off + CHUNK_BYTES) })
            }
          }
          await sendMessage({ t: 'end', id })
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
    setMyDone(next)
    sendMessage({ t: 'done', value: next }).catch(() => setMyDone(!next))
  }

  // ---------------------------------------------------------------- Ansicht
  const link = typeof window !== 'undefined' ? `${window.location.origin}/direkt?s=${sessionId}` : ''

  if (room && (phase.kind === 'waiting' || phase.kind === 'joining')) {
    return (
      <div className="card flex flex-col gap-3 p-6">
        <h2 className="font-semibold">Raum «{room}»</h2>
        <p className="text-sm text-text-2">
          {phase.kind === 'waiting'
            ? 'Warte auf jemanden, der denselben Raumnamen eingibt. Das kannst auch du auf einem anderen Gerät sein.'
            : 'Gegenüber gefunden, Verbindung wird aufgebaut …'}
        </p>
        <div><button type="button" className="btn-text" onClick={leave}>Raum verlassen</button></div>
      </div>
    )
  }

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
            <Avatar name={phase.peer.name} size={28} />
            <span className="flex-1 text-sm"><strong>{phase.peer.name}</strong> möchte beitreten.</span>
            <button type="button" className="btn-secondary" onClick={reject}>Ablehnen</button>
            <button type="button" className="btn-primary" onClick={() => accept(phase.peer)}>Annehmen</button>
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
          {phase.kind === 'joining' ? 'Die Person, die dir den Link geschickt hat, muss dich annehmen.' : `Verschlüsselte Verbindung zu ${phase.peer.name}.`}
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
        {peer && <Avatar name={peer.name} size={28} />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{peer?.name ?? 'Session'}</div>
          <div className="flex items-center gap-1 text-xs text-text-2">
            <Lock size={11} />
            {ended ? 'Session geschlossen' : 'Verbunden, Ende-zu-Ende verschlüsselt'}
            {!ended && code && <span title="Steht bei beiden derselbe Code, liest niemand mit"> · Prüfcode {code}</span>}
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
        <Composer onSend={(text, files) => {
          if (text && !sendText(text)) return false
          if (files.length) sendFiles(files)
          return true
        }} />
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
      {items.length === 0 && <p className="m-auto text-sm text-text-2">Noch nichts ausgetauscht. Schreib eine Nachricht, füge ein Bild mit Ctrl+V ein oder zieh Dateien hierher.</p>}
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

const isImage = (mime: string) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(mime)

function FileBubble({ item }: { item: Extract<Item, { kind: 'file' }> }) {
  const pct = item.size ? Math.round((item.done / item.size) * 100) : 100
  const complete = item.mine ? item.done >= item.size : !!item.url
  const image = isImage(item.mime) && item.url
  return (
    <div className="flex w-72 max-w-full flex-col overflow-hidden rounded-card border border-line bg-surface">
      {image && (
        <a href={item.url} download={item.name} title={`${item.name} herunterladen`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- lokale Blob-URL */}
          <img src={item.url} alt={item.name} className="max-h-72 w-full bg-bg object-contain" />
        </a>
      )}
      <div className="flex items-center gap-3 p-3">
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
        {item.url && (!item.mine || complete) && (
          <a href={item.url} download={item.name} className="btn-icon" aria-label={`${item.name} herunterladen`} title="Herunterladen">
            <Download size={16} />
          </a>
        )}
      </div>
    </div>
  )
}

/** Bilder aus der Zwischenablage heissen meist «image.png»: Zeitstempel als Namen geben */
function namePasted(file: File) {
  if (file.name && file.name !== 'image.png' && file.name !== 'image.jpg') return file
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const t = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = `Bild ${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}.${pad(t.getMinutes())}.${pad(t.getSeconds())}.${ext}`
  return new File([file], name, { type: file.type })
}

type Attachment = { id: string; file: File; preview?: string }

/** Eingabe: Text plus Anhänge (Einfügen mit Ctrl+V, Büroklammer, Ziehen). Gesendet wird alles zusammen. */
function Composer({ onSend }: { onSend: (text: string, files: File[]) => boolean }) {
  const [text, setText] = useState('')
  const [over, setOver] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const input = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const previews = useRef<string[]>([])

  const add = useCallback((files: File[]) => {
    if (!files.length) return
    const next = files.map((file) => {
      const preview = isImage(file.type) ? URL.createObjectURL(file) : undefined
      if (preview) previews.current.push(preview)
      return { id: crypto.randomUUID(), file, preview }
    })
    setAttachments((a) => [...a, ...next])
    textarea.current?.focus()
  }, [])

  // Einfügen überall auf der Seite: Bilder und Dateien aus der Zwischenablage werden Anhänge
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = [...(e.clipboardData?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      add(files.map(namePasted))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [add])

  useEffect(() => {
    const list = previews.current
    return () => list.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = text.trim()
    if (!v && !attachments.length) return
    if (!onSend(v, attachments.map((a) => a.file))) return
    setText('')
    setAttachments([])
  }

  const canSend = !!text.trim() || attachments.length > 0

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setOver(false)
        add([...e.dataTransfer.files])
      }}
      className={`flex flex-col gap-2 border-t px-4 py-3 ${over ? 'border-accent bg-accent-soft' : 'border-line'}`}
    >
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Anhänge">
          {attachments.map((a) => (
            <li key={a.id} className="relative flex items-center gap-2 rounded-card border border-line bg-bg p-1.5 pr-7 text-xs">
              {a.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- lokale Blob-URL
                <img src={a.preview} alt="" className="size-12 rounded object-cover" />
              ) : (
                <FileIcon size={18} className="text-text-2" />
              )}
              <span className="max-w-40">
                <span className="block truncate font-medium" title={a.file.name}>{a.file.name}</span>
                <span className="text-text-2">{formatBytes(a.file.size)}</span>
              </span>
              <button type="button" className="absolute right-1 top-1 rounded p-0.5 text-text-2 hover:bg-surface hover:text-text"
                aria-label={`${a.file.name} entfernen`} onClick={() => setAttachments((l) => l.filter((x) => x.id !== a.id))}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <input ref={input} type="file" multiple hidden onChange={(e) => { add([...(e.target.files ?? [])]); e.target.value = '' }} />
        <button type="button" className="btn-icon" aria-label="Dateien anhängen" title="Dateien anhängen" onClick={() => input.current?.click()}>
          <Paperclip size={18} />
        </button>
        <textarea
          ref={textarea}
          className="input flex-1 resize-none"
          rows={1}
          placeholder={over ? 'Loslassen zum Anhängen' : 'Nachricht schreiben, Bilder mit Ctrl+V einfügen'}
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
        <button type="submit" className="btn-primary" disabled={!canSend} aria-label="Senden">
          <Send size={14} />
        </button>
      </div>
    </form>
  )
}

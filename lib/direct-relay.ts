// Direkt teilen: Relay als Durable Object. Pro Raum (idFromName(sessionId)) höchstens zwei WebSockets.
//
// Der Relay leitet nur weiter. Inhalte sind im Browser Ende-zu-Ende verschlüsselt (ECDH + AES-GCM),
// hier kommen nur verschlüsselte Binärframes und der Schlüsselaustausch (öffentliche Schlüssel) an.
// Server-Nachrichten (Text-JSON): waiting | peer {name, first} | peer-left
// Keepalive: Der Browser schickt «ping», die Runtime antwortet «pong», ohne das Objekt aufzuwecken.

import { DurableObject } from 'cloudflare:workers'
import { sanitizePeerText } from './direct-share'

/** Grösster Binärframe: 256 KiB Nutzdaten + Typ-Byte + IV + Tag mit Reserve */
const MAX_BINARY_FRAME = 256 * 1024 + 1024
const MAX_TEXT_FRAME = 1024
const CLOSE_KICKED = 4003

export type RelayPeer = { uid: string; name: string; joinedAt: number }

type Ws = WebSocket & {
  serializeAttachment(value: unknown): void
  deserializeAttachment(): unknown
}

type State = {
  acceptWebSocket(ws: WebSocket): void
  getWebSockets(): Ws[]
  setWebSocketAutoResponse(pair: unknown): void
}

declare const WebSocketPair: { new (): { 0: WebSocket; 1: WebSocket } }
declare const WebSocketRequestResponsePair: { new (request: string, response: string): unknown }

const send = (ws: WebSocket, msg: Record<string, unknown>) => {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    /* Socket schon zu */
  }
}

export class DirectRelay extends DurableObject {
  private state: State

  constructor(ctx: unknown, env: unknown) {
    super(ctx, env)
    this.state = ctx as State
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(req: Request): Promise<Response> {
    const peer = JSON.parse(req.headers.get('x-relay-peer') ?? 'null') as RelayPeer | null
    if (!peer) return new Response('Bad Request', { status: 400 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1] as Ws
    const open = this.state.getWebSockets()

    if (open.length >= 2) {
      // Raum voll: annehmen (ohne Hibernation) und mit eigenem Code schliessen, damit der Browser ihn sieht
      ;(server as unknown as { accept(): void }).accept()
      server.close(4002, 'Raum voll')
      return new Response(null, { status: 101, webSocket: client } as ResponseInit)
    }

    this.state.acceptWebSocket(server)
    server.serializeAttachment(peer)
    const other = open[0]
    if (other) {
      const o = other.deserializeAttachment() as RelayPeer
      send(other, { type: 'peer', name: peer.name, uid: peer.uid, first: true })
      send(server, { type: 'peer', name: o.name, uid: o.uid, first: false })
    } else {
      send(server, { type: 'waiting' })
    }
    return new Response(null, { status: 101, webSocket: client } as ResponseInit)
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === 'string' ? message.length > MAX_TEXT_FRAME : message.byteLength > MAX_BINARY_FRAME) {
      return ws.close(1009, 'Nachricht zu gross')
    }
    let outgoing: string | ArrayBuffer = message
    if (typeof message === 'string') {
      // «kick» vom zuerst Eingetretenen: abgelehnten Gast hinauswerfen
      if (message === '{"type":"kick"}') return this.kick(ws as Ws)
      // Nur erlaubte Nachrichten, neu aufgebaut: Niemand kann Server-Nachrichten (peer, waiting …) fälschen
      const clean = sanitizePeerText(message)
      if (!clean) return
      outgoing = clean
    }
    for (const o of this.state.getWebSockets()) {
      if (o === ws) continue
      try {
        o.send(outgoing)
      } catch {
        /* Gegenüber gerade weg */
      }
    }
  }

  webSocketClose(ws: WebSocket) {
    this.leave(ws)
  }

  webSocketError(ws: WebSocket) {
    this.leave(ws)
  }

  private kick(ws: Ws) {
    const mine = (ws.deserializeAttachment() as RelayPeer | null)?.joinedAt ?? Infinity
    for (const o of this.state.getWebSockets()) {
      if (o === ws) continue
      if (mine <= ((o.deserializeAttachment() as RelayPeer | null)?.joinedAt ?? 0)) o.close(CLOSE_KICKED, 'Abgelehnt')
    }
  }

  private leave(ws: WebSocket) {
    for (const o of this.state.getWebSockets()) if (o !== ws) send(o, { type: 'peer-left' })
    try {
      ws.close(1000, 'bye')
    } catch {
      /* schon zu */
    }
  }
}

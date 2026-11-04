// Direkt teilen: Protokoll für den WebRTC-DataChannel und die Signalisierung über Realtime.

/** Max. Dateigrösse: Empfangene Dateien liegen bis zum Herunterladen im Arbeitsspeicher */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024

/** STUN reicht für die meisten Netze; ohne TURN klappt es hinter sehr strikten Firewalls nicht */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
]

/** Nachrichten im DataChannel (als JSON-Text). Dateiinhalte folgen als Binär-Chunks zwischen file und end. */
export type WireMessage =
  | { t: 'msg'; id: string; text: string; at: string }
  | { t: 'file'; id: string; name: string; size: number; mime: string; at: string }
  | { t: 'end'; id: string }
  | { t: 'done'; value: boolean }

/** Signalisierung über den Realtime-Channel p2p:{id} */
export type Signal =
  | { kind: 'accept' | 'reject' | 'bye'; from: string; to: string }
  | { kind: 'offer' | 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }

export type PresenceMeta = { name: string; color: string; role: 'host' | 'guest'; joinedAt: number }

export const SESSION_ID = /^[0-9a-f]{32}$/

export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Gäste in Beitrittsreihenfolge; nur der erste bekommt den Platz */
export function orderedGuests(entries: { key: string; meta: PresenceMeta }[]) {
  return entries.filter((e) => e.meta.role === 'guest').sort((a, b) => a.meta.joinedAt - b.meta.joinedAt || a.key.localeCompare(b.key))
}

/** Chunk-Grösse: 64 KB, sofern die Gegenseite so grosse Nachrichten annimmt */
export function chunkSize(maxMessageSize: number | null | undefined) {
  const max = maxMessageSize && maxMessageSize > 0 ? maxMessageSize : 16 * 1024
  return Math.min(64 * 1024, max)
}

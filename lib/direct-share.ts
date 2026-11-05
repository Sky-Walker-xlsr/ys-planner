// Direkt teilen: Protokoll und Ende-zu-Ende-Verschlüsselung (ECDH P-256 → AES-GCM 256).
//
// Transport ist ein WebSocket-Relay (lib/direct-relay.ts). Der Relay sieht nur die öffentlichen
// Schlüssel beim Austausch und danach verschlüsselte Binärframes.

/** Max. Dateigrösse: Empfangene Dateien liegen bis zum Herunterladen im Arbeitsspeicher */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024

/** Klartext pro Frame; mit IV und Tag bleibt der Frame deutlich unter dem 1-MiB-Limit von Workers */
export const CHUNK_BYTES = 256 * 1024

/** Nachrichten zwischen den Browsern (verschlüsselt, Frame-Typ JSON). Dateiinhalte folgen als Chunk-Frames. */
export type WireMessage =
  | { t: 'msg'; id: string; text: string; at: string }
  | { t: 'file'; id: string; name: string; size: number; mime: string; at: string }
  | { t: 'end'; id: string }
  | { t: 'done'; value: boolean }

/** Klartext-Nachrichten über den Relay: vom Server (waiting, peer, peer-left) und vom Gegenüber (key, accept, reject) */
export type RelayMessage =
  | { type: 'waiting' }
  | { type: 'peer'; name: string; uid: string; first: boolean }
  | { type: 'peer-left' }
  | { type: 'key'; key: string }
  | { type: 'accept' }
  | { type: 'reject' }

export const FRAME_JSON = 0
export const FRAME_CHUNK = 1

export const SESSION_ID = /^[0-9a-f]{32}$/

export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Raumname vereinheitlichen: Gross-/Kleinschreibung und mehrfache Leerzeichen spielen keine Rolle */
export function normalizeRoom(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export const MIN_ROOM_LENGTH = 4

/** Gleicher Raumname → gleiche Session-ID. Der Relay sieht nur den Hash, nicht den Namen. */
export async function roomSessionId(name: string): Promise<string> {
  const data = new TextEncoder().encode(`ys-planner-direkt:${normalizeRoom(name)}`)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------- Verschlüsselung
const b64 = {
  from: (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  to: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
}

export function generateKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']) as Promise<CryptoKeyPair>
}

export async function exportPublicKey(keys: CryptoKeyPair): Promise<string> {
  return b64.from(await crypto.subtle.exportKey('raw', keys.publicKey))
}

export async function deriveSharedKey(keys: CryptoKeyPair, peerPublic: string): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey('raw', b64.to(peerPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, keys.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/** Frame: [12 Byte IV][AES-GCM( [1 Byte Typ][Daten] )] */
export async function encryptFrame(key: CryptoKey, kind: number, data: Uint8Array): Promise<ArrayBuffer> {
  const plain = new Uint8Array(1 + data.byteLength)
  plain[0] = kind
  plain.set(data, 1)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  const out = new Uint8Array(12 + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), 12)
  return out.buffer
}

export async function decryptFrame(key: CryptoKey, frame: ArrayBuffer): Promise<{ kind: number; data: Uint8Array }> {
  const u = new Uint8Array(frame)
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)))
  return { kind: plain[0], data: plain.subarray(1) }
}

/**
 * Kurzer Prüfcode aus beiden öffentlichen Schlüsseln. Beide Seiten sehen denselben Code;
 * wer ganz sicher sein will, vergleicht ihn (schützt auch gegen einen manipulierten Relay).
 */
export async function safetyCode(a: string, b: string): Promise<string> {
  const [x, y] = [a, b].sort()
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${x}|${y}`)))
  const n = ((hash[0] << 16) | (hash[1] << 8) | hash[2]) % 1_000_000
  return n.toString().padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2')
}

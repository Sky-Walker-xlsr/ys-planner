// MCP über Streamable HTTP, zustandslos: jede Anfrage ist eine JSON-RPC-Nachricht mit JSON-Antwort.

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export type JsonSchema = {
  type: 'object'
  properties: Record<string, PropSchema>
  required?: string[]
  additionalProperties?: false
}
export type PropSchema = {
  type: 'string' | 'integer' | 'boolean' | 'array' | ('string' | 'null')[]
  description?: string
  enum?: readonly string[]
  format?: 'uuid' | 'date' | 'date-time'
  pattern?: string
  maxLength?: number
  minimum?: number
  maximum?: number
  items?: { type: 'string'; enum?: readonly string[]; format?: 'uuid' }
}

export type Tool<C> = {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  /** Liest nur; sonst ändert das Werkzeug Daten */
  readOnly?: boolean
  /** Löscht oder überschreibt Inhalte */
  destructive?: boolean
  run: (args: Record<string, unknown>, ctx: C) => Promise<unknown>
}

/** Fehler, deren Text Claude sehen soll (z. B. fehlende Rechte) */
export class ToolError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

function checkString(key: string, v: string, p: { enum?: readonly string[]; format?: string; pattern?: string; maxLength?: number }) {
  if (p.enum && !p.enum.includes(v)) throw new ToolError(`${key}: erlaubt sind ${p.enum.join(', ')}`)
  if (p.format === 'uuid' && !UUID.test(v)) throw new ToolError(`${key}: keine gültige ID`)
  if (p.format === 'date' && (!DATE.test(v) || Number.isNaN(Date.parse(v)))) throw new ToolError(`${key}: Datum im Format YYYY-MM-DD nötig`)
  if (p.format === 'date-time' && Number.isNaN(Date.parse(v))) throw new ToolError(`${key}: Zeitpunkt im ISO-8601-Format nötig`)
  if (p.pattern && !new RegExp(p.pattern).test(v)) throw new ToolError(`${key}: ungültiges Format`)
  if (p.maxLength !== undefined && v.length > p.maxLength) throw new ToolError(`${key}: höchstens ${p.maxLength} Zeichen`)
}

/** Prüft die Argumente gegen das Schema und lässt unbekannte Felder weg */
export function validateArgs(schema: JsonSchema, input: unknown): Record<string, unknown> {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) throw new ToolError('Argumente müssen ein Objekt sein')
  const args = (input ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) throw new ToolError(`${key} fehlt`)
  }
  for (const [key, p] of Object.entries(schema.properties)) {
    const v = args[key]
    if (v === undefined) continue
    if (v === null) {
      if (!Array.isArray(p.type)) throw new ToolError(`${key} darf nicht leer sein`)
    } else if (p.type === 'boolean') {
      if (typeof v !== 'boolean') throw new ToolError(`${key}: true oder false nötig`)
    } else if (p.type === 'integer') {
      if (!Number.isInteger(v)) throw new ToolError(`${key}: ganze Zahl nötig`)
      if (p.minimum !== undefined && (v as number) < p.minimum) throw new ToolError(`${key}: mindestens ${p.minimum}`)
      if (p.maximum !== undefined && (v as number) > p.maximum) throw new ToolError(`${key}: höchstens ${p.maximum}`)
    } else if (p.type === 'array') {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ToolError(`${key}: Liste von Texten nötig`)
      for (const x of v as string[]) checkString(key, x, p.items ?? {})
    } else {
      if (typeof v !== 'string') throw new ToolError(`${key}: Text nötig`)
      checkString(key, v, p)
    }
    out[key] = v
  }
  return out
}

type RpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } }

const rpcError = (id: RpcResponse['id'], code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })

export type ServerInfo = { name: string; title: string; version: string; instructions: string }

/** Verarbeitet eine Nachricht. null = Benachrichtigung, es gibt keine Antwort. */
export async function handleMessage<C>(
  message: unknown,
  opts: { tools: Tool<C>[]; ctx: C; info: ServerInfo; onError?: (tool: string, e: unknown) => void },
): Promise<RpcResponse | null> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return rpcError(null, -32600, 'Ungültige Anfrage')
  const { jsonrpc, id, method, params } = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> }
  if (jsonrpc !== '2.0' || typeof method !== 'string') {
    return rpcError(typeof id === 'string' || typeof id === 'number' ? id : null, -32600, 'Ungültige Anfrage')
  }
  if (id === undefined) return null
  if (typeof id !== 'string' && typeof id !== 'number') return rpcError(null, -32600, 'Ungültige ID')
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion
      return ok({
        protocolVersion: typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: opts.info.name, title: opts.info.title, version: opts.info.version },
        instructions: opts.info.instructions,
      })
    }
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({
        tools: opts.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
        })),
      })
    case 'tools/call': {
      const tool = opts.tools.find((t) => t.name === params?.name)
      if (!tool) return rpcError(id, -32602, `Unbekanntes Werkzeug: ${String(params?.name)}`)
      try {
        const result = await tool.run(validateArgs(tool.inputSchema, params?.arguments), opts.ctx)
        return ok({ content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }, null, 2) }] })
      } catch (e) {
        if (!(e instanceof ToolError)) opts.onError?.(tool.name, e)
        const text = e instanceof ToolError ? e.message : 'Interner Fehler'
        return ok({ content: [{ type: 'text', text }], isError: true })
      }
    }
    default:
      return rpcError(id, -32601, `Unbekannte Methode: ${method}`)
  }
}

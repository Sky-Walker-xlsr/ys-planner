import { describe, expect, it } from 'vitest'
import { handleMessage, ToolError, validateArgs, type JsonSchema, type Tool } from './protocol'

const info = { name: 'test', title: 'Test', version: '1', instructions: 'x' }
const schema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['a', 'b'] },
    due: { type: ['string', 'null'], format: 'date' },
    limit: { type: 'integer', minimum: 1, maximum: 5 },
    color: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
    ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
  },
  required: ['status'],
}
const errors: unknown[] = []
const tools: Tool<{ me: string }>[] = [
  { name: 'echo', title: 'Echo', description: '', inputSchema: schema, readOnly: true, run: async (a, c) => ({ a, me: c.me }) },
  { name: 'denied', title: 'D', description: '', inputSchema: { type: 'object', properties: {} }, run: async () => { throw new ToolError('Keine Rechte') } },
  { name: 'broken', title: 'B', description: '', inputSchema: { type: 'object', properties: {} }, destructive: true, run: async () => { throw new Error('geheime Details') } },
]
const send = (message: unknown) => handleMessage(message, { tools, ctx: { me: 'u1' }, info, onError: (_, e) => errors.push(e) })
const call = (name: string, args?: unknown) => send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })

describe('validateArgs', () => {
  const id = '11111111-1111-4111-8111-111111111111'

  it('lässt unbekannte Felder weg', () => {
    expect(validateArgs(schema, { status: 'a', owner_id: 'x' })).toEqual({ status: 'a' })
  })

  it('lehnt fehlende und falsche Werte ab', () => {
    expect(() => validateArgs(schema, {})).toThrow('status fehlt')
    expect(() => validateArgs(schema, { status: 'c' })).toThrow('erlaubt sind')
    expect(() => validateArgs(schema, { status: 'a', id: 'x; drop' })).toThrow('keine gültige ID')
    expect(() => validateArgs(schema, { status: 'a', due: '30.10.2026' })).toThrow('YYYY-MM-DD')
    expect(() => validateArgs(schema, { status: 'a', limit: 6 })).toThrow('höchstens 5')
    expect(() => validateArgs(schema, { status: 'a', limit: 1.5 })).toThrow('ganze Zahl')
    expect(() => validateArgs(schema, { status: 'a', color: 'url(x)' })).toThrow('ungültiges Format')
    expect(() => validateArgs(schema, { status: 'a', ids: [id, 'x'] })).toThrow('keine gültige ID')
    expect(() => validateArgs(schema, 'text')).toThrow('Objekt')
  })

  it('erlaubt null nur, wo das Schema es vorsieht', () => {
    expect(validateArgs(schema, { status: 'a', due: null })).toEqual({ status: 'a', due: null })
    expect(() => validateArgs(schema, { status: null })).toThrow()
  })
})

describe('handleMessage', () => {
  it('handelt die Protokoll-Version aus', async () => {
    const known = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    expect(known?.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} } })
    const unknown = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })
    expect(unknown?.result).toMatchObject({ protocolVersion: '2025-11-25' })
  })

  it('antwortet nicht auf Benachrichtigungen', async () => {
    expect(await send({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
  })

  it('listet Werkzeuge mit Hinweisen', async () => {
    const res = await send({ jsonrpc: '2.0', id: 'a', method: 'tools/list' })
    const list = (res?.result as { tools: { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[] }).tools
    expect(list[0]).toMatchObject({ name: 'echo', annotations: { readOnlyHint: true, destructiveHint: false } })
    expect(list[2].annotations.destructiveHint).toBe(true)
    expect(res?.id).toBe('a')
  })

  it('führt Werkzeuge mit dem Kontext aus', async () => {
    const res = await call('echo', { status: 'a' })
    const text = (res?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toEqual({ a: { status: 'a' }, me: 'u1' })
  })

  it('meldet Werkzeug-Fehler als Ergebnis, ohne interne Details', async () => {
    expect((await call('denied'))?.result).toEqual({ content: [{ type: 'text', text: 'Keine Rechte' }], isError: true })
    expect((await call('broken'))?.result).toEqual({ content: [{ type: 'text', text: 'Interner Fehler' }], isError: true })
    expect(errors).toHaveLength(1)
    expect((await call('echo', {}))?.result).toMatchObject({ isError: true })
  })

  it('meldet Protokoll-Fehler', async () => {
    expect((await call('gibtsnicht'))?.error?.code).toBe(-32602)
    expect((await send({ jsonrpc: '2.0', id: 1, method: 'x' }))?.error?.code).toBe(-32601)
    expect((await send({ id: 1, method: 'ping' }))?.error?.code).toBe(-32600)
    expect((await send([]))?.error?.code).toBe(-32600)
    expect((await send({ jsonrpc: '2.0', id: {}, method: 'ping' }))?.error?.code).toBe(-32600)
  })
})

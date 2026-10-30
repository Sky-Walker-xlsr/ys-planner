import { describe, expect, it } from 'vitest'
import { isAllowedOrigin, isValidCodeChallenge, isValidCodeVerifier, isValidRedirectUri, isValidResource, pkceChallenge, redirectHost } from './oauth-core'

describe('isValidRedirectUri', () => {
  it('erlaubt https und Loopback', () => {
    expect(isValidRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(isValidRedirectUri('http://localhost:33418/callback')).toBe(true)
    expect(isValidRedirectUri('http://127.0.0.1:5000/cb')).toBe(true)
    expect(isValidRedirectUri('http://[::1]:5000/cb')).toBe(true)
  })

  it('lehnt alles andere ab', () => {
    expect(isValidRedirectUri('http://evil.example/cb')).toBe(false)
    expect(isValidRedirectUri('http://localhost.evil.example/cb')).toBe(false)
    expect(isValidRedirectUri('javascript:alert(1)')).toBe(false)
    expect(isValidRedirectUri('data:text/html,x')).toBe(false)
    expect(isValidRedirectUri('https://claude.ai/cb#frag')).toBe(false)
    expect(isValidRedirectUri('https://user:pw@claude.ai/cb')).toBe(false)
    expect(isValidRedirectUri('keine url')).toBe(false)
    expect(isValidRedirectUri(5)).toBe(false)
  })

  it('zeigt den echten Host', () => {
    expect(redirectHost('https://claude.ai.evil.example/cb')).toBe('claude.ai.evil.example')
  })
})

describe('PKCE', () => {
  it('rechnet das Beispiel aus RFC 7636', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('prüft das Format', () => {
    expect(isValidCodeVerifier('a'.repeat(43))).toBe(true)
    expect(isValidCodeVerifier('a'.repeat(42))).toBe(false)
    expect(isValidCodeVerifier(`${'a'.repeat(43)} `)).toBe(false)
    expect(isValidCodeChallenge('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true)
    expect(isValidCodeChallenge('kurz')).toBe(false)
  })
})

describe('isAllowedOrigin', () => {
  const app = 'https://planner.salm.li'
  it('erlaubt Server-Aufrufe, die App und Claude', () => {
    expect(isAllowedOrigin(null, app)).toBe(true)
    expect(isAllowedOrigin(app, app)).toBe(true)
    expect(isAllowedOrigin('https://claude.ai', app)).toBe(true)
  })
  it('lehnt fremde Websites ab', () => {
    expect(isAllowedOrigin('https://evil.example', app)).toBe(false)
    expect(isAllowedOrigin('https://claude.ai.evil.example', app)).toBe(false)
  })
})

describe('isValidResource', () => {
  const server = 'https://planner.salm.li/mcp'
  it('akzeptiert nur diesen Server', () => {
    expect(isValidResource(null, server)).toBe(true)
    expect(isValidResource(server, server)).toBe(true)
    expect(isValidResource(`${server}/`, server)).toBe(true)
    expect(isValidResource('https://evil.example/mcp', server)).toBe(false)
  })
})

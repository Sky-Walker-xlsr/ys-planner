// SPF/DKIM-Ergebnis aus Authentication-Results (RFC 8601).
// Ausgewertet wird nur der oberste Header, und nur wenn er von Cloudflare stammt (authserv-id):
// Cloudflare fügt ihn beim Empfang zuoberst ein, alle tieferen kann der Absender selbst mitschicken.

export type MailHeader = { key: string; value: string }

const TRUSTED_AUTHSERV = /(^|\.)cloudflare\.net$/i

/** authserv-id des obersten Authentication-Results-Headers */
export function topAuthServId(headers: MailHeader[]): string | null {
  const top = headers.find((h) => h.key.toLowerCase() === 'authentication-results')
  return top ? top.value.split(';')[0].trim().split(/\s+/)[0] : null
}

function domainOf(address: string) {
  return address.split('@').pop()!.toLowerCase().replace(/\.$/, '')
}

/** Relaxed Alignment: gleiche Domain oder Subdomain davon */
function aligned(authDomain: string, fromDomain: string) {
  const a = authDomain.toLowerCase().replace(/\.$/, '')
  return fromDomain === a || fromDomain.endsWith(`.${a}`) || a.endsWith(`.${fromDomain}`)
}

/** true, wenn DKIM oder SPF für die Domain der From-Adresse bestanden hat */
export function senderAuthenticated(headers: MailHeader[], fromAddress: string): boolean {
  const top = headers.find((h) => h.key.toLowerCase() === 'authentication-results')
  if (!top || !TRUSTED_AUTHSERV.test(topAuthServId(headers) ?? '')) return false
  const fromDomain = domainOf(fromAddress)
  // Ergebnisse sind durch ";" getrennt: "dkim=pass header.d=example.com header.s=…"
  for (const part of top.value.split(';').slice(1)) {
    const m = part.trim().match(/^(dkim|spf)\s*=\s*(\w+)/i)
    if (!m || m[2].toLowerCase() !== 'pass') continue
    const method = m[1].toLowerCase()
    const prop = method === 'dkim'
      ? part.match(/header\.(?:d|i)\s*=\s*@?([^\s;]+)/i)
      : part.match(/smtp\.(?:mailfrom|helo)\s*=\s*(?:[^\s;@]*@)?([^\s;]+)/i)
    if (prop && aligned(domainOf(prop[1]), fromDomain)) return true
  }
  return false
}

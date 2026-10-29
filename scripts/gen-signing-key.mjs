// Erzeugt einen ES256-Schlüssel (P-256) für Supabase JWT Signing Keys.
// Ausgabe: privater JWK (→ Supabase importieren + SUPABASE_JWT_PRIVATE_KEY) als eine Zeile.
// Alternative: `npx supabase gen signing-key --algorithm ES256`
import { generateKeyPair, exportJWK } from 'jose'

const { privateKey } = await generateKeyPair('ES256', { extractable: true })
const jwk = await exportJWK(privateKey)
jwk.kid = crypto.randomUUID()
jwk.alg = 'ES256'
jwk.use = 'sig'
jwk.key_ops = ['sign', 'verify']
jwk.ext = true

console.log(JSON.stringify(jwk))

// Server-Umgebungsvariablen. Werden zur Laufzeit gelesen (Cloudflare befüllt process.env pro Request).
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`)
  return value
}

export const serverEnv = {
  get appUrl() { return required('APP_URL').replace(/\/$/, '') },
  get supabaseUrl() { return required('NEXT_PUBLIC_SUPABASE_URL') },
  get supabasePublishableKey() { return required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') },
  get supabaseSecretKey() { return required('SUPABASE_SECRET_KEY') },
  get supabaseJwtPrivateKey() { return required('SUPABASE_JWT_PRIVATE_KEY') },
  get zitadelIssuer() { return required('ZITADEL_ISSUER').replace(/\/$/, '') },
  get zitadelClientId() { return required('ZITADEL_CLIENT_ID') },
  get zitadelClientSecret() { return process.env.ZITADEL_CLIENT_SECRET || null },
  get sessionSecret() { return required('SESSION_SECRET') },
  get shareLinkSecret() { return required('SHARE_LINK_SECRET') },
  get cronSecret() { return required('CRON_SECRET') },
  get resendApiKey() { return required('RESEND_API_KEY') },
  get mailFrom() { return required('MAIL_FROM') },
  /** Domain der Mail-an-Planner-Adressen ({zufall}@INBOX_DOMAIN) */
  get inboxDomain() { return required('INBOX_DOMAIN').toLowerCase() },
}

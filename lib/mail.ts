import 'server-only'
import { Resend } from 'resend'
import { serverEnv } from '@/lib/env'

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export type MailContent = {
  subject: string
  heading: string
  /** Absätze (Klartext, wird escaped) */
  paragraphs: string[]
  /** Optionale Liste (Klartext) */
  items?: { title: string; meta?: string; href?: string }[]
  cta?: { label: string; href: string }
  /** Fusszeile; Standard: Hinweis auf aktivierte Benachrichtigungen */
  footer?: string
}

/** Schlichtes HTML-Template im App-Design (Inter, Akzent #1F7A57) */
export function renderMail(c: MailContent): string {
  const items = c.items?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0;border:1px solid #E3E5E8;border-radius:10px">
        ${c.items
          .map(
            (i, idx) => `<tr><td style="padding:10px 14px;${idx ? 'border-top:1px solid #E3E5E8;' : ''}">
              ${i.href ? `<a href="${escapeHtml(i.href)}" style="color:#1B1D21;font-weight:600;text-decoration:none">${escapeHtml(i.title)}</a>` : `<span style="font-weight:600">${escapeHtml(i.title)}</span>`}
              ${i.meta ? `<div style="color:#5F6670;font-size:13px;margin-top:2px">${escapeHtml(i.meta)}</div>` : ''}
            </td></tr>`,
          )
          .join('')}
      </table>`
    : ''
  const cta = c.cta
    ? `<p style="margin:20px 0 0"><a href="${escapeHtml(c.cta.href)}" style="display:inline-block;background:#1F7A57;color:#FFFFFF;text-decoration:none;font-weight:600;padding:9px 16px;border-radius:8px">${escapeHtml(c.cta.label)}</a></p>`
    : ''
  return `<!doctype html><html lang="de"><body style="margin:0;background:#F5F6F8;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1B1D21;font-size:14px;line-height:1.5">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E3E5E8;border-radius:14px">
      <tr><td style="padding:24px 28px">
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:16px"><tr>
          <td style="padding-right:10px;vertical-align:middle"><img src="${escapeHtml(serverEnv.appUrl)}/brand/icon-192.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:6px"></td>
          <td style="vertical-align:middle;font-weight:700;color:#1F7A57">ys-planner</td>
        </tr></table>
        <h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(c.heading)}</h1>
        ${c.paragraphs.map((p) => `<p style="margin:0 0 8px">${escapeHtml(p)}</p>`).join('')}
        ${items}
        ${cta}
      </td></tr>
    </table>
    <p style="color:#5F6670;font-size:12px;margin-top:16px">${escapeHtml(c.footer ?? 'Du erhältst diese Mail, weil Benachrichtigungen in deinen ys-planner-Einstellungen aktiviert sind.')}</p>
  </td></tr></table></body></html>`
}

export async function sendMail(to: string, content: MailContent) {
  const resend = new Resend(serverEnv.resendApiKey)
  const { error } = await resend.emails.send({
    from: serverEnv.mailFrom,
    to,
    subject: content.subject,
    html: renderMail(content),
  })
  if (error) console.error('Mailversand fehlgeschlagen', error)
}

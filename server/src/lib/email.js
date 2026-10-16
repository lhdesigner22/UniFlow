// Fila de e-mail (Fase 5) — grava tudo em `email_outbox` e tenta enviar de
// fato via o primeiro provedor disponível, em ordem de preferência:
//   1. Gmail API (`env.GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN`)
//      — envia como uma caixa do Google Workspace já existente
//      (`env.GMAIL_SENDER_EMAIL`), sem depender de domínio onboardado em
//      nenhum provedor de e-mail transacional. Permite mandar pra QUALQUER
//      destinatário, não só endereços pré-verificados.
//   2. `env.EMAIL` (binding nativo da Cloudflare — exige domínio onboardado)
//   3. `env.RESEND_API_KEY` (Resend via HTTP, sem precisar mover DNS —
//      em modo sandbox, sem domínio verificado no Resend, só entrega pro
//      e-mail que criou a conta Resend)
// Se nenhum estiver configurado, fica tudo 'pending' sem erro — nenhum outro
// código precisa mudar quando um provedor for configurado/trocado.
import { v4 as uuid } from 'uuid'

const APP_URL = 'https://uniflow.serfecaf.workers.dev'

// Envelope visual dos e-mails do sistema — tabelas (compatível com Outlook,
// que ignora flexbox/grid) + cores da marca. O "logo" é montado com CSS puro
// (sem <img>), porque clientes de e-mail corporativos (Outlook desktop, em
// especial) bloqueiam ou não renderizam imagens externas/SVG por padrão.
function wrapEmailHtml(innerHtml) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F7FB;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FB;padding:32px 16px;font-family:Segoe UI,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.1);">
<tr><td style="background:#3B82F6;padding:18px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:30px;height:30px;background:rgba(255,255,255,.2);border-radius:8px;text-align:center;vertical-align:middle;font-size:15px;line-height:30px;color:#fff;">◆</td>
    <td style="padding-left:10px;color:#fff;font-size:16px;font-weight:700;letter-spacing:-.01em;font-family:Segoe UI,Arial,sans-serif;">UniFlow</td>
  </tr></table>
</td></tr>
<tr><td style="padding:28px 28px 6px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#334155;">
  ${innerHtml}
</td></tr>
<tr><td style="padding:8px 28px 26px;">
  <a href="${APP_URL}" style="display:inline-block;background:#3B82F6;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;font-family:Segoe UI,Arial,sans-serif;">Abrir o UniFlow →</a>
</td></tr>
</table>
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;">
<tr><td style="padding:14px 12px 0;font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#94A3B8;text-align:center;">
  E-mail automático do UniFlow — não é preciso responder.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

// `plain: true` = sem o envelope "UniFlow" (cabeçalho azul + botão "Abrir o
// UniFlow"): pra e-mails que saem em nome da equipe e vão pra quem nem usa o
// sistema (ex: aviso de devolução de equipamento a professores).
export async function queueEmail(db, { to_email, to_user_id, subject, html, text, related_type, related_id, plain }) {
  const id = uuid()
  await db.prepare(`
    INSERT INTO email_outbox (id, to_email, to_user_id, subject, body_html, body_text, related_type, related_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, to_email || null, to_user_id || null, subject, plain ? html : wrapEmailHtml(html), text, related_type || null, related_id || null)
  return id
}

async function sendViaCloudflare(env, { to, subject, html, text }) {
  await env.EMAIL.send({
    to,
    from: { email: 'notificacoes@colegioser.com', name: 'UniFlow' },
    subject,
    html,
    text,
  })
}

async function sendViaResend(env, { to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'UniFlow <onboarding@resend.dev>', // sandbox — sem domínio verificado ainda
      to,
      subject,
      html,
      text,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Resend respondeu ${res.status}: ${body.slice(0, 300)}`)
  }
}

// --- Gmail API (envia como uma caixa real do Google Workspace) ---------

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function toBase64Url(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function wrap76(b64) {
  return b64.replace(/(.{76})/g, '$1\r\n')
}

// Encoded-word (RFC 2047) pro assunto, só quando tem acento/caractere não-ASCII
function encodeSubject(subject) {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject
  return `=?UTF-8?B?${utf8ToBase64(subject)}?=`
}

async function getGmailAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gmail OAuth respondeu ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  return data.access_token
}

async function sendViaGmail(env, { to, subject, html, text }, accessToken) {
  const from = env.GMAIL_SENDER_EMAIL || 'helpdesk.ti@fecaf.com.br'
  const boundary = `uniflow_${Math.random().toString(36).slice(2)}`

  const raw = [
    `From: UniFlow <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8ToBase64(text || ' ')),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8ToBase64(html || ' ')),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: toBase64Url(new TextEncoder().encode(raw)) }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gmail API respondeu ${res.status}: ${body.slice(0, 300)}`)
  }
}

function pickProvider(env) {
  if (env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) return 'gmail'
  if (env.EMAIL) return 'cloudflare'
  if (env.RESEND_API_KEY) return 'resend'
  return null
}

export async function flushOutbox(env, db) {
  const provider = pickProvider(env)
  if (!provider) return { provider: null, attempted: 0 }

  const pending = await db.prepare("SELECT * FROM email_outbox WHERE status = 'pending' ORDER BY created_at LIMIT 50").all()
  let sent = 0, failed = 0

  // Um único access token do Gmail serve pra todos os envios deste flush
  // (evita bater no endpoint OAuth uma vez por e-mail).
  let gmailAccessToken = null
  if (provider === 'gmail') {
    try {
      gmailAccessToken = await getGmailAccessToken(env)
    } catch (e) {
      return { provider, attempted: pending.length, sent: 0, failed: pending.length, error: String(e?.message || e) }
    }
  }

  for (const row of pending) {
    try {
      let to = row.to_email
      if (!to && row.to_user_id) {
        const u = await db.prepare('SELECT email FROM users WHERE id = ?').get(row.to_user_id)
        to = u?.email
      }
      if (!to) {
        await db.prepare("UPDATE email_outbox SET status='failed', error=? WHERE id=?").run('Nenhum e-mail resolvido', row.id)
        failed++
        continue
      }

      const payload = { to, subject: row.subject, html: row.body_html, text: row.body_text }
      if (provider === 'gmail') await sendViaGmail(env, payload, gmailAccessToken)
      else if (provider === 'cloudflare') await sendViaCloudflare(env, payload)
      else await sendViaResend(env, payload)

      await db.prepare("UPDATE email_outbox SET status='sent', sent_at=datetime('now') WHERE id=?").run(row.id)
      sent++
    } catch (e) {
      await db.prepare("UPDATE email_outbox SET status='failed', error=? WHERE id=?").run(String(e?.message || e), row.id)
      failed++
    }
  }

  return { provider, attempted: pending.length, sent, failed }
}

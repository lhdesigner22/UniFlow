// Fila de e-mail (Fase 5) — grava tudo em `email_outbox` e tenta enviar de
// fato via o primeiro provedor disponível:
//   1. `env.EMAIL` (binding nativo da Cloudflare — exige domínio onboardado)
//   2. `env.RESEND_API_KEY` (Resend via HTTP, sem precisar mover DNS —
//      em modo sandbox, sem domínio verificado no Resend, só entrega pro
//      e-mail que criou a conta Resend)
// Se nenhum dos dois existir, fica tudo 'pending' sem erro — nenhum outro
// código precisa mudar quando um provedor for configurado.
import { v4 as uuid } from 'uuid'

export async function queueEmail(db, { to_email, to_user_id, subject, html, text, related_type, related_id }) {
  const id = uuid()
  await db.prepare(`
    INSERT INTO email_outbox (id, to_email, to_user_id, subject, body_html, body_text, related_type, related_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, to_email || null, to_user_id || null, subject, html, text, related_type || null, related_id || null)
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

function pickProvider(env) {
  if (env.EMAIL) return 'cloudflare'
  if (env.RESEND_API_KEY) return 'resend'
  return null
}

export async function flushOutbox(env, db) {
  const provider = pickProvider(env)
  if (!provider) return { provider: null, attempted: 0 }

  const pending = await db.prepare("SELECT * FROM email_outbox WHERE status = 'pending' ORDER BY created_at LIMIT 50").all()
  let sent = 0, failed = 0

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
      if (provider === 'cloudflare') await sendViaCloudflare(env, payload)
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

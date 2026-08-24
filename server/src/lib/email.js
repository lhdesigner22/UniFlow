// Fila de e-mail (Fase 5) — grava tudo em `email_outbox` e só tenta enviar de
// fato quando o binding `env.EMAIL` existir (depende de um domínio de envio
// configurado na conta Cloudflare, decisão ainda pendente — ver o plano).
// Nenhum outro código precisa mudar quando o domínio for resolvido: só
// configurar o binding no wrangler.jsonc e o flush passa a funcionar.
import { v4 as uuid } from 'uuid'

export async function queueEmail(db, { to_email, to_user_id, subject, html, text, related_type, related_id }) {
  const id = uuid()
  await db.prepare(`
    INSERT INTO email_outbox (id, to_email, to_user_id, subject, body_html, body_text, related_type, related_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, to_email || null, to_user_id || null, subject, html, text, related_type || null, related_id || null)
  return id
}

export async function flushOutbox(env, db) {
  if (!env.EMAIL) return // binding não configurado ainda — deixa tudo pending, sem erro
  const pending = await db.prepare("SELECT * FROM email_outbox WHERE status = 'pending' ORDER BY created_at LIMIT 50").all()
  for (const row of pending) {
    try {
      let to = row.to_email
      if (!to && row.to_user_id) {
        const u = await db.prepare('SELECT email FROM users WHERE id = ?').get(row.to_user_id)
        to = u?.email
      }
      if (!to) { await db.prepare("UPDATE email_outbox SET status='failed', error=? WHERE id=?").run('Nenhum e-mail resolvido', row.id); continue }
      await env.EMAIL.send({
        to,
        from: { email: 'notificacoes@colegioser.com', name: 'UniFlow' },
        subject: row.subject,
        html: row.body_html,
        text: row.body_text,
      })
      await db.prepare("UPDATE email_outbox SET status='sent', sent_at=datetime('now') WHERE id=?").run(row.id)
    } catch (e) {
      await db.prepare("UPDATE email_outbox SET status='failed', error=? WHERE id=?").run(String(e?.message || e), row.id)
    }
  }
}

import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { flushOutbox, queueEmail } from '../lib/email.js'

const app = new Hono()
app.use('*', auth)

// Middleware: super_admin (leitura + escrita) ou auditor (só leitura — mesmo
// padrão inline de admin.js)
const superAdmin = async (c, next) => {
  const db = c.get('db')
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  if (u?.system_role === 'super_admin') return await next()
  if (u?.system_role === 'auditor' && c.req.method === 'GET') return await next()
  return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)
}
app.use('*', superAdmin)

// GET / — todas as configurações como objeto plano {key: value}
app.get('/', async c => {
  const db = c.get('db')
  const rows = await db.prepare('SELECT key, value FROM app_settings').all()
  const settings = {}
  for (const row of rows) settings[row.key] = row.value
  return c.json(settings)
})

// PUT / — upsert de um objeto plano {key: value, ...}
app.put('/', async c => {
  const db = c.get('db')
  const body = await c.req.json()

  for (const [key, value] of Object.entries(body)) {
    await db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value))
  }

  const rows = await db.prepare('SELECT key, value FROM app_settings').all()
  const settings = {}
  for (const row of rows) settings[row.key] = row.value
  return c.json(settings)
})

// GET /digest-recipients?type=weekly|daily
app.get('/digest-recipients', async c => {
  const db = c.get('db')
  const type = c.req.query('type')

  const recipients = type
    ? await db.prepare(`
        SELECT dr.*, u.name as user_name, u.email as user_email
        FROM digest_recipients dr LEFT JOIN users u ON u.id = dr.user_id
        WHERE dr.digest_type = ?
      `).all(type)
    : await db.prepare(`
        SELECT dr.*, u.name as user_name, u.email as user_email
        FROM digest_recipients dr LEFT JOIN users u ON u.id = dr.user_id
      `).all()

  return c.json(recipients)
})

// POST /digest-recipients — {digest_type, user_id} OU {digest_type, email}
app.post('/digest-recipients', async c => {
  const db = c.get('db')
  const { digest_type, user_id, email } = await c.req.json()

  if (!digest_type || (digest_type !== 'weekly' && digest_type !== 'daily'))
    return c.json({ error: "digest_type deve ser 'weekly' ou 'daily'" }, 400)
  if (!user_id && !email) return c.json({ error: 'Informe user_id ou email' }, 400)
  if (user_id && email) return c.json({ error: 'Informe apenas user_id OU email, não os dois' }, 400)

  const id = uuid()
  await db.prepare('INSERT INTO digest_recipients (id, digest_type, user_id, email) VALUES (?, ?, ?, ?)')
    .run(id, digest_type, user_id || null, email || null)

  return c.json(await db.prepare(`
    SELECT dr.*, u.name as user_name, u.email as user_email
    FROM digest_recipients dr LEFT JOIN users u ON u.id = dr.user_id
    WHERE dr.id = ?
  `).get(id))
})

// DELETE /digest-recipients/:id
app.delete('/digest-recipients/:id', async c => {
  const db = c.get('db')
  await db.prepare('DELETE FROM digest_recipients WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

// GET /email-outbox?status= — fila de e-mail (+ contagem de pendentes)
app.get('/email-outbox', async c => {
  const db = c.get('db')
  const status = c.req.query('status')

  const rows = status
    ? await db.prepare('SELECT * FROM email_outbox WHERE status = ? ORDER BY created_at DESC LIMIT 100').all(status)
    : await db.prepare('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 100').all()

  const pendingCount = await db.scalar("SELECT COUNT(*) FROM email_outbox WHERE status = 'pending'") ?? 0

  return c.json({ rows, pendingCount })
})

// POST /email-outbox/flush — tenta enviar a fila agora (não espera o cron de
// 15min). Útil pra testar um provedor recém-configurado.
app.post('/email-outbox/flush', async c => {
  const db = c.get('db')
  const result = await flushOutbox(c.env, db)
  return c.json(result)
})

// POST /email-outbox/test — enfileira um e-mail de teste pro endereço informado
// e já tenta despachar na hora (via flushOutbox). Não usa nenhuma regra/digest.
app.post('/email-outbox/test', async c => {
  const db = c.get('db')
  const { to } = await c.req.json()
  if (!to) return c.json({ error: 'Informe "to"' }, 400)

  await queueEmail(db, {
    to_email: to,
    subject: 'UniFlow — e-mail de teste',
    html: '<p>Se você está lendo isso, o envio de e-mail do UniFlow está funcionando. 🎉</p>',
    text: 'Se você está lendo isso, o envio de e-mail do UniFlow está funcionando.',
    related_type: 'test',
    related_id: null,
  })
  const result = await flushOutbox(c.env, db)
  return c.json(result)
})

export default app

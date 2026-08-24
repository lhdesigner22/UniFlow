import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'

const app = new Hono()
app.use('*', auth)

app.get('/', async c => {
  const db = c.get('db')
  const userId = c.get('user').id
  const notifs = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId)
  const unread = await db.scalar('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0', userId) ?? 0
  return c.json({ notifications: notifs, unread })
})

app.post('/read/:id', async c => {
  const db = c.get('db')
  const userId = c.get('user').id
  await db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(c.req.param('id'), userId)
  return c.json({ ok: true })
})

app.post('/read-all', async c => {
  const db = c.get('db')
  const userId = c.get('user').id
  await db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId)
  return c.json({ ok: true })
})

app.delete('/:id', async c => {
  const db = c.get('db')
  const userId = c.get('user').id
  await db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(c.req.param('id'), userId)
  return c.json({ ok: true })
})

// Usado por outras rotas/automations para criar notificações — recebe `db` explicitamente
// porque em Workers não existe singleton de módulo com acesso ao binding (antes: import direto de db.js).
export async function createNotification(db, userId, type, title, content, link) {
  await db.prepare('INSERT INTO notifications (id, user_id, type, title, content, link) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), userId, type, title, content, link)
}

export default app

import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router()
router.use(auth)

router.get('/', async (req, res) => {
  const notifs = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id)
  const unread = await db.scalar('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0', req.user.id) ?? 0
  res.json({ notifications: notifs, unread })
})

router.post('/read/:id', async (req, res) => {
  await db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  res.json({ ok: true })
})

router.post('/read-all', async (req, res) => {
  await db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id)
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  res.json({ ok: true })
})

export async function createNotification(userId, type, title, content, link) {
  await db.prepare('INSERT INTO notifications (id, user_id, type, title, content, link) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), userId, type, title, content, link)
}

export default router

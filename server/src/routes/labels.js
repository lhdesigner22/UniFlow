import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
router.use(auth)

router.get('/', async (req, res) => {
  res.json(await db.prepare('SELECT * FROM pipe_labels WHERE pipe_id = ?').all(req.params.pipeId))
})

router.post('/', async (req, res) => {
  const { name, color = '#4a7cf7' } = req.body
  const id = uuid()
  await db.prepare('INSERT INTO pipe_labels (id, pipe_id, name, color) VALUES (?, ?, ?, ?)').run(id, req.params.pipeId, name, color)
  res.json(await db.prepare('SELECT * FROM pipe_labels WHERE id = ?').get(id))
})

router.put('/:id', async (req, res) => {
  const { name, color } = req.body
  await db.prepare('UPDATE pipe_labels SET name = ?, color = ? WHERE id = ?').run(name, color, req.params.id)
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM pipe_labels WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router

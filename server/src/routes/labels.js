import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
router.use(auth)

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM pipe_labels WHERE pipe_id = ?').all(req.params.pipeId))
})

router.post('/', (req, res) => {
  const { name, color = '#4a7cf7' } = req.body
  const id = uuid()
  db.prepare('INSERT INTO pipe_labels (id, pipe_id, name, color) VALUES (?, ?, ?, ?)').run(id, req.params.pipeId, name, color)
  res.json(db.prepare('SELECT * FROM pipe_labels WHERE id = ?').get(id))
})

router.put('/:id', (req, res) => {
  const { name, color } = req.body
  db.prepare('UPDATE pipe_labels SET name = ?, color = ? WHERE id = ?').run(name, color, req.params.id)
  res.json({ ok: true })
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM pipe_labels WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router

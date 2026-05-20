import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
router.use(auth)

router.get('/', async (req, res) => {
  res.json(await db.prepare('SELECT * FROM pipe_fields WHERE pipe_id = ? ORDER BY order_index').all(req.params.pipeId))
})

router.post('/', async (req, res) => {
  const { name, type, required = 0, options } = req.body
  const max = await db.scalar('SELECT MAX(order_index) FROM pipe_fields WHERE pipe_id = ?', req.params.pipeId) ?? -1
  const id = uuid()
  await db.prepare('INSERT INTO pipe_fields (id, pipe_id, name, type, required, options, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.pipeId, name, type, required, options ? JSON.stringify(options) : null, max + 1)
  res.json(await db.prepare('SELECT * FROM pipe_fields WHERE id = ?').get(id))
})

router.put('/:id', async (req, res) => {
  const { name, required, options } = req.body
  const f = await db.prepare('SELECT * FROM pipe_fields WHERE id = ?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'Campo não encontrado' })
  await db.prepare('UPDATE pipe_fields SET name = ?, required = ?, options = ? WHERE id = ?')
    .run(name ?? f.name, required ?? f.required, options ? JSON.stringify(options) : f.options, f.id)
  res.json(await db.prepare('SELECT * FROM pipe_fields WHERE id = ?').get(f.id))
})

router.put('/reorder', async (req, res) => {
  const { order } = req.body
  await db.batch(order.map(o => ({
    sql: 'UPDATE pipe_fields SET order_index = ? WHERE id = ?',
    args: [o.order_index, o.id]
  })))
  res.json({ ok: true })
})

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM pipe_fields WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router

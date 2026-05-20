import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
router.use(auth)

router.post('/', async (req, res) => {
  const { name, color = '#4a7cf7', done = 0 } = req.body
  const maxOrder = await db.scalar('SELECT MAX(order_index) FROM phases WHERE pipe_id = ?', req.params.pipeId) ?? -1
  const id = uuid()
  await db.prepare('INSERT INTO phases (id, pipe_id, name, color, order_index, done) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, req.params.pipeId, name, color, maxOrder + 1, done)
  res.json(await db.prepare('SELECT * FROM phases WHERE id = ?').get(id))
})

router.put('/reorder', async (req, res) => {
  const { order } = req.body // array of { id, order_index }
  await db.batch(order.map(o => ({
    sql: 'UPDATE phases SET order_index = ? WHERE id = ?',
    args: [o.order_index, o.id]
  })))
  res.json({ ok: true })
})

router.put('/:id', async (req, res) => {
  const { name, color, done } = req.body
  const phase = await db.prepare('SELECT * FROM phases WHERE id = ? AND pipe_id = ?').get(req.params.id, req.params.pipeId)
  if (!phase) return res.status(404).json({ error: 'Fase não encontrada' })
  await db.prepare('UPDATE phases SET name = ?, color = ?, done = ? WHERE id = ?')
    .run(name ?? phase.name, color ?? phase.color, done ?? phase.done, phase.id)
  res.json(await db.prepare('SELECT * FROM phases WHERE id = ?').get(phase.id))
})

router.delete('/:id', async (req, res) => {
  const phase = await db.prepare('SELECT * FROM phases WHERE id = ? AND pipe_id = ?').get(req.params.id, req.params.pipeId)
  if (!phase) return res.status(404).json({ error: 'Fase não encontrada' })
  const hasCards = await db.scalar('SELECT COUNT(*) FROM cards WHERE phase_id = ? AND archived = 0', phase.id) ?? 0
  if (hasCards > 0) return res.status(400).json({ error: 'Mova ou arquive os cards antes de excluir' })
  await db.prepare('DELETE FROM phases WHERE id = ?').run(phase.id)
  res.json({ ok: true })
})

export default router

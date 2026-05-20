import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })

// Public form access (no auth)
router.get('/public/:token', async (req, res) => {
  const form = await db.prepare('SELECT * FROM forms WHERE public_token = ? AND active = 1').get(req.params.token)
  if (!form) return res.status(404).json({ error: 'Formulário não encontrado' })
  const pipe = await db.prepare('SELECT id, name, description, icon, color FROM pipes WHERE id = ?').get(form.pipe_id)
  const phases = await db.prepare('SELECT * FROM phases WHERE pipe_id = ? ORDER BY order_index').all(form.pipe_id)
  const fields = await db.prepare('SELECT * FROM pipe_fields WHERE pipe_id = ? ORDER BY order_index').all(form.pipe_id)
  res.json({ form, pipe, phases, fields })
})

router.post('/public/:token/submit', async (req, res) => {
  const form = await db.prepare('SELECT * FROM forms WHERE public_token = ? AND active = 1').get(req.params.token)
  if (!form) return res.status(404).json({ error: 'Formulário não encontrado' })
  const { title, fields: fieldValues = [] } = req.body
  const firstPhase = await db.prepare('SELECT id FROM phases WHERE pipe_id = ? ORDER BY order_index LIMIT 1').get(form.pipe_id)
  if (!firstPhase) return res.status(400).json({ error: 'Pipe sem fases' })
  const pipe = await db.prepare('SELECT owner_id FROM pipes WHERE id = ?').get(form.pipe_id)
  const cardId = uuid()
  const max = await db.scalar('SELECT MAX(order_index) FROM cards WHERE phase_id = ?', firstPhase.id) ?? -1
  await db.prepare('INSERT INTO cards (id, pipe_id, phase_id, title, order_index, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(cardId, form.pipe_id, firstPhase.id, title || 'Solicitação via formulário', max + 1, pipe.owner_id)
  for (const f of fieldValues) {
    await db.prepare('INSERT INTO card_fields (id, card_id, field_id, value) VALUES (?, ?, ?, ?) ON CONFLICT(card_id, field_id) DO UPDATE SET value = excluded.value')
      .run(uuid(), cardId, f.field_id, f.value)
  }
  await db.prepare('INSERT INTO card_activities (id, card_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), cardId, pipe.owner_id, 'created', 'Criado via formulário público')
  res.json({ ok: true, card_id: cardId })
})

// Protected form management
router.use(auth)

router.get('/', async (req, res) => {
  res.json(await db.prepare('SELECT * FROM forms WHERE pipe_id = ?').all(req.params.pipeId))
})

router.post('/', async (req, res) => {
  const { name, description } = req.body
  const id = uuid()
  const token = uuid()
  await db.prepare('INSERT INTO forms (id, pipe_id, name, description, public_token) VALUES (?, ?, ?, ?, ?)').run(id, req.params.pipeId, name, description, token)
  res.json(await db.prepare('SELECT * FROM forms WHERE id = ?').get(id))
})

router.put('/:id', async (req, res) => {
  const { name, description, active } = req.body
  const f = await db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'Formulário não encontrado' })
  await db.prepare('UPDATE forms SET name=?, description=?, active=? WHERE id=?').run(name ?? f.name, description ?? f.description, active ?? f.active, f.id)
  res.json(await db.prepare('SELECT * FROM forms WHERE id = ?').get(f.id))
})

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM forms WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router

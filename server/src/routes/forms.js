import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })

// Public form access (no auth)
router.get('/public/:token', (req, res) => {
  const form = db.prepare('SELECT * FROM forms WHERE public_token = ? AND active = 1').get(req.params.token)
  if (!form) return res.status(404).json({ error: 'Formulário não encontrado' })
  const pipe = db.prepare('SELECT id, name, description, icon, color FROM pipes WHERE id = ?').get(form.pipe_id)
  const phases = db.prepare('SELECT * FROM phases WHERE pipe_id = ? ORDER BY order_index').all(form.pipe_id)
  const fields = db.prepare('SELECT * FROM pipe_fields WHERE pipe_id = ? ORDER BY order_index').all(form.pipe_id)
  res.json({ form, pipe, phases, fields })
})

router.post('/public/:token/submit', (req, res) => {
  const form = db.prepare('SELECT * FROM forms WHERE public_token = ? AND active = 1').get(req.params.token)
  if (!form) return res.status(404).json({ error: 'Formulário não encontrado' })
  const { title, fields: fieldValues = [] } = req.body
  const firstPhase = db.prepare('SELECT id FROM phases WHERE pipe_id = ? ORDER BY order_index LIMIT 1').get(form.pipe_id)
  if (!firstPhase) return res.status(400).json({ error: 'Pipe sem fases' })
  const pipe = db.prepare('SELECT owner_id FROM pipes WHERE id = ?').get(form.pipe_id)
  const cardId = uuid()
  const max = db.scalar('SELECT MAX(order_index) FROM cards WHERE phase_id = ?', firstPhase.id) ?? -1
  db.prepare('INSERT INTO cards (id, pipe_id, phase_id, title, order_index, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(cardId, form.pipe_id, firstPhase.id, title || 'Solicitação via formulário', max + 1, pipe.owner_id)
  const upsert = db.prepare('INSERT INTO card_fields (id, card_id, field_id, value) VALUES (?, ?, ?, ?) ON CONFLICT(card_id, field_id) DO UPDATE SET value = excluded.value')
  fieldValues.forEach(f => upsert.run(uuid(), cardId, f.field_id, f.value))
  db.prepare('INSERT INTO card_activities (id, card_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .run(uuid(), cardId, pipe.owner_id, 'created', 'Criado via formulário público')
  res.json({ ok: true, card_id: cardId })
})

// Protected form management
router.use(auth)

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM forms WHERE pipe_id = ?').all(req.params.pipeId))
})

router.post('/', (req, res) => {
  const { name, description } = req.body
  const id = uuid()
  const token = uuid()
  db.prepare('INSERT INTO forms (id, pipe_id, name, description, public_token) VALUES (?, ?, ?, ?, ?)').run(id, req.params.pipeId, name, description, token)
  res.json(db.prepare('SELECT * FROM forms WHERE id = ?').get(id))
})

router.put('/:id', (req, res) => {
  const { name, description, active } = req.body
  const f = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'Formulário não encontrado' })
  db.prepare('UPDATE forms SET name=?, description=?, active=? WHERE id=?').run(name ?? f.name, description ?? f.description, active ?? f.active, f.id)
  res.json(db.prepare('SELECT * FROM forms WHERE id = ?').get(f.id))
})

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM forms WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router

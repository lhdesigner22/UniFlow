import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
router.use(auth)

router.get('/', async (req, res) => {
  res.json(await db.prepare('SELECT * FROM automations WHERE pipe_id = ? ORDER BY created_at DESC').all(req.params.pipeId))
})

router.post('/', async (req, res) => {
  const { name, trigger_type, trigger_config, action_type, action_config } = req.body
  const id = uuid()
  await db.prepare('INSERT INTO automations (id, pipe_id, name, trigger_type, trigger_config, action_type, action_config) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.pipeId, name, trigger_type, JSON.stringify(trigger_config || {}), action_type, JSON.stringify(action_config || {}))
  res.json(await db.prepare('SELECT * FROM automations WHERE id = ?').get(id))
})

router.put('/:id', async (req, res) => {
  const { name, trigger_type, trigger_config, action_type, action_config, active } = req.body
  const a = await db.prepare('SELECT * FROM automations WHERE id = ?').get(req.params.id)
  if (!a) return res.status(404).json({ error: 'Automação não encontrada' })
  await db.prepare('UPDATE automations SET name=?, trigger_type=?, trigger_config=?, action_type=?, action_config=?, active=? WHERE id=?')
    .run(name ?? a.name, trigger_type ?? a.trigger_type,
         trigger_config ? JSON.stringify(trigger_config) : a.trigger_config,
         action_type ?? a.action_type,
         action_config ? JSON.stringify(action_config) : a.action_config,
         active !== undefined ? active : a.active, a.id)
  res.json(await db.prepare('SELECT * FROM automations WHERE id = ?').get(a.id))
})

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM automations WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router

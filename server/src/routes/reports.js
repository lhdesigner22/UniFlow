import { Router } from 'express'
import db from '../db.js'
import { auth } from '../middleware/auth.js'

const router = Router({ mergeParams: true })
router.use(auth)

router.get('/', (req, res) => {
  const pipeId = req.params.pipeId

  const phases = db.prepare('SELECT * FROM phases WHERE pipe_id = ? ORDER BY order_index').all(pipeId)
  const phaseStats = phases.map(p => ({
    name: p.name,
    color: p.color,
    total: db.scalar('SELECT COUNT(*) FROM cards WHERE phase_id = ? AND archived = 0', p.id) ?? 0,
    overdue: db.scalar("SELECT COUNT(*) FROM cards WHERE phase_id = ? AND archived = 0 AND due_date < date('now') AND due_date IS NOT NULL", p.id) ?? 0,
  }))

  const priorityStats = ['low', 'medium', 'high'].map(priority => ({
    priority,
    count: db.scalar('SELECT COUNT(*) FROM cards WHERE pipe_id = ? AND priority = ? AND archived = 0', pipeId, priority) ?? 0,
  }))

  const last7 = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM cards WHERE pipe_id = ? AND created_at >= date('now', '-7 days')
    GROUP BY day ORDER BY day
  `).all(pipeId)

  const totalCards = db.scalar('SELECT COUNT(*) FROM cards WHERE pipe_id = ? AND archived = 0', pipeId) ?? 0
  const archivedCards = db.scalar('SELECT COUNT(*) FROM cards WHERE pipe_id = ? AND archived = 1', pipeId) ?? 0
  const overdueCards = db.scalar("SELECT COUNT(*) FROM cards WHERE pipe_id = ? AND archived = 0 AND due_date < date('now') AND due_date IS NOT NULL", pipeId) ?? 0
  const donePhaseIds = phases.filter(p => p.done).map(p => `'${p.id}'`).join(',')
  const completedCards = donePhaseIds ? db.scalar(`SELECT COUNT(*) FROM cards WHERE phase_id IN (${donePhaseIds}) AND archived = 0`) ?? 0 : 0

  const memberActivity = db.prepare(`
    SELECT u.name, COUNT(*) as actions
    FROM card_activities ca
    JOIN users u ON u.id = ca.user_id
    JOIN cards c ON c.id = ca.card_id
    WHERE c.pipe_id = ?
    GROUP BY u.id ORDER BY actions DESC LIMIT 5
  `).all(pipeId)

  res.json({ phaseStats, priorityStats, last7, totalCards, archivedCards, overdueCards, completedCards, memberActivity })
})

export default router

import { Hono } from 'hono'
import { createDb } from './db.js'

import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import usersRoutes from './routes/users.js'
import notificationsRoutes from './routes/notifications.js'
import demandsRoutes from './routes/demands.js'
import departmentsRoutes from './routes/departments.js'
import { createNotification } from './routes/notifications.js'

const app = new Hono()

// Cria a instância de `db` (D1) uma vez por requisição, a partir do binding do Worker,
// e disponibiliza para todas as rotas via c.get('db') — mesmo shape que as rotas já usam.
app.use('*', async (c, next) => {
  c.set('db', createDb(c.env))
  await next()
})

// Routes
app.route('/api/auth', authRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/users', usersRoutes)
app.route('/api/notifications', notificationsRoutes)
app.route('/api/demands', demandsRoutes)
app.route('/api/departments', departmentsRoutes)

export default {
  fetch: app.fetch,
  // Cron Trigger (a cada hora) — varre demands com due_date (chamado) ou
  // event_date (evento) dentro de 24h ainda não avisadas.
  async scheduled(event, env, ctx) {
    const db = createDb(env)
    const rows = await db.prepare(`
      SELECT * FROM demands
      WHERE (
        (due_date IS NOT NULL AND due_date <= datetime('now', '+24 hours') AND due_date >= datetime('now'))
        OR
        (event_date IS NOT NULL AND event_date <= datetime('now', '+24 hours') AND event_date >= datetime('now'))
      )
      AND due_alerted = 0
      AND status NOT IN ('concluido', 'cancelado')
    `).all()

    for (const row of rows) {
      try {
        if (row.type === 'chamado') {
          const targetId = row.assigned_to || row.created_by
          if (targetId) {
            await createNotification(db, targetId, 'prazo', 'Chamado com prazo próximo', row.title, null)
          }
        } else if (row.type === 'evento') {
          const notified = new Set()
          if (row.department_id) {
            const deptUsers = await db.prepare('SELECT id FROM users WHERE department_id = ?').all(row.department_id)
            for (const u of deptUsers) notified.add(u.id)
          }
          if (row.created_by) notified.add(row.created_by)
          for (const userId of notified) {
            await createNotification(db, userId, 'evento', 'Evento se aproximando', row.title, null)
          }
        }
        await db.prepare('UPDATE demands SET due_alerted = 1 WHERE id = ?').run(row.id)
      } catch (e) {
        console.error('scheduled demands reminder error:', e.message)
      }
    }
  }
}

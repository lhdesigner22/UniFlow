import { Hono } from 'hono'
import { createDb } from './db.js'

import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import usersRoutes from './routes/users.js'
import notificationsRoutes from './routes/notifications.js'
import boardsRoutes from './routes/boards.js'
import columnsRoutes from './routes/columns.js'
import cardsRoutes from './routes/cards.js'
import timeEntriesRoutes from './routes/timeEntries.js'

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
app.route('/api/boards', boardsRoutes)
app.route('/api/boards/:boardId/columns', columnsRoutes)
app.route('/api/boards/:boardId/cards', cardsRoutes)
app.route('/api', timeEntriesRoutes)

export default {
  fetch: app.fetch,
}

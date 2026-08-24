import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'

const app = new Hono()
app.use('*', auth)

// Leitura livre pra qualquer usuário logado escolher um setor ao abrir um
// chamado — a CRUD completa (super_admin) continua em admin.js sob /api/admin/departments.
app.get('/', async c => {
  const db = c.get('db')
  return c.json(await db.prepare('SELECT id, name, color FROM departments ORDER BY name').all())
})

export default app

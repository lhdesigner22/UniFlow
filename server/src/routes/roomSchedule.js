import { Hono } from 'hono'
import { auth } from '../middleware/auth.js'
import { runRoomScheduleSync } from '../lib/roomScheduleSync.js'

// Espelho (somente leitura pro app) da grade de salas do
// unifecaf-horario.netlify.app — quem escreve é um job programado que roda
// fora do Worker (não em tempo real, ver comentário na migration). Aqui só
// serve o que já está sincronizado; não tenta se conectar no site de origem.
const app = new Hono()
app.use('*', auth)

// GET /rooms?building=sede|centro|g5 — nomes de sala já sincronizados
// nesse prédio (pra popular a busca no formulário de empréstimo)
app.get('/rooms', async c => {
  const db = c.get('db')
  const building = c.req.query('building')
  if (!building) return c.json([])

  const rows = await db.prepare(`
    SELECT DISTINCT room_name FROM room_schedule_snapshot WHERE building = ? ORDER BY room_name
  `).all(building)
  return c.json((rows.results || rows).map(r => r.room_name))
})

// GET /?building=g5&room=...&date=YYYY-MM-DD (date default = hoje)
app.get('/', async c => {
  const db = c.get('db')
  const building = c.req.query('building')
  const room = c.req.query('room')
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  if (!building || !room) return c.json({ error: 'Informe building e room' }, 400)

  const rows = await db.prepare(`
    SELECT occupation_type, class_code, professor_name, day_date, synced_at
    FROM room_schedule_snapshot
    WHERE building = ? AND room_name = ? AND day_date = ?
    ORDER BY professor_name
  `).all(building, room, date)

  return c.json(rows)
})

// POST /sync — atualiza a grade agora (só Super Admin). É o mesmo job que
// roda sozinho todo domingo.
app.post('/sync', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(user.id)
  if (u?.system_role !== 'super_admin') return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  try {
    const result = await runRoomScheduleSync(c.env)
    return c.json({ ok: true, ...result })
  } catch (e) {
    console.error('Room schedule sync error', e.message)
    return c.json({ error: e.message }, 502)
  }
})

export default app

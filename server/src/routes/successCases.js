import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { MODULES } from '../lib/permissions.js'

// Gestão → Cases de Sucesso: as entregas da TI no ano, para apresentar à
// diretoria (antes → o que fizemos → resultado). Módulo "gestao" (o portão do
// worker.js barra quem não vê / só vê); quem edita a Gestão cria, edita e
// exclui qualquer case — é a vitrine da equipe, não de uma pessoa. Conteúdo
// institucional: sem separação por departamento.
const app = new Hono()
app.use('*', auth)

export const PILLARS = ['conectividade', 'seguranca', 'gestao', 'operacao']
export const STATUSES = ['concluido', 'piloto', 'andamento']
// Números ao vivo que um case pode mostrar (calculados em GET /stats)
export const LIVE_METRICS = ['glpi_tickets', 'loans_year', 'incidents_resolved', 'uniflow_modules']
// Save financeiro: o valor é uma vez só, por mês, por ano ou em 36 meses (contrato);
// o painel soma o valor de cada case (só o mensal vira ano: × 12)
export const SAVING_PERIODS = ['unico', 'mensal', 'anual', 'meses36']
const MAX_PHOTOS = 6
const PHOTO_RE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/
const MAX_PHOTO_CHARS = 1_600_000
const MAX_THUMB_CHARS = 150_000

const COLUMNS = `
  c.id, c.year, c.title, c.pillar, c.headline, c.before_text, c.solution_text, c.result_value, c.result_label,
  c.technical, c.status, c.completed_on, c.owner, c.live_metric, c.order_index, c.created_at, c.updated_at,
  c.saving_value, c.saving_period, c.saving_note,
  (SELECT p.thumb FROM success_case_photos p WHERE p.case_id = c.id ORDER BY p.created_at LIMIT 1) as cover,
  (SELECT COUNT(*) FROM success_case_photos p WHERE p.case_id = c.id) as photo_count
`

const str = (v, max) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

function clean(body, current = {}) {
  const pick = (k, max) => body[k] !== undefined ? str(body[k], max) : (current[k] ?? null)
  const title = pick('title', 100)
  if (!title) return { error: 'Título é obrigatório' }
  const pillar = body.pillar !== undefined ? body.pillar : (current.pillar || 'gestao')
  if (!PILLARS.includes(pillar)) return { error: 'Pilar inválido' }
  const status = body.status !== undefined ? body.status : (current.status || 'concluido')
  if (!STATUSES.includes(status)) return { error: 'Situação inválida' }
  const completed_on = pick('completed_on', 7)
  if (completed_on && !/^\d{4}-(0[1-9]|1[0-2])$/.test(completed_on)) return { error: 'Mês de conclusão inválido' }
  const live_metric = body.live_metric !== undefined ? (body.live_metric || null) : (current.live_metric ?? null)
  if (live_metric && !LIVE_METRICS.includes(live_metric)) return { error: 'Número ao vivo inválido' }
  let saving_value = current.saving_value ?? null
  if (body.saving_value !== undefined) {
    const raw = body.saving_value
    // A tela já manda número (R$ 1.234,56 → 1234.56)
    saving_value = raw === null || raw === '' ? null : Number(raw)
    if (saving_value !== null && (!Number.isFinite(saving_value) || saving_value < 0 || saving_value > 1e9)) return { error: 'Valor do save inválido' }
    if (saving_value !== null) saving_value = Math.round(saving_value * 100) / 100
  }
  const saving_period = body.saving_period !== undefined ? (body.saving_period || null) : (current.saving_period ?? null)
  if (saving_period && !SAVING_PERIODS.includes(saving_period)) return { error: 'Período do save inválido' }
  const year = body.year !== undefined ? Number(body.year) : (current.year || new Date().getFullYear())
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: 'Ano inválido' }
  return {
    year, title, pillar, status, completed_on, live_metric,
    headline: pick('headline', 160),
    before_text: pick('before_text', 1000),
    solution_text: pick('solution_text', 1000),
    result_value: pick('result_value', 20),
    result_label: pick('result_label', 160),
    technical: pick('technical', 2000),
    owner: pick('owner', 120),
    saving_value,
    saving_period: saving_value === null ? null : (saving_period || 'anual'),
    saving_note: pick('saving_note', 500),
  }
}

const getCase = (db, id) => db.prepare(`SELECT ${COLUMNS} FROM success_cases c WHERE c.id = ?`).get(id)

// GET / — cases do ano (?year=2026; padrão: o ano mais recente cadastrado) +
// a lista de anos que existem, pro seletor.
app.get('/', async c => {
  const db = c.get('db')
  const years = (await db.prepare('SELECT DISTINCT year FROM success_cases ORDER BY year DESC').all()).map(r => r.year)
  const year = Number(c.req.query('year')) || years[0] || new Date().getFullYear()
  const cases = await db.prepare(`SELECT ${COLUMNS} FROM success_cases c WHERE c.year = ? ORDER BY c.order_index, c.title`).all(year)
  return c.json({ year, years, cases })
})

// GET /stats?year= — números ao vivo do próprio UniFlow (uma consulta só)
app.get('/stats', async c => {
  const year = Number(c.req.query('year')) || new Date().getFullYear()
  const row = await c.get('db').prepare(`SELECT
    (SELECT json_extract(data, '$.totalTickets') FROM glpi_total_snapshot WHERE id = 'current') as glpi_tickets,
    (SELECT json_extract(data, '$.resolutionRate') FROM glpi_total_snapshot WHERE id = 'current') as glpi_resolution_rate,
    (SELECT COUNT(*) FROM equipment_loans WHERE loan_date >= ? AND loan_date < ?) as loans_year,
    (SELECT COUNT(*) FROM lab_incidents WHERE status = 'resolvido') as incidents_resolved
  `).get(`${year}-01-01`, `${year + 1}-01-01`)
  return c.json({ ...row, uniflow_modules: MODULES.length })
})

// GET /:id — case com as miniaturas das fotos
app.get('/:id', async c => {
  const db = c.get('db')
  const row = await getCase(db, c.req.param('id'))
  if (!row) return c.json({ error: 'Case não encontrado' }, 404)
  row.photos = await db.prepare('SELECT id, thumb, caption FROM success_case_photos WHERE case_id = ? ORDER BY created_at').all(row.id)
  return c.json(row)
})

// GET /:id/photos/:photoId — foto em tamanho grande
app.get('/:id/photos/:photoId', async c => {
  const photo = await c.get('db').prepare('SELECT id, data, caption FROM success_case_photos WHERE id = ? AND case_id = ?')
    .get(c.req.param('photoId'), c.req.param('id'))
  if (!photo) return c.json({ error: 'Foto não encontrada' }, 404)
  return c.json(photo)
})

app.post('/', async c => {
  const db = c.get('db')
  const v = clean(await c.req.json())
  if (v.error) return c.json(v, 400)
  const id = uuid()
  const last = await db.scalar('SELECT MAX(order_index) FROM success_cases WHERE year = ?', v.year)
  await db.prepare(`
    INSERT INTO success_cases (id, year, title, pillar, headline, before_text, solution_text, result_value, result_label,
      technical, status, completed_on, owner, live_metric, order_index, created_by, saving_value, saving_period, saving_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, v.year, v.title, v.pillar, v.headline, v.before_text, v.solution_text, v.result_value, v.result_label,
    v.technical, v.status, v.completed_on, v.owner, v.live_metric, (last ?? -1) + 1, c.get('user').id, v.saving_value, v.saving_period, v.saving_note)
  return c.json(await getCase(db, id))
})

// PUT /order { ids: [...] } — nova ordem (setas na tela)
app.put('/order', async c => {
  const { ids } = await c.req.json()
  if (!Array.isArray(ids) || ids.length > 200) return c.json({ error: 'Lista inválida' }, 400)
  const db = c.get('db')
  await db.batch(ids.map((id, i) => ({ sql: 'UPDATE success_cases SET order_index = ? WHERE id = ?', args: [i, String(id)] })))
  return c.json({ ok: true })
})

app.put('/:id', async c => {
  const db = c.get('db')
  const row = await db.prepare('SELECT * FROM success_cases WHERE id = ?').get(c.req.param('id'))
  if (!row) return c.json({ error: 'Case não encontrado' }, 404)
  const v = clean(await c.req.json(), row)
  if (v.error) return c.json(v, 400)
  await db.prepare(`
    UPDATE success_cases SET year = ?, title = ?, pillar = ?, headline = ?, before_text = ?, solution_text = ?,
      result_value = ?, result_label = ?, technical = ?, status = ?, completed_on = ?, owner = ?, live_metric = ?,
      saving_value = ?, saving_period = ?, saving_note = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(v.year, v.title, v.pillar, v.headline, v.before_text, v.solution_text, v.result_value, v.result_label,
    v.technical, v.status, v.completed_on, v.owner, v.live_metric, v.saving_value, v.saving_period, v.saving_note, row.id)
  return c.json(await getCase(db, row.id))
})

app.delete('/:id', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  await db.batch([
    { sql: 'DELETE FROM success_case_photos WHERE case_id = ?', args: [id] },
    { sql: 'DELETE FROM success_cases WHERE id = ?', args: [id] },
  ])
  return c.json({ ok: true })
})

// POST /:id/photos { data, thumb, caption } — uma foto por vez (já reduzida no navegador)
app.post('/:id/photos', async c => {
  const db = c.get('db')
  const row = await db.prepare('SELECT id FROM success_cases WHERE id = ?').get(c.req.param('id'))
  if (!row) return c.json({ error: 'Case não encontrado' }, 404)
  if (Number(c.req.header('Content-Length') || 0) > MAX_PHOTO_CHARS + MAX_THUMB_CHARS + 10_000) return c.json({ error: 'Foto grande demais' }, 413)
  const { data, thumb, caption } = await c.req.json()
  if (!PHOTO_RE.test(data || '') || data.length > MAX_PHOTO_CHARS) return c.json({ error: 'Foto inválida — use JPG, PNG ou WEBP.' }, 400)
  if (!PHOTO_RE.test(thumb || '') || thumb.length > MAX_THUMB_CHARS) return c.json({ error: 'Miniatura inválida' }, 400)
  const count = await db.scalar('SELECT COUNT(*) FROM success_case_photos WHERE case_id = ?', row.id)
  if (count >= MAX_PHOTOS) return c.json({ error: `Máximo de ${MAX_PHOTOS} fotos por case.` }, 400)
  const id = uuid()
  await db.prepare('INSERT INTO success_case_photos (id, case_id, thumb, data, caption, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, row.id, thumb, data, str(caption, 60), c.get('user').id)
  return c.json({ id, thumb, caption: str(caption, 60) })
})

app.delete('/:id/photos/:photoId', async c => {
  await c.get('db').prepare('DELETE FROM success_case_photos WHERE id = ? AND case_id = ?').run(c.req.param('photoId'), c.req.param('id'))
  return c.json({ ok: true })
})

export default app

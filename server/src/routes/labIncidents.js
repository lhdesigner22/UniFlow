import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

// Fluxos → Incidentes Laboratórios: máquinas com defeito, sinistros/danos,
// projeção/TV, bagunça... nos laboratórios, com fotos. Módulo "incidents" (o
// portão do worker.js barra quem não vê / só vê). Qualquer um com acesso de
// edição registra e muda a situação (é o fluxo da equipe); editar os dados e
// excluir: quem registrou ou o Super Admin. Separado por departamento.
const app = new Hono()
app.use('*', auth)

export const BUILDINGS = ['sede', 'centro', 'g5']
export const CATEGORIES = ['maquina', 'sinistro', 'projecao', 'organizacao', 'rede', 'outro']
export const SEVERITIES = ['baixa', 'media', 'alta', 'critica']
export const STATUSES = ['aberto', 'em_andamento', 'resolvido']
const MAX_PHOTOS = 10
// Fotos já chegam reduzidas pelo navegador (≈1600 px / 360 px); o teto só
// impede gravar imagem enorme direto pela API. Sem SVG.
const PHOTO_RE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/
const MAX_PHOTO_CHARS = 1_600_000
const MAX_THUMB_CHARS = 150_000

const COLUMNS = `
  i.id, i.building, i.lab, i.category, i.severity, i.title, i.description, i.equipment, i.patrimony,
  i.occurred_at, i.reported_by_name, i.class_info, i.glpi_ticket, i.status, i.resolution, i.resolved_at,
  i.department_id, dd.name as department_name, dd.color as department_color,
  i.created_by, u.name as author_name, rb.name as resolved_by_name, i.created_at, i.updated_at,
  (SELECT COUNT(*) FROM lab_incident_photos p WHERE p.incident_id = i.id) as photo_count
`
const FROM = `FROM lab_incidents i
  LEFT JOIN users u ON u.id = i.created_by
  LEFT JOIN users rb ON rb.id = i.resolved_by
  LEFT JOIN departments dd ON dd.id = i.department_id`

const str = (v, max) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

// Valida/normaliza os campos. `current` = registro atual (PUT), pra campo não enviado manter o valor.
function clean(body, current = {}) {
  const pick = (k, fn) => (body[k] !== undefined ? fn(body[k]) : (current[k] ?? null))
  const out = {
    building: pick('building', v => String(v || '')),
    lab: pick('lab', v => str(v, 80)),
    category: pick('category', v => String(v || '')),
    severity: pick('severity', v => String(v || 'media')) || 'media',
    title: pick('title', v => str(v, 140)),
    description: pick('description', v => str(v, 5000)),
    equipment: pick('equipment', v => str(v, 140)),
    patrimony: pick('patrimony', v => str(v, 60)),
    occurred_at: pick('occurred_at', v => String(v || '').trim()),
    reported_by_name: pick('reported_by_name', v => str(v, 120)),
    class_info: pick('class_info', v => str(v, 200)),
    glpi_ticket: pick('glpi_ticket', v => str(v, 20)),
  }
  if (!BUILDINGS.includes(out.building)) return { error: 'Prédio inválido (use sede, centro ou g5)' }
  if (!out.lab) return { error: 'Informe o laboratório / sala' }
  if (!CATEGORIES.includes(out.category)) return { error: 'Tipo de incidente inválido' }
  if (!SEVERITIES.includes(out.severity)) return { error: 'Gravidade inválida' }
  if (!out.title) return { error: 'Escreva um resumo do incidente' }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(out.occurred_at || '')) return { error: 'Informe a data e a hora da ocorrência' }
  return out
}

async function getForEdit(c, id) {
  const access = await accessOf(c)
  const row = await c.get('db').prepare('SELECT * FROM lab_incidents WHERE id = ?').get(id)
  // Registro de outro departamento é como se não existisse pra quem não o enxerga.
  if (!row || !canSeeDepartment(access, row.department_id)) return { row: null }
  const owns = row.created_by === c.get('user').id
  const canEditData = (owns || access.systemRole === 'super_admin') && canModifyDepartment(access, row.department_id, owns)
  return { row, access, canEditData, canChangeStatus: canModifyDepartment(access, row.department_id, owns) }
}

const one = (db, id) => db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE i.id = ?`).get(id)

// GET / ?building=&status= — lista (mais recentes primeiro), com a 1ª foto em miniatura.
app.get('/', async c => {
  const db = c.get('db')
  const dept = departmentFilter(await accessOf(c), 'i.department_id')
  let sql = `SELECT ${COLUMNS},
    (SELECT p.thumb FROM lab_incident_photos p WHERE p.incident_id = i.id ORDER BY p.created_at LIMIT 1) as cover
    ${FROM} WHERE 1=1${dept.sql}`
  const args = [...dept.args]
  const building = c.req.query('building')
  if (BUILDINGS.includes(building)) { sql += ' AND i.building = ?'; args.push(building) }
  const status = c.req.query('status')
  if (STATUSES.includes(status)) { sql += ' AND i.status = ?'; args.push(status) }
  sql += ' ORDER BY i.occurred_at DESC, i.created_at DESC LIMIT 500'
  return c.json(await db.prepare(sql).all(...args))
})

// GET /counts — abertos + em andamento por prédio (números do menu)
app.get('/counts', async c => {
  const dept = departmentFilter(await accessOf(c), 'department_id')
  const rows = await c.get('db').prepare(
    `SELECT building, COUNT(*) as n FROM lab_incidents WHERE status != 'resolvido'${dept.sql} GROUP BY building`
  ).all(...dept.args)
  return c.json(Object.fromEntries(rows.map(r => [r.building, r.n])))
})

// GET /export?format=json — todos os campos, pra planilha (client/src/utils/exports.js)
app.get('/export', async c => {
  const db = c.get('db')
  const dept = departmentFilter(await accessOf(c), 'i.department_id')
  let sql = `SELECT ${COLUMNS} ${FROM} WHERE 1=1${dept.sql}`
  const args = [...dept.args]
  const building = c.req.query('building')
  if (BUILDINGS.includes(building)) { sql += ' AND i.building = ?'; args.push(building) }
  sql += ' ORDER BY i.occurred_at DESC'
  return c.json({ rows: await db.prepare(sql).all(...args) })
})

// GET /:id — detalhe + miniaturas de todas as fotos
app.get('/:id', async c => {
  const db = c.get('db')
  const { row } = await getForEdit(c, c.req.param('id'))
  if (!row) return c.json({ error: 'Incidente não encontrado' }, 404)
  const incident = await one(db, row.id)
  incident.photos = await db.prepare('SELECT id, thumb, created_at FROM lab_incident_photos WHERE incident_id = ? ORDER BY created_at').all(row.id)
  return c.json(incident)
})

// GET /:id/photos/:photoId — foto em tamanho grande
app.get('/:id/photos/:photoId', async c => {
  const { row } = await getForEdit(c, c.req.param('id'))
  if (!row) return c.json({ error: 'Incidente não encontrado' }, 404)
  const photo = await c.get('db').prepare('SELECT id, data FROM lab_incident_photos WHERE id = ? AND incident_id = ?').get(c.req.param('photoId'), row.id)
  if (!photo) return c.json({ error: 'Foto não encontrada' }, 404)
  return c.json(photo)
})

app.post('/', async c => {
  const db = c.get('db')
  const body = await c.req.json()
  const v = clean(body)
  if (v.error) return c.json(v, 400)
  const id = uuid()
  await db.prepare(`
    INSERT INTO lab_incidents (id, building, lab, category, severity, title, description, equipment, patrimony,
      occurred_at, reported_by_name, class_info, glpi_ticket, department_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, v.building, v.lab, v.category, v.severity, v.title, v.description, v.equipment, v.patrimony,
    v.occurred_at, v.reported_by_name, v.class_info, v.glpi_ticket, departmentForCreate(await accessOf(c), body.department_id), c.get('user').id)
  return c.json(await one(db, id))
})

app.put('/:id', async c => {
  const db = c.get('db')
  const { row, access, canEditData } = await getForEdit(c, c.req.param('id'))
  if (!row) return c.json({ error: 'Incidente não encontrado' }, 404)
  if (!canEditData) return c.json({ error: 'Só quem registrou (ou o Super Admin) edita os dados do incidente.' }, 403)
  const body = await c.req.json()
  const v = clean(body, row)
  if (v.error) return c.json(v, 400)
  await db.prepare(`
    UPDATE lab_incidents SET building = ?, lab = ?, category = ?, severity = ?, title = ?, description = ?, equipment = ?,
      patrimony = ?, occurred_at = ?, reported_by_name = ?, class_info = ?, glpi_ticket = ?, department_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(v.building, v.lab, v.category, v.severity, v.title, v.description, v.equipment, v.patrimony, v.occurred_at,
    v.reported_by_name, v.class_info, v.glpi_ticket, departmentForUpdate(access, row.department_id, body.department_id), row.id)
  return c.json(await one(db, row.id))
})

// POST /:id/status { status, resolution } — andamento (qualquer um da equipe)
app.post('/:id/status', async c => {
  const db = c.get('db')
  const { row, canChangeStatus } = await getForEdit(c, c.req.param('id'))
  if (!row) return c.json({ error: 'Incidente não encontrado' }, 404)
  if (!canChangeStatus) return c.json({ error: 'Sem permissão' }, 403)
  const { status, resolution } = await c.req.json()
  if (!STATUSES.includes(status)) return c.json({ error: 'Situação inválida' }, 400)
  const done = status === 'resolvido'
  await db.prepare(`
    UPDATE lab_incidents SET status = ?, resolution = ?, resolved_at = ?, resolved_by = ?, updated_at = datetime('now') WHERE id = ?
  `).run(
    status,
    resolution !== undefined ? str(resolution, 5000) : row.resolution,
    done ? (row.status === 'resolvido' ? row.resolved_at : new Date().toISOString()) : null,
    done ? (row.status === 'resolvido' ? row.resolved_by : c.get('user').id) : null,
    row.id,
  )
  return c.json(await one(db, row.id))
})

app.delete('/:id', async c => {
  const { row, canEditData } = await getForEdit(c, c.req.param('id'))
  if (!row) return c.json({ error: 'Incidente não encontrado' }, 404)
  if (!canEditData) return c.json({ error: 'Só quem registrou (ou o Super Admin) exclui o incidente.' }, 403)
  await c.get('db').batch([
    { sql: 'DELETE FROM lab_incident_photos WHERE incident_id = ?', args: [row.id] },
    { sql: 'DELETE FROM lab_incidents WHERE id = ?', args: [row.id] },
  ])
  return c.json({ ok: true })
})

// POST /:id/photos { data, thumb } — uma foto por vez (cada uma já reduzida no navegador)
app.post('/:id/photos', async c => {
  const db = c.get('db')
  const { row, canChangeStatus } = await getForEdit(c, c.req.param('id'))
  if (!row) return c.json({ error: 'Incidente não encontrado' }, 404)
  if (!canChangeStatus) return c.json({ error: 'Sem permissão' }, 403)
  if (Number(c.req.header('Content-Length') || 0) > MAX_PHOTO_CHARS + MAX_THUMB_CHARS + 10_000) return c.json({ error: 'Foto grande demais' }, 413)
  const { data, thumb } = await c.req.json()
  if (!PHOTO_RE.test(data || '') || data.length > MAX_PHOTO_CHARS) return c.json({ error: 'Foto inválida — use JPG, PNG ou WEBP.' }, 400)
  if (!PHOTO_RE.test(thumb || '') || thumb.length > MAX_THUMB_CHARS) return c.json({ error: 'Miniatura inválida' }, 400)
  const count = await db.scalar('SELECT COUNT(*) FROM lab_incident_photos WHERE incident_id = ?', row.id)
  if (count >= MAX_PHOTOS) return c.json({ error: `Máximo de ${MAX_PHOTOS} fotos por incidente.` }, 400)
  const id = uuid()
  await db.prepare('INSERT INTO lab_incident_photos (id, incident_id, thumb, data, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, row.id, thumb, data, c.get('user').id)
  return c.json({ id, thumb })
})

app.delete('/:id/photos/:photoId', async c => {
  const { row, canEditData } = await getForEdit(c, c.req.param('id'))
  if (!row) return c.json({ error: 'Incidente não encontrado' }, 404)
  if (!canEditData) return c.json({ error: 'Só quem registrou (ou o Super Admin) remove fotos.' }, 403)
  await c.get('db').prepare('DELETE FROM lab_incident_photos WHERE id = ? AND incident_id = ?').run(c.req.param('photoId'), row.id)
  return c.json({ ok: true })
})

export default app

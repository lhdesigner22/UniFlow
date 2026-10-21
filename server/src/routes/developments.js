import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { normalizeLink, isLinkError } from '../lib/safeUrl.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

// Gestão → Desenvolvimentos: os sistemas que a equipe desenvolveu, com logo e
// para que cada um serve. Módulo "gestao" (o portão do worker.js já barra quem
// não pode ver / só pode ver). Criar: quem edita a Gestão; editar/excluir: o
// autor ou o Super Admin. Separado por departamento como o resto (NULL = Geral).
const app = new Hono()
app.use('*', auth)

const STATUSES = ['producao', 'desenvolvimento', 'descontinuado']
// Logo já chega reduzida (≤ 256 px) pelo navegador; o teto aqui só impede
// alguém de gravar uma imagem enorme direto pela API. SVG fica de fora (pode
// carregar script).
const MAX_LOGO_CHARS = 400_000
const LOGO_RE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/

const COLUMNS = `
  d.id, d.name, d.purpose, d.url, d.logo, d.status, d.order_index,
  d.created_by, d.created_at, d.updated_at, u.name as author_name,
  d.department_id, dd.name as department_name, dd.color as department_color
`
const FROM = 'FROM developments d LEFT JOIN users u ON u.id = d.created_by LEFT JOIN departments dd ON dd.id = d.department_id'

function clean(body, current = {}) {
  const name = body.name !== undefined ? String(body.name || '').trim() : current.name
  if (!name) return { error: 'Nome é obrigatório' }
  if (name.length > 80) return { error: 'Nome muito longo (máx. 80 caracteres)' }
  const purpose = body.purpose !== undefined ? (String(body.purpose || '').trim() || null) : (current.purpose ?? null)
  if (purpose && purpose.length > 2000) return { error: 'Descrição muito longa (máx. 2000 caracteres)' }
  const url = body.url !== undefined ? normalizeLink(body.url) : current.url
  if (isLinkError(url)) return url
  let logo = current.logo ?? null
  if (body.logo !== undefined) {
    logo = body.logo || null
    if (logo && (logo.length > MAX_LOGO_CHARS || !LOGO_RE.test(logo))) return { error: 'Logo inválida — use uma imagem PNG, JPG ou WEBP.' }
  }
  const status = body.status !== undefined ? body.status : (current.status || 'producao')
  if (!STATUSES.includes(status)) return { error: 'Situação inválida' }
  return { name, purpose, url: url ?? null, logo, status }
}

async function getForEdit(c, id) {
  const db = c.get('db')
  const access = await accessOf(c)
  const row = await db.prepare('SELECT * FROM developments WHERE id = ?').get(id)
  if (!row || !canSeeDepartment(access, row.department_id)) return { row: null }
  const owns = row.created_by === c.get('user').id
  const allowed = (owns || access.systemRole === 'super_admin') && canModifyDepartment(access, row.department_id, owns)
  return { row, allowed, access }
}

// GET / — lista na ordem do menu. `?menu=1` = só id e nome (o menu lateral
// carrega isso sem baixar as logos).
app.get('/', async c => {
  const dept = departmentFilter(await accessOf(c), 'd.department_id')
  const cols = c.req.query('menu') ? 'd.id, d.name' : COLUMNS
  return c.json(await c.get('db').prepare(`SELECT ${cols} ${FROM} WHERE 1=1${dept.sql} ORDER BY d.order_index, d.name`).all(...dept.args))
})

app.post('/', async c => {
  const db = c.get('db')
  const body = await c.req.json()
  const v = clean(body)
  if (v.error) return c.json(v, 400)
  const id = uuid()
  const last = await db.scalar('SELECT MAX(order_index) FROM developments')
  await db.prepare(`
    INSERT INTO developments (id, name, purpose, url, logo, status, order_index, department_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, v.name, v.purpose, v.url, v.logo, v.status, (last ?? -1) + 1, departmentForCreate(await accessOf(c), body.department_id), c.get('user').id)
  return c.json(await db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE d.id = ?`).get(id))
})

app.put('/:id', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const { row, allowed, access } = await getForEdit(c, id)
  if (!row) return c.json({ error: 'Desenvolvimento não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)
  const body = await c.req.json()
  const v = clean(body, row)
  if (v.error) return c.json(v, 400)
  await db.prepare(`
    UPDATE developments SET name = ?, purpose = ?, url = ?, logo = ?, status = ?, department_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(v.name, v.purpose, v.url, v.logo, v.status, departmentForUpdate(access, row.department_id, body.department_id), id)
  return c.json(await db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE d.id = ?`).get(id))
})

app.delete('/:id', async c => {
  const { row, allowed } = await getForEdit(c, c.req.param('id'))
  if (!row) return c.json({ error: 'Desenvolvimento não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)
  await c.get('db').prepare('DELETE FROM developments WHERE id = ?').run(row.id)
  return c.json({ ok: true })
})

export default app

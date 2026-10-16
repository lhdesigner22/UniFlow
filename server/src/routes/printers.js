import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { driveUploadFile, driveDownloadFile, driveDeleteFile, driveConfigured } from '../lib/driveClient.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

const app = new Hono()
app.use('*', auth) // qualquer usuário logado lê — só super_admin cadastra (ver POST /)

const LOCATIONS = ['sede', 'adm', 'centro', 'g5', 'clinicas']
// 95 MB — próximo do teto real da Cloudflare (100 MB de corpo de requisição
// no plano atual, um limite de PLATAFORMA que nem chega a rodar nosso código
// se estourado). Pra arquivos maiores que isso, o usuário precisa subir
// manualmente no Drive e usar o campo "Link direto de instalação".
const MAX_ATTACHMENT_BYTES = 95 * 1024 * 1024

// Colunas leves — sem nada do anexo além do necessário pra tela mostrar "tem
// driver" e o nome/tipo. O arquivo em si mora no Drive, nunca passa pelo D1.
const LIST_COLUMNS = `
  p.id, p.location, p.model, p.ip, p.department, p.link_url,
  p.attachment_name, p.attachment_type,
  CASE WHEN p.attachment_file_id IS NOT NULL THEN 1 ELSE 0 END as has_attachment,
  p.created_by, p.created_at, p.updated_at, u.name as author_name,
  p.department_id, dd.name as department_name, dd.color as department_color
`

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

async function getPrinterForEdit(db, id, user, access) {
  const printer = await db.prepare('SELECT * FROM printers WHERE id = ?').get(id)
  // Impressora de outro departamento é como se não existisse pra quem não a enxerga.
  if (!printer || !canSeeDepartment(access, printer.department_id)) return { printer: null, allowed: false }
  const owns = printer.created_by === user.id
  const allowed = (owns || await isSuperAdmin(db, user.id)) && canModifyDepartment(access, printer.department_id, owns)
  return { printer, allowed }
}

// GET /?location=sede|adm|centro — lista, mais recentes primeiro
app.get('/', async c => {
  const db = c.get('db')
  const location = c.req.query('location')

  let sql = `SELECT ${LIST_COLUMNS} FROM printers p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE 1=1`
  const args = []
  const dept = departmentFilter(await accessOf(c), 'p.department_id')
  sql += dept.sql
  args.push(...dept.args)
  if (location) { sql += ' AND p.location = ?'; args.push(location) }
  sql += ' ORDER BY p.order_index, p.model'

  return c.json(await db.prepare(sql).all(...args))
})

// GET /:id/attachment — baixa o driver (repassa o stream do Drive direto,
// sem bufferizar o arquivo inteiro em memória no Worker)
app.get('/:id/attachment', async c => {
  const db = c.get('db')
  const id = c.req.param('id')

  const row = await db.prepare('SELECT attachment_name, attachment_type, attachment_file_id, department_id FROM printers WHERE id = ?').get(id)
  if (!row?.attachment_file_id || !canSeeDepartment(await accessOf(c), row.department_id)) return c.json({ error: 'Sem driver anexado' }, 404)
  if (!driveConfigured(c.env)) return c.json({ error: 'Armazenamento externo (Google Drive) ainda não configurado.' }, 503)

  let upstream
  try {
    upstream = await driveDownloadFile(c.env, { fileId: row.attachment_file_id })
  } catch (e) {
    return c.json({ error: `Falha ao buscar o driver: ${e.message}` }, 502)
  }
  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => '')
    return c.json({ error: `Falha ao buscar o driver (Drive respondeu ${upstream.status}): ${body.slice(0, 300)}` }, 502)
  }

  const filename = (row.attachment_name || 'driver').replace(/"/g, '')
  return c.body(upstream.body, 200, {
    'Content-Type': row.attachment_type || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(row.attachment_name || 'driver')}`,
  })
})

// POST /:id/attachment — sobe/troca o driver (multipart/form-data, campo
// "file"). Autor do cadastro ou super_admin.
app.post('/:id/attachment', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { printer, allowed } = await getPrinterForEdit(db, id, user, await accessOf(c))
  if (!printer) return c.json({ error: 'Impressora não encontrada' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)
  if (!driveConfigured(c.env)) return c.json({ error: 'Armazenamento externo (Google Drive) ainda não configurado.' }, 503)

  const body = await c.req.parseBody()
  const file = body.file
  if (!file || typeof file === 'string') return c.json({ error: 'Nenhum arquivo enviado' }, 400)
  if (file.size > MAX_ATTACHMENT_BYTES)
    return c.json({ error: `Arquivo grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB) — máx. 95 MB. Pra arquivos maiores, suba no Drive manualmente e use o campo de link direto.` }, 400)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const fileName = `printer-${id}-${Date.now()}-${file.name}`

  let uploaded
  try {
    uploaded = await driveUploadFile(c.env, { fileName, contentType: file.type, data: bytes })
  } catch (e) {
    return c.json({ error: `Falha ao enviar o driver: ${e.message}` }, 502)
  }

  // Só apaga o driver anterior DEPOIS do novo subir com sucesso — evita
  // ficar sem nenhum dos dois se o upload falhar no meio do caminho.
  if (printer.attachment_file_id) {
    await driveDeleteFile(c.env, { fileId: printer.attachment_file_id }).catch(() => {})
  }

  await db.prepare(`
    UPDATE printers SET
      attachment_name = ?, attachment_type = ?, attachment_file_id = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(file.name, file.type || 'application/octet-stream', uploaded.fileId, id)

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM printers p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id))
})

// DELETE /:id/attachment — remove o driver (do Drive e do cadastro)
app.delete('/:id/attachment', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { printer, allowed } = await getPrinterForEdit(db, id, user, await accessOf(c))
  if (!printer) return c.json({ error: 'Impressora não encontrada' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  if (printer.attachment_file_id) {
    await driveDeleteFile(c.env, { fileId: printer.attachment_file_id }).catch(() => {})
  }
  await db.prepare(`
    UPDATE printers SET attachment_name = NULL, attachment_type = NULL, attachment_file_id = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(id)

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM printers p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id))
})

// POST / — só super_admin cadastra impressora (leitura continua liberada
// pra qualquer usuário logado). O driver (se houver) é enviado depois, num
// segundo passo, via POST /:id/attachment.
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { location, model, ip, department, link_url, department_id } = await c.req.json()
  if (!LOCATIONS.includes(location)) return c.json({ error: 'Local inválido (use sede, adm, centro, g5 ou clinicas)' }, 400)
  if (!model?.trim()) return c.json({ error: 'Nome do modelo é obrigatório' }, 400)

  const id = uuid()
  // Entra no fim da lista daquele local.
  const last = await db.prepare('SELECT MAX(order_index) as m FROM printers WHERE location = ?').get(location)
  await db.prepare(`
    INSERT INTO printers (id, location, model, ip, department, link_url, order_index, created_by, department_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, location, model.trim(), ip?.trim() || null, department?.trim() || null, link_url || null, (last?.m ?? -1) + 1, user.id, departmentForCreate(await accessOf(c), department_id))

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM printers p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id))
})

// PUT /reorder — body { ids: [...] } — salva a ordem de arrastar-e-soltar de
// um local (o front manda só os ids daquele local). Só super_admin. Precisa
// vir ANTES de PUT /:id, senão "reorder" é tratado como um :id.
app.put('/reorder', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { ids } = await c.req.json()
  if (!Array.isArray(ids)) return c.json({ error: 'ids deve ser um array' }, 400)

  await db.batch(ids.map((id, index) => ({ sql: 'UPDATE printers SET order_index = ? WHERE id = ?', args: [index, id] })))
  return c.json({ ok: true })
})

// PUT /:id — autor ou super_admin. Só os campos de texto — o driver é
// gerenciado pelas rotas dedicadas acima.
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { printer, allowed } = await getPrinterForEdit(db, id, user, await accessOf(c))
  if (!printer) return c.json({ error: 'Impressora não encontrada' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  const { location, model, ip, department, link_url, department_id } = await c.req.json()
  const loc = LOCATIONS.includes(location) ? location : printer.location

  await db.prepare(`
    UPDATE printers SET location = ?, model = ?, ip = ?, department = ?, link_url = ?, department_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    loc,
    model?.trim() || printer.model,
    ip !== undefined ? (ip?.trim() || null) : printer.ip,
    department !== undefined ? (department?.trim() || null) : printer.department,
    link_url !== undefined ? link_url : printer.link_url,
    departmentForUpdate(await accessOf(c), printer.department_id, department_id),
    id
  )

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM printers p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN departments dd ON dd.id = p.department_id WHERE p.id = ?`).get(id))
})

// DELETE /:id — autor ou super_admin. Apaga o driver no Drive junto (best-effort).
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { printer, allowed } = await getPrinterForEdit(db, id, user, await accessOf(c))
  if (!printer) return c.json({ error: 'Impressora não encontrada' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  if (printer.attachment_file_id) {
    await driveDeleteFile(c.env, { fileId: printer.attachment_file_id }).catch(() => {})
  }
  await db.prepare('DELETE FROM printers WHERE id = ?').run(id)
  return c.json({ ok: true })
})

export default app

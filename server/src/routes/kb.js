import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { driveUploadFile, driveDownloadFile, driveDeleteFile, driveConfigured } from '../lib/driveClient.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate, canSeeDepartment, canModifyDepartment } from '../lib/permissions.js'

const app = new Hono()
app.use('*', auth) // qualquer usuário logado lê e cria — é uma base compartilhada; editar/excluir é só autor ou super_admin (ver POST/PUT/DELETE)

const CATEGORIES = ['texto_pronto', 'politica', 'documento', 'outro', 'gestao']
// 95 MB — próximo do teto real da Cloudflare (100 MB de corpo de requisição
// no plano atual, um limite de PLATAFORMA que nem chega a rodar nosso código
// se estourado). Pra arquivos maiores que isso, precisa subir manualmente no
// Drive e colar o link.
const MAX_ATTACHMENT_BYTES = 95 * 1024 * 1024

// Colunas leves — sem nada do anexo além do necessário pra tela mostrar "tem
// anexo" e o nome/tipo. O arquivo em si mora no Drive, nunca passa pelo D1.
// `attachment_file_id` guarda o ID do arquivo no Drive (suficiente por si só
// — ao contrário do B2, o Drive não precisa de uma "chave"/caminho separada).
const LIST_COLUMNS = `
  a.id, a.title, a.category, a.content, a.link_url,
  a.attachment_name, a.attachment_type,
  CASE WHEN a.attachment_file_id IS NOT NULL THEN 1 ELSE 0 END as has_attachment,
  a.created_by, a.created_at, a.updated_at, u.name as author_name,
  a.department_id, dd.name as department_name, dd.color as department_color
`

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

// Auditor pode editar/excluir QUALQUER artigo (não só o próprio) — é
// justamente a área que esse perfil tem liberação pra alterar, ver o
// middleware global em worker.js.
async function isAuditor(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'auditor'
}

async function getArticleForEdit(db, id, user, access) {
  const article = await db.prepare('SELECT * FROM kb_articles WHERE id = ?').get(id)
  // Artigo de outro departamento é como se não existisse pra quem não o enxerga.
  if (!article || !canSeeDepartment(access, article.department_id)) return { article: null, allowed: false }
  const owns = article.created_by === user.id
  const allowed = (owns || await isSuperAdmin(db, user.id) || await isAuditor(db, user.id)) && canModifyDepartment(access, article.department_id, owns)
  return { article, allowed }
}

// GET /?category=&q= — lista, mais recentes primeiro. "gestao" é uma seção
// separada (aba própria "Gestão", ver GestaoPage.jsx) — sem filtro
// explícito, fica de fora da Base de Conhecimento geral pra não misturar.
app.get('/', async c => {
  const db = c.get('db')
  const category = c.req.query('category')
  const q = c.req.query('q')

  let sql = `SELECT ${LIST_COLUMNS} FROM kb_articles a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN departments dd ON dd.id = a.department_id WHERE 1=1`
  const args = []
  const dept = departmentFilter(await accessOf(c), 'a.department_id')
  sql += dept.sql
  args.push(...dept.args)
  if (category) { sql += ' AND a.category = ?'; args.push(category) }
  else { sql += " AND a.category != 'gestao'" }
  if (q) { sql += ' AND (a.title LIKE ? OR a.content LIKE ?)'; args.push(`%${q}%`, `%${q}%`) }
  sql += ' ORDER BY a.updated_at DESC'

  return c.json(await db.prepare(sql).all(...args))
})

// GET /:id/attachment — baixa o anexo (repassa o stream do Drive direto,
// sem bufferizar o arquivo inteiro em memória no Worker)
app.get('/:id/attachment', async c => {
  const db = c.get('db')
  const id = c.req.param('id')

  const row = await db.prepare('SELECT attachment_name, attachment_type, attachment_file_id, department_id FROM kb_articles WHERE id = ?').get(id)
  if (!row?.attachment_file_id || !canSeeDepartment(await accessOf(c), row.department_id)) return c.json({ error: 'Sem anexo' }, 404)
  if (!driveConfigured(c.env)) return c.json({ error: 'Armazenamento externo (Google Drive) ainda não configurado.' }, 503)

  let upstream
  try {
    upstream = await driveDownloadFile(c.env, { fileId: row.attachment_file_id })
  } catch (e) {
    return c.json({ error: `Falha ao buscar o anexo: ${e.message}` }, 502)
  }
  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => '')
    return c.json({ error: `Falha ao buscar o anexo (Drive respondeu ${upstream.status}): ${body.slice(0, 300)}` }, 502)
  }

  const filename = (row.attachment_name || 'anexo').replace(/"/g, '')
  return c.body(upstream.body, 200, {
    'Content-Type': row.attachment_type || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(row.attachment_name || 'anexo')}`,
  })
})

// POST /:id/attachment — sobe/troca o anexo (multipart/form-data, campo
// "file"). Autor do artigo ou super_admin.
app.post('/:id/attachment', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { article, allowed } = await getArticleForEdit(db, id, user, await accessOf(c))
  if (!article) return c.json({ error: 'Artigo não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)
  if (!driveConfigured(c.env)) return c.json({ error: 'Armazenamento externo (Google Drive) ainda não configurado.' }, 503)

  const body = await c.req.parseBody()
  const file = body.file
  if (!file || typeof file === 'string') return c.json({ error: 'Nenhum arquivo enviado' }, 400)
  if (file.size > MAX_ATTACHMENT_BYTES)
    return c.json({ error: `Anexo grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB) — máx. 95 MB.` }, 400)

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Prefixo com o id do artigo + timestamp só pra facilitar identificar o
  // arquivo olhando a pasta do Drive direto — o Drive não usa isso como
  // "caminho" (like B2/S3), o nome pode repetir sem colidir.
  const fileName = `${id}-${Date.now()}-${file.name}`

  let uploaded
  try {
    uploaded = await driveUploadFile(c.env, { fileName, contentType: file.type, data: bytes })
  } catch (e) {
    // Detalhe real do erro (vindo do Google) na resposta — só assim dá pra
    // diagnosticar sem precisar de log ao vivo sincronizado com o clique.
    return c.json({ error: `Falha ao enviar o anexo: ${e.message}` }, 502)
  }

  // Só apaga o anexo anterior DEPOIS do novo subir com sucesso — evita
  // ficar sem nenhum dos dois se o upload falhar no meio do caminho.
  if (article.attachment_file_id) {
    await driveDeleteFile(c.env, { fileId: article.attachment_file_id }).catch(() => {})
  }

  await db.prepare(`
    UPDATE kb_articles SET
      attachment_name = ?, attachment_type = ?, attachment_file_id = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(file.name, file.type || 'application/octet-stream', uploaded.fileId, id)

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM kb_articles a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN departments dd ON dd.id = a.department_id WHERE a.id = ?`).get(id))
})

// DELETE /:id/attachment — remove o anexo (do Drive e do artigo)
app.delete('/:id/attachment', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { article, allowed } = await getArticleForEdit(db, id, user, await accessOf(c))
  if (!article) return c.json({ error: 'Artigo não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  if (article.attachment_file_id) {
    await driveDeleteFile(c.env, { fileId: article.attachment_file_id }).catch(() => {})
  }
  await db.prepare(`
    UPDATE kb_articles SET attachment_name = NULL, attachment_type = NULL, attachment_file_id = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(id)

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM kb_articles a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN departments dd ON dd.id = a.department_id WHERE a.id = ?`).get(id))
})

// POST / — qualquer usuário logado cria artigo (editar/excluir depois já
// fica restrito a quem criou ou super_admin, ver getArticleForEdit). O
// anexo (se houver) é enviado depois, num segundo passo, via POST /:id/attachment.
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')

  const { title, category, content, link_url, department_id } = await c.req.json()
  if (!title?.trim()) return c.json({ error: 'Título é obrigatório' }, 400)
  const cat = CATEGORIES.includes(category) ? category : 'outro'

  const id = uuid()
  await db.prepare(`
    INSERT INTO kb_articles (id, title, category, content, link_url, created_by, department_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, title.trim(), cat, content || null, link_url || null, user.id, departmentForCreate(await accessOf(c), department_id))

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM kb_articles a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN departments dd ON dd.id = a.department_id WHERE a.id = ?`).get(id))
})

// PUT /:id — autor ou super_admin. Só os campos de texto — o anexo é
// gerenciado pelas rotas dedicadas acima.
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { article, allowed } = await getArticleForEdit(db, id, user, await accessOf(c))
  if (!article) return c.json({ error: 'Artigo não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  const { title, category, content, link_url, department_id } = await c.req.json()
  const cat = CATEGORIES.includes(category) ? category : article.category

  await db.prepare(`
    UPDATE kb_articles SET title = ?, category = ?, content = ?, link_url = ?, department_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title?.trim() || article.title, cat, content !== undefined ? content : article.content, link_url !== undefined ? link_url : article.link_url, departmentForUpdate(await accessOf(c), article.department_id, department_id), id)

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM kb_articles a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN departments dd ON dd.id = a.department_id WHERE a.id = ?`).get(id))
})

// DELETE /:id — autor ou super_admin. Apaga o anexo no Drive junto (best-effort).
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')

  const { article, allowed } = await getArticleForEdit(db, id, user, await accessOf(c))
  if (!article) return c.json({ error: 'Artigo não encontrado' }, 404)
  if (!allowed) return c.json({ error: 'Sem permissão' }, 403)

  if (article.attachment_file_id) {
    await driveDeleteFile(c.env, { fileId: article.attachment_file_id }).catch(() => {})
  }
  await db.prepare('DELETE FROM kb_articles WHERE id = ?').run(id)
  return c.json({ ok: true })
})

export default app

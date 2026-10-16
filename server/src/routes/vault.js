import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { encryptSecret, decryptSecret } from '../lib/vaultCrypto.js'

// Cofre de senhas — acesso (ver e editar) NÃO segue o system_role normal:
// é uma lista própria (vault_access) que só Super Admin concede/revoga
// pessoa por pessoa. Super Admin sempre tem acesso, mesmo sem estar na
// lista. A senha em si nunca trafega em bulk — só via GET /:id/reveal,
// chamado sob demanda quando a pessoa clica em "Mostrar"/"Copiar".
const app = new Hono()
app.use('*', auth)

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

export async function hasVaultAccess(db, userId) {
  if (await isSuperAdmin(db, userId)) return true
  const row = await db.prepare('SELECT 1 FROM vault_access WHERE user_id = ?').get(userId)
  return !!row
}

app.use('*', async (c, next) => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await hasVaultAccess(db, user.id))) {
    return c.json({ error: 'Sem acesso ao Cofre de Senhas. Peça pra um Super Admin te autorizar.' }, 403)
  }
  await next()
})

const requireSuperAdmin = async (c, next) => {
  if (!(await isSuperAdmin(c.get('db'), c.get('user').id))) {
    return c.json({ error: 'Só Super Admin pode gerenciar quem acessa o cofre.' }, 403)
  }
  await next()
}

const LIST_COLUMNS = `
  v.id, v.title, v.category, v.username, v.url, v.notes,
  v.created_by, v.created_at, v.updated_at, u.name as author_name
`

// ── Quem tem acesso (rotas /access/* ANTES de /:id — senão o Hono lê
//    "access" como se fosse um :id) ──────────────────────────────────────
app.get('/access/list', requireSuperAdmin, async c => {
  const db = c.get('db')
  return c.json(await db.prepare(`
    SELECT va.id, va.user_id, va.granted_at, u.name as user_name, u.email as user_email
    FROM vault_access va JOIN users u ON u.id = va.user_id
    ORDER BY u.name
  `).all())
})

app.post('/access', requireSuperAdmin, async c => {
  const db = c.get('db')
  const user = c.get('user')
  const { user_id } = await c.req.json()
  if (!user_id) return c.json({ error: 'user_id é obrigatório' }, 400)
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(user_id)
  if (!target) return c.json({ error: 'Usuário não encontrado' }, 404)

  const existing = await db.prepare('SELECT id FROM vault_access WHERE user_id = ?').get(user_id)
  if (existing) return c.json({ error: 'Esse usuário já tem acesso.' }, 409)

  const id = uuid()
  await db.prepare('INSERT INTO vault_access (id, user_id, granted_by) VALUES (?, ?, ?)').run(id, user_id, user.id)
  return c.json(await db.prepare(`
    SELECT va.id, va.user_id, va.granted_at, u.name as user_name, u.email as user_email
    FROM vault_access va JOIN users u ON u.id = va.user_id WHERE va.id = ?
  `).get(id))
})

app.delete('/access/:userId', requireSuperAdmin, async c => {
  const db = c.get('db')
  await db.prepare('DELETE FROM vault_access WHERE user_id = ?').run(c.req.param('userId'))
  return c.json({ ok: true })
})

// ── Entradas do cofre ────────────────────────────────────────────────────

// GET / — lista tudo, sem a senha
app.get('/', async c => {
  const db = c.get('db')
  return c.json(await db.prepare(`
    SELECT ${LIST_COLUMNS} FROM vault_entries v LEFT JOIN users u ON u.id = v.created_by
    ORDER BY v.title
  `).all())
})

// GET /:id/reveal — decifra e devolve só a senha desse item
app.get('/:id/reveal', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const row = await db.prepare('SELECT password_enc, password_iv FROM vault_entries WHERE id = ?').get(id)
  if (!row) return c.json({ error: 'Item não encontrado' }, 404)
  try {
    const password = await decryptSecret(c.env, row.password_enc, row.password_iv)
    return c.json({ password })
  } catch (e) {
    return c.json({ error: `Falha ao decifrar: ${e.message}` }, 500)
  }
})

// POST / — cria entrada
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const { title, category, username, password, url, notes } = await c.req.json()
  if (!title?.trim()) return c.json({ error: 'Título é obrigatório' }, 400)
  if (!password) return c.json({ error: 'Senha é obrigatória' }, 400)

  const { ciphertext, iv } = await encryptSecret(c.env, password)
  const id = uuid()
  await db.prepare(`
    INSERT INTO vault_entries (id, title, category, username, password_enc, password_iv, url, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, title.trim(), category?.trim() || null, username?.trim() || null,
    ciphertext, iv, url?.trim() || null, notes?.trim() || null, user.id
  )

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM vault_entries v LEFT JOIN users u ON u.id = v.created_by WHERE v.id = ?`).get(id))
})

// PUT /:id — se `password` vier vazio/ausente, mantém a senha atual
app.put('/:id', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const row = await db.prepare('SELECT * FROM vault_entries WHERE id = ?').get(id)
  if (!row) return c.json({ error: 'Item não encontrado' }, 404)

  const { title, category, username, password, url, notes } = await c.req.json()
  let passwordEnc = row.password_enc
  let passwordIv = row.password_iv
  if (password) {
    const enc = await encryptSecret(c.env, password)
    passwordEnc = enc.ciphertext
    passwordIv = enc.iv
  }

  await db.prepare(`
    UPDATE vault_entries SET
      title = ?, category = ?, username = ?, password_enc = ?, password_iv = ?, url = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title?.trim() || row.title,
    category !== undefined ? (category?.trim() || null) : row.category,
    username !== undefined ? (username?.trim() || null) : row.username,
    passwordEnc, passwordIv,
    url !== undefined ? (url?.trim() || null) : row.url,
    notes !== undefined ? (notes?.trim() || null) : row.notes,
    id
  )

  return c.json(await db.prepare(`SELECT ${LIST_COLUMNS} FROM vault_entries v LEFT JOIN users u ON u.id = v.created_by WHERE v.id = ?`).get(id))
})

// DELETE /:id
app.delete('/:id', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const row = await db.prepare('SELECT id FROM vault_entries WHERE id = ?').get(id)
  if (!row) return c.json({ error: 'Item não encontrado' }, 404)
  await db.prepare('DELETE FROM vault_entries WHERE id = ?').run(id)
  return c.json({ ok: true })
})

export default app

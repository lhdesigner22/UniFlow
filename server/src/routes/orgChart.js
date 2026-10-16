import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'
import { accessOf, departmentFilter, departmentForCreate, departmentForUpdate } from '../lib/permissions.js'

const app = new Hono()
app.use('*', auth) // qualquer usuário logado lê — só super_admin edita

async function isSuperAdmin(db, userId) {
  const u = await db.prepare('SELECT system_role FROM users WHERE id = ?').get(userId)
  return u?.system_role === 'super_admin'
}

// GET / — lista plana (o front-end monta a árvore a partir de parent_id)
app.get('/', async c => {
  const db = c.get('db')
  const dept = departmentFilter(await accessOf(c), 'n.department_id')
  return c.json(await db.prepare(`
    SELECT n.*, d.name AS department_name, d.color AS department_color
    FROM org_chart_nodes n LEFT JOIN departments d ON d.id = n.department_id
    WHERE 1=1${dept.sql}
    ORDER BY n.order_index, n.name
  `).all(...dept.args))
})

// POST / — cria um cargo/pessoa; parent_id nulo = topo da hierarquia
app.post('/', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { name, role, parent_id, department_id } = await c.req.json()
  if (!name?.trim()) return c.json({ error: 'Nome (ou cargo) é obrigatório' }, 400)

  // Quem fica abaixo de alguém é do mesmo departamento dele (a árvore não cruza departamentos).
  let parentDept
  if (parent_id) {
    const parent = await db.prepare('SELECT id, department_id FROM org_chart_nodes WHERE id = ?').get(parent_id)
    if (!parent) return c.json({ error: 'Cargo superior não encontrado' }, 400)
    parentDept = parent.department_id
  }

  const maxIndex = parent_id
    ? await db.scalar('SELECT MAX(order_index) FROM org_chart_nodes WHERE parent_id = ?', parent_id)
    : await db.scalar('SELECT MAX(order_index) FROM org_chart_nodes WHERE parent_id IS NULL')
  const orderIndex = (maxIndex ?? -1) + 1

  const id = uuid()
  await db.prepare(`
    INSERT INTO org_chart_nodes (id, parent_id, name, role, order_index, created_by, department_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, parent_id || null, name.trim(), role?.trim() || null, orderIndex, user.id,
    parent_id ? (parentDept ?? null) : departmentForCreate(await accessOf(c), department_id))

  return c.json(await db.prepare('SELECT * FROM org_chart_nodes WHERE id = ?').get(id))
})

// PUT /:id — edita nome/cargo/superior
app.put('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const node = await db.prepare('SELECT * FROM org_chart_nodes WHERE id = ?').get(id)
  if (!node) return c.json({ error: 'Não encontrado' }, 404)

  const { name, role, parent_id, department_id } = await c.req.json()

  // Não deixa virar seu próprio ancestral (loop na árvore)
  if (parent_id) {
    if (parent_id === id) return c.json({ error: 'Um cargo não pode ser superior de si mesmo' }, 400)
    let cursor = await db.prepare('SELECT parent_id FROM org_chart_nodes WHERE id = ?').get(parent_id)
    while (cursor?.parent_id) {
      if (cursor.parent_id === id) return c.json({ error: 'Isso criaria um ciclo na hierarquia' }, 400)
      cursor = await db.prepare('SELECT parent_id FROM org_chart_nodes WHERE id = ?').get(cursor.parent_id)
    }
  }

  await db.prepare(`
    UPDATE org_chart_nodes SET name = ?, role = ?, parent_id = ?, department_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(name?.trim() || node.name, role !== undefined ? (role?.trim() || null) : node.role, parent_id !== undefined ? (parent_id || null) : node.parent_id,
    departmentForUpdate(await accessOf(c), node.department_id, department_id), id)

  return c.json(await db.prepare('SELECT * FROM org_chart_nodes WHERE id = ?').get(id))
})

// PUT /:id/position — só offset_x/offset_y (arrastar a caixa no canvas);
// mais leve que o PUT /:id completo, não mexe em nome/cargo/hierarquia.
app.put('/:id/position', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const node = await db.prepare('SELECT id FROM org_chart_nodes WHERE id = ?').get(id)
  if (!node) return c.json({ error: 'Não encontrado' }, 404)

  const { offset_x, offset_y } = await c.req.json()
  await db.prepare('UPDATE org_chart_nodes SET offset_x = ?, offset_y = ? WHERE id = ?')
    .run(Math.round(offset_x) || 0, Math.round(offset_y) || 0, id)

  return c.json({ ok: true })
})

// DELETE /:id — apaga o nó e todos os descendentes (cascade em árvore, feito em JS)
app.delete('/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const node = await db.prepare('SELECT * FROM org_chart_nodes WHERE id = ?').get(id)
  if (!node) return c.json({ error: 'Não encontrado' }, 404)

  const toDelete = [id]
  let frontier = [id]
  while (frontier.length > 0) {
    const placeholders = frontier.map(() => '?').join(',')
    const children = await db.prepare(`SELECT id FROM org_chart_nodes WHERE parent_id IN (${placeholders})`).all(...frontier)
    const childIds = children.map(c => c.id)
    if (childIds.length === 0) break
    toDelete.push(...childIds)
    frontier = childIds
  }

  await db.batch(toDelete.map(nodeId => ({ sql: 'DELETE FROM org_chart_nodes WHERE id = ?', args: [nodeId] })))
  // Uma vez deletados os nós, os links soltos (org_chart_links) que
  // apontavam pra eles ficam órfãos — limpa junto.
  if (toDelete.length > 0) {
    const placeholders = toDelete.map(() => '?').join(',')
    await db.prepare(`DELETE FROM org_chart_links WHERE from_node_id IN (${placeholders}) OR to_node_id IN (${placeholders})`)
      .run(...toDelete, ...toDelete)
  }
  return c.json({ ok: true, deleted: toDelete.length })
})

// ── Conexões livres (linha entre dois cargos sem relação de "reporta
// para") — pra agrupar visualmente cargos que se relacionam mas não têm
// hierarquia entre si (ex: Auxiliares e Estagiários no mesmo time).

// GET /links
app.get('/links', async c => {
  const db = c.get('db')
  const dept = departmentFilter(await accessOf(c), 'n.department_id')
  return c.json(await db.prepare(`
    SELECT l.* FROM org_chart_links l JOIN org_chart_nodes n ON n.id = l.from_node_id
    WHERE 1=1${dept.sql}
    ORDER BY l.created_at
  `).all(...dept.args))
})

// POST /links — { from_node_id, to_node_id }
app.post('/links', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { from_node_id, to_node_id } = await c.req.json()
  if (!from_node_id || !to_node_id) return c.json({ error: 'from_node_id e to_node_id são obrigatórios' }, 400)
  if (from_node_id === to_node_id) return c.json({ error: 'Não é possível ligar um cargo a ele mesmo' }, 400)

  const [from, to] = await Promise.all([
    db.prepare('SELECT id FROM org_chart_nodes WHERE id = ?').get(from_node_id),
    db.prepare('SELECT id FROM org_chart_nodes WHERE id = ?').get(to_node_id),
  ])
  if (!from || !to) return c.json({ error: 'Cargo não encontrado' }, 404)

  const existing = await db.prepare(`
    SELECT id FROM org_chart_links
    WHERE (from_node_id = ? AND to_node_id = ?) OR (from_node_id = ? AND to_node_id = ?)
  `).get(from_node_id, to_node_id, to_node_id, from_node_id)
  if (existing) return c.json({ error: 'Esses dois cargos já estão ligados' }, 400)

  const id = uuid()
  await db.prepare('INSERT INTO org_chart_links (id, from_node_id, to_node_id, created_by) VALUES (?, ?, ?, ?)')
    .run(id, from_node_id, to_node_id, user.id)

  return c.json(await db.prepare('SELECT * FROM org_chart_links WHERE id = ?').get(id))
})

// DELETE /links/:id
app.delete('/links/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  await db.prepare('DELETE FROM org_chart_links WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

// ── Linhas soltas (estilo Canva) — desenhadas livremente no canvas, sem
// estar presas a nenhum cargo. Coordenadas quaisquer, validadas só como
// números finitos.

// GET /free-lines
app.get('/free-lines', async c => {
  const db = c.get('db')
  const dept = departmentFilter(await accessOf(c), 'department_id')
  return c.json(await db.prepare(`SELECT * FROM org_chart_free_lines WHERE 1=1${dept.sql} ORDER BY created_at`).all(...dept.args))
})

// POST /free-lines — { x1, y1, x2, y2 }
app.post('/free-lines', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  const { x1, y1, x2, y2 } = await c.req.json()
  const coords = [x1, y1, x2, y2].map(Number)
  if (coords.some(n => !Number.isFinite(n))) return c.json({ error: 'Coordenadas inválidas' }, 400)

  const id = uuid()
  await db.prepare('INSERT INTO org_chart_free_lines (id, x1, y1, x2, y2, created_by, department_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, ...coords.map(Math.round), user.id, departmentForCreate(await accessOf(c), undefined))

  return c.json(await db.prepare('SELECT * FROM org_chart_free_lines WHERE id = ?').get(id))
})

// DELETE /free-lines/:id
app.delete('/free-lines/:id', async c => {
  const db = c.get('db')
  const user = c.get('user')
  if (!(await isSuperAdmin(db, user.id))) return c.json({ error: 'Acesso restrito ao Super Admin.' }, 403)

  await db.prepare('DELETE FROM org_chart_free_lines WHERE id = ?').run(c.req.param('id'))
  return c.json({ ok: true })
})

export default app

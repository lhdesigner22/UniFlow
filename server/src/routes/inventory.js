import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'

// Inventário (módulo `inventory`). O portão do worker.js barra quem não tem o
// módulo e quem só tem "ver" tentando escrever. Sem departamento: patrimônio da TI.
const app = new Hono()
app.use('*', auth)

export const INVENTORY_KINDS = ['brain']
const clean = (v, max) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : (typeof v === 'number' ? String(v) : '')
  return s ? s.slice(0, max) : null
}
const kindOf = c => {
  const k = c.req.param('kind')
  return INVENTORY_KINDS.includes(k) ? k : null
}
const badKind = c => c.json({ error: 'Controle de inventário desconhecido' }, 404)

function fields(body) {
  const holder_name = clean(body.holder_name, 120)
  if (!holder_name) return { error: 'Informe o responsável' }
  return { holder_name, sector: clean(body.sector, 80), asset_tag: clean(body.asset_tag, 40), notes: clean(body.notes, 300) }
}

// GET /:kind — itens do controle (ordem por nome)
app.get('/:kind', async c => {
  const kind = kindOf(c)
  if (!kind) return badKind(c)
  const items = await c.get('db').prepare(`
    SELECT i.id, i.holder_name, i.sector, i.asset_tag, i.notes, i.created_at, i.updated_at, u.name as updated_by_name
    FROM inventory_items i LEFT JOIN users u ON u.id = COALESCE(i.updated_by, i.created_by)
    WHERE i.kind = ? ORDER BY i.holder_name COLLATE NOCASE
  `).all(kind)
  return c.json({ kind, items })
})

// POST /:kind
app.post('/:kind', async c => {
  const kind = kindOf(c)
  if (!kind) return badKind(c)
  const v = fields(await c.req.json().catch(() => ({})))
  if (v.error) return c.json(v, 400)
  const id = uuid()
  const db = c.get('db')
  await db.prepare(`INSERT INTO inventory_items (id, kind, holder_name, sector, asset_tag, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, kind, v.holder_name, v.sector, v.asset_tag, v.notes, c.get('user').id)
  return c.json(await db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id))
})

// PUT /:kind/:id
app.put('/:kind/:id', async c => {
  const kind = kindOf(c)
  if (!kind) return badKind(c)
  const db = c.get('db')
  const row = await db.prepare('SELECT * FROM inventory_items WHERE id = ? AND kind = ?').get(c.req.param('id'), kind)
  if (!row) return c.json({ error: 'Item não encontrado' }, 404)
  const v = fields({ ...row, ...(await c.req.json().catch(() => ({}))) })
  if (v.error) return c.json(v, 400)
  await db.prepare(`UPDATE inventory_items SET holder_name = ?, sector = ?, asset_tag = ?, notes = ?, updated_by = ?, updated_at = datetime('now')
    WHERE id = ?`).run(v.holder_name, v.sector, v.asset_tag, v.notes, c.get('user').id, row.id)
  return c.json(await db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(row.id))
})

// DELETE /:kind/:id
app.delete('/:kind/:id', async c => {
  const kind = kindOf(c)
  if (!kind) return badKind(c)
  const db = c.get('db')
  const row = await db.prepare('SELECT id FROM inventory_items WHERE id = ? AND kind = ?').get(c.req.param('id'), kind)
  if (!row) return c.json({ error: 'Item não encontrado' }, 404)
  await db.prepare('DELETE FROM inventory_items WHERE id = ?').run(row.id)
  return c.json({ ok: true })
})

export default app

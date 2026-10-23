import { Hono } from 'hono'
import { v4 as uuid } from 'uuid'
import { auth } from '../middleware/auth.js'

// Impressoras → Estoque de insumos (toner, cilindro, tinta...). Saldo POR PRÉDIO
// (mesmos locais das impressoras) + histórico: entrada, troca na impressora,
// transferência entre prédios e ajuste de contagem. Módulo "printers" (o portão
// do worker.js já barra quem não vê / só vê): quem edita Impressoras movimenta e
// cadastra; apagar item do catálogo só o Super Admin. Estoque é da TI — não é
// separado por departamento.
//
// Desempenho (estudo de out/2026): dezenas de itens, ~50 movimentações/mês. O
// saldo fica em printer_supply_stock (não soma o histórico a cada leitura) e o
// histórico é lido por índice, com limite.
const app = new Hono()
app.use('*', auth)

export const LOCATIONS = ['sede', 'adm', 'centro', 'g5', 'clinicas']
export const TYPES = ['toner', 'cilindro', 'tinta', 'cartucho', 'fusor', 'residuo', 'kit', 'outro']
export const COLORS = ['', 'preto', 'ciano', 'magenta', 'amarelo', 'colorido']
const KINDS = ['entrada', 'troca', 'transferencia', 'ajuste']
const MAX_QTY = 10_000

const str = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null }
const int = v => (Number.isInteger(Number(v)) ? Number(v) : NaN)
// "Agora" no horário de Brasília, no formato do campo happened_at
const nowBrasilia = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 16).replace(' ', 'T')
const validWhen = v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '')

async function isSuperAdmin(c) {
  const u = await c.get('db').prepare('SELECT system_role FROM users WHERE id = ?').get(c.get('user').id)
  return u?.system_role === 'super_admin'
}

function cleanSupply(body, current = {}) {
  const pick = (k, fn) => (body[k] !== undefined ? fn(body[k]) : (current[k] ?? null))
  const out = {
    name: pick('name', v => str(v, 120)),
    code: pick('code', v => str(v, 60)),
    type: pick('type', v => String(v || '')),
    color: pick('color', v => String(v || '')) || '',
    notes: pick('notes', v => str(v, 1000)),
    models: body.models !== undefined
      ? JSON.stringify([...new Set((Array.isArray(body.models) ? body.models : []).map(m => str(m, 80)).filter(Boolean))].slice(0, 40))
      : (current.models || '[]'),
  }
  if (!out.name) return { error: 'Informe o nome do insumo' }
  if (!TYPES.includes(out.type)) return { error: 'Tipo inválido' }
  if (!COLORS.includes(out.color)) return { error: 'Cor inválida' }
  return out
}

// Mínimos por prédio: { sede: 2, adm: 1, ... } → só números inteiros ≥ 0
function cleanMinimums(raw) {
  const out = {}
  for (const loc of LOCATIONS) {
    if (raw?.[loc] === undefined || raw[loc] === '') continue
    const n = int(raw[loc])
    if (!(n >= 0 && n <= MAX_QTY)) return { error: `Mínimo inválido em ${loc.toUpperCase()}` }
    out[loc] = n
  }
  return out
}

const parseModels = s => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }

// Catálogo + saldo/mínimo por prédio + consumo (trocas) dos últimos 90 dias
async function listSupplies(db, { includeInactive = false } = {}) {
  const since = new Date(Date.now() - 90 * 86400000).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 10)
  const [supplies, stock, usage] = await Promise.all([
    db.prepare(`SELECT * FROM printer_supplies ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY type, name`).all(),
    db.prepare('SELECT supply_id, location, quantity, min_quantity FROM printer_supply_stock').all(),
    db.prepare("SELECT supply_id, location, -SUM(delta) AS used FROM printer_supply_movements WHERE kind = 'troca' AND happened_at >= ? GROUP BY supply_id, location").all(since),
  ])
  const byId = new Map(supplies.map(s => [s.id, { ...s, models: parseModels(s.models), stocks: {}, usage90: {} }]))
  for (const r of stock) {
    const s = byId.get(r.supply_id)
    if (s) s.stocks[r.location] = { quantity: r.quantity, min_quantity: r.min_quantity }
  }
  for (const r of usage) {
    const s = byId.get(r.supply_id)
    if (s) s.usage90[r.location] = r.used
  }
  for (const s of byId.values()) for (const loc of LOCATIONS) s.stocks[loc] ||= { quantity: 0, min_quantity: 0 }
  return [...byId.values()]
}

const one = async (db, id) => (await listSupplies(db, { includeInactive: true })).find(s => s.id === id)

// GET / — catálogo com saldo de todos os prédios (a tela filtra o prédio)
app.get('/', async c => c.json(await listSupplies(c.get('db'))))

// GET /low — quantos itens estão no mínimo ou abaixo, por prédio (número do menu)
app.get('/low', async c => {
  const rows = await c.get('db').prepare(`
    SELECT st.location, COUNT(*) AS n FROM printer_supply_stock st
    JOIN printer_supplies s ON s.id = st.supply_id AND s.active = 1
    WHERE st.min_quantity > 0 AND st.quantity <= st.min_quantity
    GROUP BY st.location
  `).all()
  return c.json(Object.fromEntries(rows.map(r => [r.location, r.n])))
})

// GET /export?format=json — saldo atual + histórico (pra planilha no navegador)
app.get('/export', async c => {
  const db = c.get('db')
  const movements = await db.prepare(`
    SELECT m.*, s.name AS supply_name, s.code AS supply_code, p.model AS printer_model, p.location AS printer_location, p.ip AS printer_ip, u.name AS user_name
    FROM printer_supply_movements m
    JOIN printer_supplies s ON s.id = m.supply_id
    LEFT JOIN printers p ON p.id = m.printer_id
    LEFT JOIN users u ON u.id = m.created_by
    ORDER BY m.happened_at DESC, m.created_at DESC LIMIT 5000
  `).all()
  return c.json({ supplies: await listSupplies(db, { includeInactive: true }), movements })
})

// GET /printer/:printerId — trocas feitas naquela impressora (histórico + intervalo médio)
app.get('/printer/:printerId', async c => {
  const rows = await c.get('db').prepare(`
    SELECT m.id, m.supply_id, m.delta, m.happened_at, m.note, s.name AS supply_name, s.type, s.color, u.name AS user_name
    FROM printer_supply_movements m
    JOIN printer_supplies s ON s.id = m.supply_id
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.printer_id = ? AND m.kind = 'troca'
    ORDER BY m.happened_at DESC LIMIT 200
  `).all(c.req.param('printerId'))
  return c.json(rows)
})

app.post('/', async c => {
  const db = c.get('db')
  const body = await c.req.json()
  const v = cleanSupply(body)
  if (v.error) return c.json(v, 400)
  const mins = cleanMinimums(body.minimums)
  if (mins.error) return c.json(mins, 400)
  const id = uuid()
  await db.batch([
    { sql: 'INSERT INTO printer_supplies (id, name, code, type, color, models, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [id, v.name, v.code, v.type, v.color, v.models, v.notes, c.get('user').id] },
    ...LOCATIONS.map(loc => ({ sql: 'INSERT INTO printer_supply_stock (supply_id, location, quantity, min_quantity) VALUES (?, ?, 0, ?)', args: [id, loc, mins[loc] ?? 0] })),
  ])
  return c.json(await one(db, id))
})

app.put('/:id', async c => {
  const db = c.get('db')
  const id = c.req.param('id')
  const row = await db.prepare('SELECT * FROM printer_supplies WHERE id = ?').get(id)
  if (!row) return c.json({ error: 'Insumo não encontrado' }, 404)
  const body = await c.req.json()
  const v = cleanSupply(body, row)
  if (v.error) return c.json(v, 400)
  const mins = cleanMinimums(body.minimums)
  if (mins.error) return c.json(mins, 400)
  await db.batch([
    { sql: "UPDATE printer_supplies SET name = ?, code = ?, type = ?, color = ?, models = ?, notes = ?, updated_at = datetime('now') WHERE id = ?", args: [v.name, v.code, v.type, v.color, v.models, v.notes, id] },
    ...Object.entries(mins).map(([loc, n]) => ({
      sql: `INSERT INTO printer_supply_stock (supply_id, location, quantity, min_quantity) VALUES (?, ?, 0, ?)
            ON CONFLICT(supply_id, location) DO UPDATE SET min_quantity = excluded.min_quantity, updated_at = datetime('now')`,
      args: [id, loc, n],
    })),
  ])
  return c.json(await one(db, id))
})

// DELETE /:id — Super Admin. Com histórico, só desativa (o histórico fica).
app.delete('/:id', async c => {
  if (!(await isSuperAdmin(c))) return c.json({ error: 'Só o Super Admin remove itens do catálogo.' }, 403)
  const db = c.get('db')
  const id = c.req.param('id')
  const used = await db.scalar('SELECT COUNT(*) FROM printer_supply_movements WHERE supply_id = ?', id)
  if (used > 0) {
    await db.prepare("UPDATE printer_supplies SET active = 0, updated_at = datetime('now') WHERE id = ?").run(id)
    return c.json({ ok: true, deactivated: true })
  }
  await db.batch([
    { sql: 'DELETE FROM printer_supply_stock WHERE supply_id = ?', args: [id] },
    { sql: 'DELETE FROM printer_supplies WHERE id = ?', args: [id] },
  ])
  return c.json({ ok: true })
})

// GET /:id/movements?location= — histórico do item (mais recente primeiro)
app.get('/:id/movements', async c => {
  const loc = c.req.query('location')
  const args = [c.req.param('id')]
  let where = 'm.supply_id = ?'
  if (LOCATIONS.includes(loc)) { where += ' AND m.location = ?'; args.push(loc) }
  return c.json(await c.get('db').prepare(`
    SELECT m.*, p.model AS printer_model, p.location AS printer_location, p.ip AS printer_ip, p.department AS printer_department, u.name AS user_name
    FROM printer_supply_movements m
    LEFT JOIN printers p ON p.id = m.printer_id
    LEFT JOIN users u ON u.id = m.created_by
    WHERE ${where}
    ORDER BY m.happened_at DESC, m.created_at DESC LIMIT 100
  `).all(...args))
})

// Movimento que muda o saldo de UM prédio: atualiza o saldo e grava o histórico
// na mesma transação. O UPDATE só acontece se o saldo ainda for o que lemos
// (`quantity = expected`) e o INSERT só se o UPDATE aconteceu (changes() = 1) —
// duas pessoas mexendo ao mesmo tempo não deixam o saldo errado.
// `requireId`: só aplica se aquele outro movimento já foi gravado nesta mesma
// transação (transferência: o destino só recebe se a origem saiu).
function moveStatements({ id, supplyId, location, kind, expected, delta, printerId, relatedLocation, when, note, userId, requireId }) {
  const guard = requireId ? ' AND EXISTS (SELECT 1 FROM printer_supply_movements WHERE id = ?)' : ''
  return [
    { sql: 'INSERT OR IGNORE INTO printer_supply_stock (supply_id, location, quantity, min_quantity) VALUES (?, ?, 0, 0)', args: [supplyId, location] },
    { sql: `UPDATE printer_supply_stock SET quantity = quantity + ?, updated_at = datetime('now') WHERE supply_id = ? AND location = ? AND quantity = ?${guard}`, args: [delta, supplyId, location, expected, ...(requireId ? [requireId] : [])] },
    {
      sql: `INSERT INTO printer_supply_movements (id, supply_id, location, kind, delta, balance_after, printer_id, related_location, happened_at, note, created_by)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
      args: [id, supplyId, location, kind, delta, expected + delta, printerId || null, relatedLocation || null, when, note, userId],
    },
  ]
}

// POST /:id/movements { kind, location, quantity, printer_id?, to_location?, happened_at?, note? }
//   entrada: +quantity · troca: −quantity numa impressora do mesmo prédio ·
//   transferencia: −quantity aqui e +quantity em to_location · ajuste: quantity = saldo contado
app.post('/:id/movements', async c => {
  const db = c.get('db')
  const supply = await db.prepare('SELECT * FROM printer_supplies WHERE id = ?').get(c.req.param('id'))
  if (!supply) return c.json({ error: 'Insumo não encontrado' }, 404)
  const body = await c.req.json()
  const { kind, location } = body
  if (!KINDS.includes(kind)) return c.json({ error: 'Tipo de movimento inválido' }, 400)
  if (!LOCATIONS.includes(location)) return c.json({ error: 'Prédio inválido' }, 400)
  const qty = int(body.quantity)
  if (!(qty >= (kind === 'ajuste' ? 0 : 1) && qty <= MAX_QTY)) return c.json({ error: 'Quantidade inválida' }, 400)
  const when = body.happened_at ? String(body.happened_at) : nowBrasilia()
  if (!validWhen(when)) return c.json({ error: 'Data/hora inválida' }, 400)
  const note = str(body.note, 500)
  const userId = c.get('user').id
  const current = (await db.prepare('SELECT quantity FROM printer_supply_stock WHERE supply_id = ? AND location = ?').get(supply.id, location))?.quantity ?? 0

  let statements = []
  const ids = []
  if (kind === 'entrada') {
    ids.push(uuid())
    statements = moveStatements({ id: ids[0], supplyId: supply.id, location, kind, expected: current, delta: qty, when, note, userId })
  } else if (kind === 'troca') {
    const printer = body.printer_id ? await db.prepare('SELECT id, location FROM printers WHERE id = ?').get(body.printer_id) : null
    if (!printer) return c.json({ error: 'Escolha a impressora em que o insumo foi trocado' }, 400)
    if (printer.location !== location) return c.json({ error: 'A impressora é de outro prédio — tire o insumo do estoque daquele prédio.' }, 400)
    if (qty > current) return c.json({ error: `Saldo insuficiente em ${location.toUpperCase()} (tem ${current}).` }, 400)
    ids.push(uuid())
    statements = moveStatements({ id: ids[0], supplyId: supply.id, location, kind, expected: current, delta: -qty, printerId: printer.id, when, note, userId })
  } else if (kind === 'transferencia') {
    const to = body.to_location
    if (!LOCATIONS.includes(to) || to === location) return c.json({ error: 'Escolha o prédio de destino' }, 400)
    if (qty > current) return c.json({ error: `Saldo insuficiente em ${location.toUpperCase()} (tem ${current}).` }, 400)
    const toCurrent = (await db.prepare('SELECT quantity FROM printer_supply_stock WHERE supply_id = ? AND location = ?').get(supply.id, to))?.quantity ?? 0
    ids.push(uuid(), uuid())
    statements = [
      ...moveStatements({ id: ids[0], supplyId: supply.id, location, kind: 'transferencia_saida', expected: current, delta: -qty, relatedLocation: to, when, note, userId }),
      ...moveStatements({ id: ids[1], supplyId: supply.id, location: to, kind: 'transferencia_entrada', expected: toCurrent, delta: qty, relatedLocation: location, when, note, userId, requireId: ids[0] }),
    ]
  } else {
    const delta = qty - current
    if (delta === 0) return c.json({ error: 'O saldo já é esse — nada a ajustar.' }, 400)
    ids.push(uuid())
    statements = moveStatements({ id: ids[0], supplyId: supply.id, location, kind, expected: current, delta, when, note, userId })
  }

  await db.batch(statements)
  const saved = await db.prepare(`SELECT COUNT(*) AS n FROM printer_supply_movements WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids)
  if ((saved?.n || 0) !== ids.length) return c.json({ error: 'O saldo mudou enquanto você registrava — confira e tente de novo.' }, 409)
  return c.json(await one(db, supply.id))
})

export default app

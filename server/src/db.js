import { createClient } from '@libsql/client'
import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'

// Determina URL do banco:
// 1. Turso cloud (produção sem disco persistente)
// 2. DB_PATH env var (Render com disco persistente)
// 3. Arquivo local (desenvolvimento)
function buildDbUrl() {
  if (process.env.TURSO_DATABASE_URL) return null // usa Turso
  const path = process.env.DB_PATH
  if (!path) return 'file:./uniflow.db'
  // Caminho absoluto (ex: /data/uniflow.db no Render)
  return path.startsWith('/') ? `file://${path}` : `file:./${path}`
}

const fileUrl = buildDbUrl()
const client = createClient(
  fileUrl
    ? { url: fileUrl }
    : { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
)

console.log('🗄️  DB mode:', fileUrl ? `file (${fileUrl})` : 'Turso cloud')

// Converte Row do libsql para objeto simples usando r.columns para nomes corretos
// IMPORTANTE: Object.entries(row) retorna índices numéricos, não nomes de coluna
function rowToObj(row, columns) {
  if (!row) return undefined
  const obj = {}
  columns.forEach((col, i) => { obj[col] = row[i] })
  return obj
}

function prepare(sql) {
  return {
    async get(...args) {
      const r = await client.execute({ sql, args: args.flat() })
      return r.rows.length ? rowToObj(r.rows[0], r.columns) : undefined
    },
    async all(...args) {
      const r = await client.execute({ sql, args: args.flat() })
      return r.rows.map(row => rowToObj(row, r.columns))
    },
    async run(...args) {
      await client.execute({ sql, args: args.flat() })
      return {}
    }
  }
}

async function exec(sql) {
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
    await client.execute(stmt)
  }
}

async function scalar(sql, ...args) {
  const r = await client.execute({ sql, args: args.flat() })
  if (!r.rows.length) return undefined
  return r.rows[0][0] // primeiro valor por índice (seguro independente do cliente)
}

// batch helper for transactions
async function batch(statements) {
  await client.batch(statements, 'write')
}

const db = { prepare, exec, scalar, batch }

// ─── Schema ────────────────────────────────────────────────────────────────
await exec(`
  PRAGMA foreign_keys = ON
`)

await exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS pipes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT '📋',
    color TEXT DEFAULT '#4a7cf7',
    owner_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS pipe_members (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pipe_id, user_id)
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS phases (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4a7cf7',
    order_index INTEGER DEFAULT 0,
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS pipe_fields (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    required INTEGER DEFAULT 0,
    options TEXT,
    order_index INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    phase_id TEXT NOT NULL,
    title TEXT NOT NULL,
    assignee_id TEXT,
    due_date TEXT,
    priority TEXT DEFAULT 'medium',
    labels TEXT DEFAULT '[]',
    order_index INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS card_fields (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    value TEXT,
    UNIQUE(card_id, field_id)
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS card_comments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS card_attachments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER,
    mime_type TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS card_checklist (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    title TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    order_index INTEGER DEFAULT 0
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS card_activities (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS pipe_labels (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4a7cf7'
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger_config TEXT DEFAULT '{}',
    action_type TEXT NOT NULL,
    action_config TEXT DEFAULT '{}',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    public_token TEXT UNIQUE NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

await exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    read INTEGER DEFAULT 0,
    link TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

// ─── Migrations ───────────────────────────────────────────────────────────
try { await client.execute('ALTER TABLE users ADD COLUMN google_id TEXT') } catch {}
try { await client.execute('ALTER TABLE users ADD COLUMN avatar TEXT') } catch {}
try { await client.execute('ALTER TABLE users ADD COLUMN system_role TEXT DEFAULT "user"') } catch {}
try { await client.execute('ALTER TABLE users ADD COLUMN department_id TEXT') } catch {}

try {
  await client.execute(`CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#4a7cf7',
    created_at TEXT DEFAULT (datetime('now'))
  )`)
} catch {}

// Regras de encaminhamento GLOBAIS por usuário
try {
  await client.execute(`CREATE TABLE IF NOT EXISTS user_routing_rules (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    UNIQUE(from_user_id, to_user_id)
  )`)
} catch {}

// Regras de encaminhamento: destinos individuais por pipe (legado)
try {
  await client.execute(`CREATE TABLE IF NOT EXISTS pipe_routing_rules (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    UNIQUE(pipe_id, from_user_id, to_user_id)
  )`)
} catch {}

// Regras de encaminhamento: destinos por grupo
try {
  await client.execute(`CREATE TABLE IF NOT EXISTS pipe_routing_groups (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    group_type TEXT NOT NULL,
    group_value TEXT NOT NULL,
    UNIQUE(pipe_id, from_user_id, group_type, group_value)
  )`)
} catch {}

// Grupos personalizados dentro do pipe
try {
  await client.execute(`CREATE TABLE IF NOT EXISTS pipe_custom_groups (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4a7cf7',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pipe_id, name)
  )`)
} catch {}

try {
  await client.execute(`CREATE TABLE IF NOT EXISTS pipe_custom_group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    UNIQUE(group_id, user_id)
  )`)
} catch {}

// Primeiro usuário do sistema vira super_admin automaticamente
try {
  await client.execute(`UPDATE users SET system_role = 'super_admin'
    WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1)
      AND (system_role IS NULL OR system_role = 'user')`)
} catch {}

// Promove donos e SUPER_ADMIN_EMAILS para super_admin na inicialização
try {
  const ownerEmails = ['luiz.sanchez@colegioser.com']
  const envEmails = (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  const allSuper = [...new Set([...ownerEmails.map(e => e.toLowerCase()), ...envEmails])]
  for (const email of allSuper) {
    await client.execute({
      sql: "UPDATE users SET system_role = 'super_admin' WHERE LOWER(email) = ?",
      args: [email]
    })
  }
  console.log('Super admins garantidos:', allSuper.join(', '))
} catch (e) {
  console.warn('Erro ao aplicar super admins:', e.message)
}

// ─── Seed demo data ────────────────────────────────────────────────────────
const existingUser = await db.prepare('SELECT id FROM users LIMIT 1').get()
if (!existingUser) {
  const hash = bcrypt.hashSync('admin123', 10)
  const userId = uuid()
  await db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(userId, 'Admin UniFlow', 'admin@uniflow.app', hash)

  const pipeId = uuid()
  await db.prepare('INSERT INTO pipes (id, name, description, icon, color, owner_id) VALUES (?, ?, ?, ?, ?, ?)').run(pipeId, 'Aprovação de Compras', 'Fluxo padrão de aprovação de compras', '🛒', '#4a7cf7', userId)
  await db.prepare('INSERT INTO pipe_members (id, pipe_id, user_id, role) VALUES (?, ?, ?, ?)').run(uuid(), pipeId, userId, 'admin')

  const phases = [
    { name: 'Solicitado', color: '#7a8faa', done: 0 },
    { name: 'Em Análise', color: '#f59e0b', done: 0 },
    { name: 'Aprovado', color: '#22c55e', done: 1 },
    { name: 'Recusado', color: '#ef4444', done: 1 },
  ]
  const phaseIds = []
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]
    const pid = uuid()
    await db.prepare('INSERT INTO phases (id, pipe_id, name, color, order_index, done) VALUES (?, ?, ?, ?, ?, ?)').run(pid, pipeId, p.name, p.color, i, p.done)
    phaseIds.push(pid)
  }

  const fields = [
    { name: 'Fornecedor', type: 'text' },
    { name: 'Valor (R$)', type: 'number' },
    { name: 'Justificativa', type: 'textarea' },
    { name: 'Categoria', type: 'select', options: '["TI","RH","Marketing","Operações","Outros"]' },
    { name: 'Urgente', type: 'checkbox' },
  ]
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    await db.prepare('INSERT INTO pipe_fields (id, pipe_id, name, type, options, order_index) VALUES (?, ?, ?, ?, ?, ?)').run(uuid(), pipeId, f.name, f.type, f.options || null, i)
  }

  const sampleCards = [
    { title: 'Notebook Dell XPS - R$ 8.500', phase: 0, priority: 'high' },
    { title: 'Licença Adobe CC - R$ 4.200/ano', phase: 0, priority: 'medium' },
    { title: 'Cadeiras ergonômicas (10 un)', phase: 1, priority: 'low' },
    { title: 'Servidor AWS EC2 upgrade', phase: 1, priority: 'high' },
    { title: 'Material de escritório Q1', phase: 2, priority: 'low' },
    { title: 'Treinamento equipe vendas', phase: 2, priority: 'medium' },
  ]
  for (let i = 0; i < sampleCards.length; i++) {
    const c = sampleCards[i]
    const cid = uuid()
    await db.prepare('INSERT INTO cards (id, pipe_id, phase_id, title, priority, order_index, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(cid, pipeId, phaseIds[c.phase], c.title, c.priority, i, userId)
    await db.prepare('INSERT INTO card_activities (id, card_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)').run(uuid(), cid, userId, 'created', 'Card criado')
  }

  const labels = [
    { name: 'Urgente', color: '#ef4444' },
    { name: 'TI', color: '#4a7cf7' },
    { name: 'RH', color: '#8b5cf6' },
    { name: 'Financeiro', color: '#f59e0b' },
  ]
  for (const l of labels) {
    await db.prepare('INSERT INTO pipe_labels (id, pipe_id, name, color) VALUES (?, ?, ?, ?)').run(uuid(), pipeId, l.name, l.color)
  }

  await db.prepare('INSERT INTO forms (id, pipe_id, name, description, public_token) VALUES (?, ?, ?, ?, ?)').run(uuid(), pipeId, 'Formulário de Solicitação', 'Solicite uma aprovação de compra', 'demo-form-token-2026')

  console.log('Demo data seeded — email: admin@uniflow.app / senha: admin123')
}

export default db

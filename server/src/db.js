import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import bcrypt from 'bcryptjs'
import { v4 as uuid } from 'uuid'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = process.env.DB_PATH || join(__dirname, '../../uniflow.db')
const wasmPath = join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm')

console.log('🔧 DB path:', dbPath)
console.log('🔧 WASM path:', wasmPath)
console.log('🔧 WASM exists:', existsSync(wasmPath))

// Garante que o diretório do banco existe, com fallback automático
let actualDbPath = dbPath
try {
  mkdirSync(dirname(dbPath), { recursive: true })
  console.log('✅ DB directory ready:', dirname(dbPath))
} catch (e) {
  console.warn(`⚠️  Cannot access ${dbPath} — falling back to local path`)
  actualDbPath = join(__dirname, '../../uniflow.db')
  mkdirSync(dirname(actualDbPath), { recursive: true })
  console.log('✅ DB directory ready (fallback):', dirname(actualDbPath))
}

let SQL
try {
  SQL = await initSqlJs({ locateFile: () => wasmPath })
  console.log('✅ sql.js loaded')
} catch (e) {
  console.error('❌ Failed to load sql.js:', e.message)
  process.exit(1)
}

let sqlDb
if (existsSync(actualDbPath)) {
  sqlDb = new SQL.Database(readFileSync(actualDbPath))
  console.log('✅ Loaded existing database from', actualDbPath)
} else {
  sqlDb = new SQL.Database()
  console.log('✅ Created new database at', actualDbPath)
}

// ─── Persistence (debounced) ───────────────────────────────────────────────
let saveTimer = null
let inTransaction = false

function scheduleSave() {
  if (inTransaction) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    writeFileSync(actualDbPath, Buffer.from(sqlDb.export()))
  }, 80)
}

function flushSave() {
  clearTimeout(saveTimer)
  writeFileSync(actualDbPath, Buffer.from(sqlDb.export()))
}

// ─── better-sqlite3 compatible API ────────────────────────────────────────
// sql.js: getAsObject(params) does bind+step+read in one call.
// getAsObject() with no args just steps+reads.
// "no row" returns {col: undefined, ...}; valid NULL rows have {col: null, ...}.
function hasRow(row) {
  const vals = Object.values(row)
  return vals.length > 0 && vals.some(v => v !== undefined)
}

function prepare(sql) {
  return {
    get(...args) {
      const stmt = sqlDb.prepare(sql)
      try {
        const flat = args.flat()
        if (flat.length) stmt.bind(flat)
        if (!stmt.step()) return undefined
        return stmt.getAsObject()
      } finally { stmt.free() }
    },
    all(...args) {
      const stmt = sqlDb.prepare(sql)
      const rows = []
      try {
        const flat = args.flat()
        if (flat.length) stmt.bind(flat)
        while (stmt.step()) {
          rows.push(stmt.getAsObject())
        }
      } finally { stmt.free() }
      return rows
    },
    run(...args) {
      sqlDb.run(sql, args.flat())
      scheduleSave()
      return {}
    }
  }
}

function exec(sql) {
  sqlDb.exec(sql)
  scheduleSave()
}

function transaction(fn) {
  return (...args) => {
    sqlDb.run('BEGIN')
    inTransaction = true
    try {
      fn(...args)
      sqlDb.run('COMMIT')
    } catch (e) {
      sqlDb.run('ROLLBACK')
      throw e
    } finally {
      inTransaction = false
      flushSave()
    }
  }
}

// Helper: returns first value of first row (for COUNT/MAX/MIN queries)
function scalar(sql, ...args) {
  const row = prepare(sql).get(...args)
  if (!row) return undefined
  return Object.values(row)[0]
}

const db = { prepare, exec, transaction, scalar }

// ─── Schema ────────────────────────────────────────────────────────────────
sqlDb.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pipes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT DEFAULT '📋',
    color TEXT DEFAULT '#4a7cf7',
    owner_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pipe_members (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pipe_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS phases (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4a7cf7',
    order_index INTEGER DEFAULT 0,
    done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pipe_fields (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    required INTEGER DEFAULT 0,
    options TEXT,
    order_index INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

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
  );

  CREATE TABLE IF NOT EXISTS card_fields (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    value TEXT,
    UNIQUE(card_id, field_id)
  );

  CREATE TABLE IF NOT EXISTS card_comments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS card_attachments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    size INTEGER,
    mime_type TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS card_checklist (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    title TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    order_index INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS card_activities (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pipe_labels (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4a7cf7'
  );

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
  );

  CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    public_token TEXT UNIQUE NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    read INTEGER DEFAULT 0,
    link TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`)

// ─── Migrations ───────────────────────────────────────────────────────────
try { sqlDb.run('ALTER TABLE users ADD COLUMN google_id TEXT') } catch {}
try { sqlDb.run('ALTER TABLE users ADD COLUMN avatar TEXT') } catch {}
try { sqlDb.run('ALTER TABLE users ADD COLUMN system_role TEXT DEFAULT "user"') } catch {}
try { sqlDb.run('ALTER TABLE users ADD COLUMN department_id TEXT') } catch {}

try {
  sqlDb.run(`CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#4a7cf7',
    created_at TEXT DEFAULT (datetime('now'))
  )`)
} catch {}

// Regras de encaminhamento GLOBAIS por usuário
// O admin configura: "usuário X pode encaminhar somente para estes usuários"
// Aplica-se em qualquer pipe. Sem regra = sem restrição.
try {
  sqlDb.run(`CREATE TABLE IF NOT EXISTS user_routing_rules (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    UNIQUE(from_user_id, to_user_id)
  )`)
} catch {}

// Regras de encaminhamento: destinos individuais por pipe (legado)
try {
  sqlDb.run(`CREATE TABLE IF NOT EXISTS pipe_routing_rules (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    UNIQUE(pipe_id, from_user_id, to_user_id)
  )`)
} catch {}

// Regras de encaminhamento: destinos por grupo
// group_type = 'pipe_role'  → group_value = 'admin' | 'member'
// group_type = 'department' → group_value = department_id
// group_type = 'custom'     → group_value = pipe_custom_group.id
try {
  sqlDb.run(`CREATE TABLE IF NOT EXISTS pipe_routing_groups (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    group_type TEXT NOT NULL,
    group_value TEXT NOT NULL,
    UNIQUE(pipe_id, from_user_id, group_type, group_value)
  )`)
} catch {}

// Grupos personalizados dentro do pipe (ex.: "Diretores", "Aprovadores TI")
try {
  sqlDb.run(`CREATE TABLE IF NOT EXISTS pipe_custom_groups (
    id TEXT PRIMARY KEY,
    pipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4a7cf7',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(pipe_id, name)
  )`)
} catch {}

try {
  sqlDb.run(`CREATE TABLE IF NOT EXISTS pipe_custom_group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    UNIQUE(group_id, user_id)
  )`)
} catch {}

// Primeiro usuário do sistema vira super_admin automaticamente
try {
  sqlDb.run(`UPDATE users SET system_role = 'super_admin'
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
    sqlDb.run("UPDATE users SET system_role = 'super_admin' WHERE LOWER(email) = ?", [email])
  }
  console.log('✅ Super admins garantidos:', allSuper.join(', '))
} catch (e) {
  console.warn('⚠️ Erro ao aplicar super admins:', e.message)
}

// ─── Seed demo data ────────────────────────────────────────────────────────
const existingUser = db.prepare('SELECT id FROM users LIMIT 1').get()
if (!existingUser) {
  const hash = bcrypt.hashSync('admin123', 10)
  const userId = uuid()
  db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)').run(userId, 'Admin UniFlow', 'admin@uniflow.app', hash)

  const pipeId = uuid()
  db.prepare('INSERT INTO pipes (id, name, description, icon, color, owner_id) VALUES (?, ?, ?, ?, ?, ?)').run(pipeId, 'Aprovação de Compras', 'Fluxo padrão de aprovação de compras', '🛒', '#4a7cf7', userId)
  db.prepare('INSERT INTO pipe_members (id, pipe_id, user_id, role) VALUES (?, ?, ?, ?)').run(uuid(), pipeId, userId, 'admin')

  const phases = [
    { name: 'Solicitado', color: '#7a8faa', done: 0 },
    { name: 'Em Análise', color: '#f59e0b', done: 0 },
    { name: 'Aprovado', color: '#22c55e', done: 1 },
    { name: 'Recusado', color: '#ef4444', done: 1 },
  ]
  const phaseIds = phases.map(p => {
    const pid = uuid()
    db.prepare('INSERT INTO phases (id, pipe_id, name, color, order_index, done) VALUES (?, ?, ?, ?, ?, ?)').run(pid, pipeId, p.name, p.color, phases.indexOf(p), p.done)
    return pid
  })

  const fields = [
    { name: 'Fornecedor', type: 'text' },
    { name: 'Valor (R$)', type: 'number' },
    { name: 'Justificativa', type: 'textarea' },
    { name: 'Categoria', type: 'select', options: '["TI","RH","Marketing","Operações","Outros"]' },
    { name: 'Urgente', type: 'checkbox' },
  ]
  fields.forEach((f, i) => {
    db.prepare('INSERT INTO pipe_fields (id, pipe_id, name, type, options, order_index) VALUES (?, ?, ?, ?, ?, ?)').run(uuid(), pipeId, f.name, f.type, f.options || null, i)
  })

  const sampleCards = [
    { title: 'Notebook Dell XPS - R$ 8.500', phase: 0, priority: 'high' },
    { title: 'Licença Adobe CC - R$ 4.200/ano', phase: 0, priority: 'medium' },
    { title: 'Cadeiras ergonômicas (10 un)', phase: 1, priority: 'low' },
    { title: 'Servidor AWS EC2 upgrade', phase: 1, priority: 'high' },
    { title: 'Material de escritório Q1', phase: 2, priority: 'low' },
    { title: 'Treinamento equipe vendas', phase: 2, priority: 'medium' },
  ]
  sampleCards.forEach((c, i) => {
    const cid = uuid()
    db.prepare('INSERT INTO cards (id, pipe_id, phase_id, title, priority, order_index, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(cid, pipeId, phaseIds[c.phase], c.title, c.priority, i, userId)
    db.prepare('INSERT INTO card_activities (id, card_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)').run(uuid(), cid, userId, 'created', 'Card criado')
  })

  const labels = [
    { name: 'Urgente', color: '#ef4444' },
    { name: 'TI', color: '#4a7cf7' },
    { name: 'RH', color: '#8b5cf6' },
    { name: 'Financeiro', color: '#f59e0b' },
  ]
  labels.forEach(l => db.prepare('INSERT INTO pipe_labels (id, pipe_id, name, color) VALUES (?, ?, ?, ?)').run(uuid(), pipeId, l.name, l.color))

  db.prepare('INSERT INTO forms (id, pipe_id, name, description, public_token) VALUES (?, ?, ?, ?, ?)').run(uuid(), pipeId, 'Formulário de Solicitação', 'Solicite uma aprovação de compra', 'demo-form-token-2026')

  flushSave()
  console.log('✅ Demo data seeded — email: admin@uniflow.app / senha: admin123')
}

export default db

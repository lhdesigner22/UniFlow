// Entidades do GLPI por departamento. Cada departamento aponta pra uma entidade
// (departments.glpi_entity_name) e o Backlog/Total de Chamados mostram, pra cada
// pessoa, os chamados da entidade do departamento dela. O cron baixa os chamados
// do GLPI UMA vez (todas as entidades que o token enxerga) e gera um resumo por
// entidade configurada, guardado com id `entity:<nome>`.
//
// Casamento: o campo "Entidade" de cada chamado vem como caminho ("Entidade raiz
// > SERVICE DESK > Suporte"). Um nome configurado casa se for igual ao caminho,
// se o caminho começar por ele (sub-entidades entram junto), ou — pra nomes
// curtos como "SERVICE DESK" — se algum trecho do caminho for igual a ele.
export const DEFAULT_ENTITY = 'SERVICE DESK' // o que era fixo antes dos departamentos terem entidade

export const entityKey = name => `entity:${name}`

const norm = t => String(t || '').trim().toLowerCase()

export function matchesEntity(path, name) {
  const p = norm(path), n = norm(name)
  if (!p || !n) return false
  if (p === n || p.startsWith(`${n} >`)) return true
  if (n.includes('>')) return false
  return p.split('>').some(seg => seg.trim() === n)
}

// Entidades que devem ter resumo: as de todos os departamentos. Sem nenhuma
// configurada, mantém o comportamento antigo (SERVICE DESK).
export async function configuredEntities(db) {
  const rows = await db.prepare(
    "SELECT DISTINCT glpi_entity_name AS name FROM departments WHERE glpi_entity_name IS NOT NULL AND TRIM(glpi_entity_name) != ''"
  ).all()
  const names = rows.map(r => r.name.trim())
  return names.length ? names : [DEFAULT_ENTITY]
}

// Caminhos de entidade distintos vistos nos chamados — alimenta a lista de
// escolha no Admin (a pessoa escolhe em vez de digitar).
export function distinctEntityPaths(tickets) {
  return [...new Set(tickets.map(t => String(t.entity || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export async function saveSeenEntities(db, paths) {
  await db.prepare(
    "INSERT INTO app_settings (key, value) VALUES ('glpi_entities_seen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(JSON.stringify(paths))
}

export async function loadSeenEntities(db) {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'glpi_entities_seen'").get()
  try { return JSON.parse(row?.value || '[]') } catch { return [] }
}

// Qual entidade mostrar a esta requisição.
//   - quem enxerga todos os departamentos escolhe (?entity=); sem escolha, a do
//     departamento que está "vendo" ou a primeira configurada;
//   - os demais veem SÓ a do próprio departamento (sem entidade → nada).
// Devolve { entity, entities, noEntity } — `entities` é a lista que a pessoa pode escolher.
export async function resolveRequestEntity(db, access, requested) {
  const configured = await configuredEntities(db)
  if (access.scope === 'all') {
    if (requested && configured.includes(requested)) return { entity: requested, entities: configured }
    const v = access.viewDept
    if (v && v !== 'all' && v !== 'geral') {
      const row = await db.prepare('SELECT glpi_entity_name FROM departments WHERE id = ?').get(v)
      const name = row?.glpi_entity_name?.trim()
      return name ? { entity: name, entities: configured } : { entity: null, noEntity: true, entities: configured }
    }
    return { entity: configured[0], entities: configured }
  }
  const row = access.departmentId ? await db.prepare('SELECT glpi_entity_name FROM departments WHERE id = ?').get(access.departmentId) : null
  const name = row?.glpi_entity_name?.trim()
  return name ? { entity: name, entities: [name] } : { entity: null, noEntity: true, entities: [] }
}

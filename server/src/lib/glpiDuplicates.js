// Detecção de chamados duplicados do GLPI que viraram eventos repetidos na
// Agenda. Funções puras (sem banco/rede) pra poder ser testadas com dados reais.
//
// Duplicata = mesmo título (normalizado) + mesma data + HORÁRIOS QUE SE
// SOBREPÕEM. A SALA NÃO entra na comparação (decisão do time): um feriado chega
// como um chamado POR SALA ("Ano Novo - Feriado" × 201), e na Agenda isso tem
// que ser um evento só. Os horários só precisam se sobrepor, não ser iguais:
// o mesmo feriado chega em duas levas (06:00–23:15 e 07:00–22:40), enquanto
// "Aula Magna 08:00–12:00" e "Aula Magna 19:00–22:00" são eventos diferentes.
// As salas dos repetidos são somadas na descrição do evento que fica (ver
// mergeRooms). Fica o chamado mais antigo (menor número).
const normText = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim()
const stripAccents = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '')

// O mesmo evento chega com títulos levemente diferentes: o chamado "Nova
// Reserva - X" é cópia do original "X"; às vezes vem um sufixo entre
// parênteses "(PRÉ RESERVA - ...)" ou "(FERIADO)", ou " - Feriado", ou
// "FERIADO - " na frente. Compara sem acento e sem esses enfeites.
export const normTitle = t => stripAccents(normText(t))
  .replace(/^nova reserva\s*[-–]\s*/, '')
  .replace(/^feriado\s*[-–]\s*/, '')   // "FERIADO - Tiradentes" = "Tiradentes - Feriado"
  .replace(/\s*\([^)]*\)\s*$/, '')
  .replace(/\s*[-–]\s*feriado$/, '')
  .trim()

// Nome curto da sala: o local chega escrito de jeitos diferentes ("01 - SEDE -
// AUDITÓRIO 1" e "00 - Prédio Principal - 01 - SEDE - AUDITÓRIO 1") — usa só a
// última parte.
const shortRoom = raw => String(raw || '').split(/\s+[-–]\s+/).pop().trim()

// Salas citadas na descrição de um evento ("Sala: X" ou "Salas (3): X | Y | Z").
export function roomsOf(description) {
  const raw = String(description || '').match(/Salas?(?:\s*\(\d+\))?:\s*([^·]+)/)?.[1]
  if (!raw) return []
  return raw.split('|').map(shortRoom).filter(Boolean)
}

const toMinutes = (date, time) => {
  const [y, m, d] = String(date).split('-').map(Number)
  const [hh, mm] = String(time || '00:00').split(':').map(Number)
  return Date.UTC(y, m - 1, d, hh || 0, mm || 0) / 60000
}

// Intervalo do evento em minutos: [início, fim]. O fim vem de "Término: HH:MM -
// AAAA-MM-DD" guardado na descrição (pode ser em outro dia); sem término, é só
// o instante de início; sem hora nenhuma, vale o dia inteiro.
export function eventRange(ev) {
  const start = toMinutes(ev.event_date, ev.event_time)
  const m = String(ev.description || '').match(/Término:\s*(\d{1,2}:\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/)
  let end = m ? toMinutes(m[2], m[1]) : (ev.event_time ? start : toMinutes(ev.event_date, '23:59'))
  if (end < start) end = start
  return [start, end]
}

const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1]

// Índice de eventos já conhecidos: agrupa por título+data e, dentro disso, em
// "grupos" de horários que se sobrepõem. `add(ev)` coloca o evento no índice e
// diz se ele é REPETIÇÃO de um que já estava lá. Adicione em ordem crescente de
// número de chamado, pra o primeiro de cada grupo (o que fica) ser o mais antigo.
//   → { duplicate: boolean, keeper: { ticketId, description, changed } }
export function createDupIndex() {
  const buckets = new Map() // `${título}|${data}` → [{ range, keeper }]
  return {
    add(ev) {
      const key = `${normTitle(ev.title)}|${ev.event_date}`
      const range = eventRange(ev)
      if (!buckets.has(key)) buckets.set(key, [])
      const groups = buckets.get(key)
      const group = groups.find(g => overlaps(g.range, range))
      if (group) {
        group.range = [Math.min(group.range[0], range[0]), Math.max(group.range[1], range[1])]
        return { duplicate: true, keeper: group.keeper }
      }
      const keeper = { ticketId: Number(ev.glpi_ticket_id), description: ev.description, changed: false }
      groups.push({ range, keeper })
      return { duplicate: false, keeper }
    },
  }
}

// Soma `extraRooms` às salas já citadas na descrição do evento que fica, sem
// repetir. Descrição vira "Salas (N): A | B | C · Término: ... · Importado ...".
// Guarda a lista COMPLETA (a descrição só aparece no formulário de edição do
// evento; truncar perderia salas e erraria a contagem nas próximas somas).
export function mergeRooms(description, extraRooms) {
  const current = roomsOf(description)
  const seen = new Set(current.map(r => normText(stripAccents(r))))
  const all = [...current]
  for (const r of extraRooms.map(shortRoom).filter(Boolean)) {
    const k = normText(stripAccents(r))
    if (!seen.has(k)) { seen.add(k); all.push(r) }
  }
  if (all.length === current.length) return description // nada novo

  const label = `Salas (${all.length}): ${all.join(' | ')}`
  const parts = String(description || '').split(' · ')
  const idx = parts.findIndex(p => /^Salas?:|^Salas \(\d+\):/.test(p))
  if (idx >= 0) parts[idx] = label
  else parts.unshift(label)
  return parts.join(' · ')
}

// `rows`: eventos do GLPI ({ glpi_ticket_id, title, description, event_date,
// event_time, glpi_resolve_state }). Devolve, por grupo repetido,
//   { keep, duplicates, handled }
// - keep: o chamado que fica na Agenda (menor número)
// - duplicates: repetidos AINDA NÃO tratados no GLPI (glpi_resolve_state nulo)
//   → precisam ser solucionados no GLPI e sair da Agenda
// - handled: repetidos que o GLPI já tratou (solucionado/pulado/inexistente)
//   → só precisam sair da Agenda
export function groupDuplicates(rows) {
  const sorted = [...rows].sort((a, b) => a.glpi_ticket_id - b.glpi_ticket_id)
  const index = createDupIndex()
  const groups = new Map() // keeper (objeto) → { keep, others: [] }
  for (const ev of sorted) {
    const { duplicate, keeper } = index.add(ev)
    if (!duplicate) groups.set(keeper, { keep: ev, others: [] })
    else groups.get(keeper).others.push(ev)
  }
  const out = []
  for (const { keep, others } of groups.values()) {
    if (!others.length) continue
    out.push({
      keep,
      duplicates: others.filter(ev => ev.glpi_resolve_state == null),
      handled: others.filter(ev => ev.glpi_resolve_state != null),
    })
  }
  return out.sort((a, b) => (a.keep.event_date < b.keep.event_date ? 1 : -1))
}

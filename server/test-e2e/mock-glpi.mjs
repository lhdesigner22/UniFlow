// GLPI de mentira (só pra teste local): initSession/killSession/search/Ticket/ITILSolution.
import http from 'node:http'

const tickets = new Map()
let nextId = 20000
const stats = { gets: 0, searches: 0, solutions: [] }

const MONTHS = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
function reservation({ name, room, date = '2027-01-01', start = '06:00', end = '22:00' }) {
  // Formato A do parser: "Nome da reserva / Sala / Início / Término" (data por extenso)
  const [y, m, d] = date.split('-')
  const ext = `sexta, ${parseInt(d)} de ${MONTHS[parseInt(m) - 1]} de ${y}`
  return `Nome da reserva: ${name}\nSala: ${room}\nInício: ${start} - ${ext}\nTérmino: ${end} - ${ext}`
}
const SD = 'Entidade raiz > SERVICE DESK'
function add(name, content, { status = 17, entity = SD, created = '2026-10-15 09:00:00', category = null, priority = 3 } = {}) {
  const id = nextId++
  tickets.set(id, { id, name, content, status, entity, priority, category, date: created, date_mod: created })
  return id
}

function seed() {
  tickets.clear(); nextId = 20000; stats.gets = 0; stats.searches = 0; stats.solutions = []
  // 60 chamados do MESMO feriado, um por sala (o caso real: 201)
  for (let i = 1; i <= 60; i++) add('Ano Novo - Feriado', reservation({ name: 'Ano Novo - Feriado', room: `00 - Prédio Principal - 01 - SEDE - SALA ${String(i).padStart(3, '0')}`, start: '06:00', end: '23:15' }))
  // 2ª leva do mesmo feriado: outro horário (07:00–22:40, antes 06:00–23:15), salas de outro prédio
  for (let i = 1; i <= 5; i++) add('Ano Novo - Feriado', reservation({ name: 'Ano Novo - Feriado', room: `02 - Prédio Centro - SALA ${100 + i}`, start: '07:00', end: '22:40' }))
  // mesmo evento, título com variações (Nova Reserva - / (FERIADO))
  add('Sexta-Feira Santa - Feriado', reservation({ name: 'Sexta-Feira Santa - Feriado', room: '01 - SEDE - AUDITÓRIO 1', date: '2027-03-26' }))
  add('Nova Reserva - Sexta-Feira Santa - Feriado', reservation({ name: 'Nova Reserva - Sexta-Feira Santa - Feriado', room: '00 - Prédio Principal - 01 - SEDE - BIBLIOTECA', date: '2027-03-26' }))
  add('SEXTA-FEIRA SANTA (FERIADO)', reservation({ name: 'SEXTA-FEIRA SANTA (FERIADO)', room: '00 - ARENA DE EVENTOS', date: '2027-03-26' }))
  // eventos únicos (NÃO podem ser tocados)
  add('Workshop Único', reservation({ name: 'Workshop Único', room: '01 - SEDE - AUDITÓRIO 1', date: '2027-02-10', start: '09:00', end: '12:00' }))
  add('Workshop Único', reservation({ name: 'Workshop Único', room: '01 - SEDE - AUDITÓRIO 1', date: '2027-02-11', start: '09:00', end: '12:00' })) // outra DATA
  add('Aula Magna', reservation({ name: 'Aula Magna', room: '01 - SEDE - AUDITÓRIO 1', date: '2027-02-12', start: '19:00', end: '22:00' }))
  add('Aula Magna', reservation({ name: 'Aula Magna', room: '01 - SEDE - AUDITÓRIO 1', date: '2027-02-12', start: '08:00', end: '12:00' })) // outra HORA
  // ilegível
  add('Suporte técnico sem data', 'Foi dado suporte técnico ao evento, sem nenhuma data no texto.')
  // outra ENTIDADE do GLPI (RH Interno): abertos (1,2,3), resolvidos (5) e fechado (6)
  const RH = 'Entidade raiz > RH Interno'
  add('RH: acesso ao sistema de folha', 'x', { status: 1, entity: RH, created: '2026-10-10 10:00:00', category: 'RH > Folha de pagamento', priority: 5 })
  add('RH: impressora do setor', 'x', { status: 2, entity: RH, created: '2026-10-11 10:00:00', category: 'Infra > Impressora' })
  add('RH: crachá novo', 'x', { status: 3, entity: RH, created: '2026-08-12 10:00:00', category: 'RH > Folha de pagamento' }) // aberto há +30 dias
  add('RH: senha do e-mail', 'x', { status: 5, entity: RH, created: '2026-09-01 10:00:00' })
  add('RH: monitor sem imagem', 'x', { status: 5, entity: RH, created: '2026-09-05 10:00:00' })
  add('RH: teclado', 'x', { status: 6, entity: RH, created: '2026-08-20 10:00:00' })
  // um chamado "aberto" do SERVICE DESK que NÃO é de evento (status 2)
  add('SD: servidor fora do ar', 'x', { status: 2, created: '2026-10-14 08:00:00' })
}
seed()

const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  if (p === '/__stats') return json(res, 200, { ...stats, tickets: [...tickets.values()].map(t => ({ id: t.id, status: t.status })) })
  if (p === '/__reset') { seed(); return json(res, 200, { ok: true }) }
  if (p.endsWith('/initSession')) return json(res, 200, { session_token: 'tok' })
  if (p.endsWith('/killSession')) return json(res, 200, {})
  // Cadastro de entidades — inclui uma SEM nenhum chamado (GENTE E GESTÃO)
  if (p.endsWith('/apirest.php/Entity')) return json(res, 200, [
    { id: 0, name: 'Entidade raiz', completename: 'Entidade raiz' },
    { id: 4, name: 'SERVICE DESK', completename: 'Entidade raiz > SERVICE DESK' },
    { id: 9, name: 'GENTE E GESTÃO', completename: 'Entidade raiz > GENTE E GESTÃO' },
  ])
  if (p.includes('/search/Ticket')) {
    stats.searches++
    const [from, to] = (url.searchParams.get('range') || '0-249').split('-').map(Number)
    // status pedidos: criteria[i][field]=12 & criteria[i][value]=N (OR entre eles)
    const wanted = new Set()
    for (let i = 0; i < 30; i++) {
      if (url.searchParams.get(`criteria[${i}][field]`) === '12') wanted.add(Number(url.searchParams.get(`criteria[${i}][value]`)))
    }
    const rows = [...tickets.values()].filter(t => wanted.has(t.status)).map(t => ({
      2: t.id, 1: t.name, 12: t.status, 3: t.priority, 15: t.date, 19: t.date_mod, 80: t.entity, 7: t.category,
    }))
    return json(res, 200, { data: rows.slice(from, to + 1), totalcount: rows.length })
  }
  const m = p.match(/\/Ticket\/(\d+)$/)
  if (m && req.method === 'GET') {
    stats.gets++
    const t = tickets.get(Number(m[1]))
    return t ? json(res, 200, t) : json(res, 404, ['ERROR_ITEM_NOT_FOUND', 'Item não encontrado'])
  }
  if (p.endsWith('/ITILSolution') && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      const { input } = JSON.parse(body)
      const t = tickets.get(input.items_id)
      if (t) t.status = 5
      stats.solutions.push({ id: input.items_id, content: input.content })
      json(res, 201, { id: stats.solutions.length })
    })
    return
  }
  json(res, 404, { error: 'mock: rota desconhecida ' + p })
}).listen(8798, () => console.log('mock GLPI na 8798'))

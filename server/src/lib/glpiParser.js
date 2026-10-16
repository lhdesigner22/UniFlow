// Extrai data/hora de início (e, se houver, término/sala/título) da
// descrição de um chamado do GLPI vindo de sistemas de reserva de sala.
// Existem VÁRIOS formatos diferentes em uso na UniFECAF (vários sistemas de
// reserva/atendimento distintos gerando chamados na mesma fila "Eventos"):
//
//   Formato A — reservas.app.unifecaf.edu.br (linhas "Nome da reserva:",
//   "Início:"/"Término:" com data por extenso):
//     Nome da reserva: VISITA MONITORADA 2026.2
//     Sala: 00 - Prédio Principal - 01 - SEDE - AUDITÓRIO 1
//     Início: 07:00 - segunda, 31 de agosto de 2026
//     Término: 17:45 - segunda, 31 de agosto de 2026
//
//   Formato B — sistema de reserva por e-mail (linhas "Evento:", "Data:" em
//   DD/MM/AAAA, "Horário:" como intervalo HH:MM - HH:MM):
//     Evento: SEMANA EDUCAÇÃO - LANÇAMENTO PARCERIA FITNESS LINK
//     Sala: 00 - ARENA DE EVENTOS
//     Data: 01/09/2026
//     Horário: 18:00 - 22:40
//
//   Formato C — "Sistema de Agendamento UniFECAF Eventos" (e-mail HTML
//   automático, tabela com linhas rotuladas, cada rótulo com um emoji na
//   frente — o emoji varia, por isso o `\W*` no início de cada regex):
//     📅 Evento: Estética Day 2026
//     ⏰ Data/Hora: 10/09/2026 às 19:00 às 22:00
//     📍 Local: 00 - ARENA DE EVENTOS
//
//   Formato D — resposta de confirmação de reserva (prosa corrida, não em
//   linhas rotuladas):
//     A reserva da Sala 316 – SEDE está confirmada para o dia 01/09/2026,
//     das 16h00 às 17h30.
//
//   Formato F — data relativa "hoje" em prosa (sem nenhuma data explícita no
//   texto) — usa a própria data de criação do chamado no GLPI:
//     ...caixa de som e cabo reservado para hoje na sala 25...
//
//   Formato G — data relativa "amanhã" em prosa — mesma ideia do F, um dia
//   à frente da data de criação:
//     Amanhã teremos a Aula Magna de Tech com 2 palestras... Das 8h30 as 12h
//
//   Formato H — "próxima segunda-feira"/"próximo sábado" etc. em prosa — dia
//   da semana relativo à data de criação do chamado, sem data explícita:
//     Na próxima segunda-feira, teremos o evento "Workshop..."
//
//   Formato E — fallback genérico: qualquer chamado em prosa livre que
//   mencione uma data solta no formato DD/MM (com ou sem ano, em qualquer
//   lugar do texto — "dia 08/09 (terça-feira)", "próxima sexta-feira, 04/09"
//   etc.) e, se houver, um horário próximo ("das Xh às Yh", "às Xh"). Sem
//   ano informado, assume o ano corrente (ou o próximo, se a data já passou
//   há alguns dias — reserva feita perto da virada do ano). Roda por último,
//   depois de todos os formatos mais específicos, porque é o mais genérico
//   e o mais sujeito a interpretar errado um texto ambíguo.
//
// `parseReservationDescription` tenta cada formato em sequência (o primeiro
// que reconhecer "vence"). Chamados que não batem com NENHUM formato (ex:
// relatos sem nenhuma data, tipo "já fizemos a montagem tal") caem em
// `glpi_unparsed_tickets` pra revisão manual — decisão de arquitetura: regras
// de texto puras, sem IA (sem custo por chamado); adicionar um novo formato
// no futuro é só acrescentar mais uma função `parseFormatX` na lista.

const MONTHS = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&ccedil;/gi, 'ç')
    .replace(/&atilde;/gi, 'ã').replace(/&otilde;/gi, 'õ').replace(/&amp;/gi, '&')
    .trim()
}

// "08:00 - sábado, 17 de outubro de 2026" -> { date: '2026-10-17', time: '08:00' }
function parseDateTimeLine(line) {
  const m = line.match(/(\d{1,2}):(\d{2})\s*-\s*[^,]+,\s*(\d{1,2})\s+de\s+(\p{L}+)\s+de\s+(\d{4})/iu)
  if (!m) return null
  const [, hh, mm, day, monthName, year] = m
  const month = MONTHS[monthName.toLowerCase()]
  if (!month) return null
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${hh.padStart(2, '0')}:${mm}`,
  }
}

// ── Formato A ────────────────────────────────────────────────────────────
function parseFormatA(lines) {
  let start = null, end = null, location = null, title = null

  for (const line of lines) {
    const inicio = line.match(/^In[ií]cio:\s*(.+)$/i)
    if (inicio) start = parseDateTimeLine(inicio[1])

    const termino = line.match(/^T[ée]rmino:\s*(.+)$/i)
    if (termino) end = parseDateTimeLine(termino[1])

    const sala = line.match(/^Sala:\s*(.+)$/i)
    if (sala) location = sala[1].trim()

    const nome = line.match(/^Nome da reserva:\s*(.+)$/i)
    if (nome) title = nome[1].trim()
  }

  if (!start) return null
  return { event_date: start.date, event_time: start.time, title, location, end }
}

// ── Formato B ────────────────────────────────────────────────────────────
function parseFormatB(lines) {
  let date = null, timeStart = null, timeEnd = null, location = null, title = null

  for (const line of lines) {
    const evento = line.match(/^Evento:\s*(.+)$/i)
    if (evento) title = evento[1].trim()

    const sala = line.match(/^Sala:\s*(.+)$/i)
    if (sala) location = sala[1].trim()

    const dataM = line.match(/^Data:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (dataM) {
      const [, d, m, y] = dataM
      date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }

    const horarioM = line.match(/^Hor[áa]rio:\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i)
    if (horarioM) {
      const [, h1, m1, h2, m2] = horarioM
      timeStart = `${h1.padStart(2, '0')}:${m1}`
      timeEnd = `${h2.padStart(2, '0')}:${m2}`
    }
  }

  if (!date || !timeStart) return null
  return {
    event_date: date,
    event_time: timeStart,
    title,
    location,
    end: timeEnd ? { date, time: timeEnd } : null,
  }
}

// ── Formato C ────────────────────────────────────────────────────────────
// "Sistema de Agendamento UniFECAF Eventos" — tabela HTML com uma linha por
// rótulo, cada rótulo com um emoji na frente (varia: 📅/⏰/📍/🏬/...). O `\W*`
// no começo de cada regex absorve esse emoji (não é letra/número, então cai
// em \W) sem precisar saber qual é.
function parseFormatC(lines) {
  let title = null, location = null, date = null, timeStart = null, timeEnd = null

  for (const line of lines) {
    const evento = line.match(/^\W*Evento:\s*(.+)$/i)
    if (evento) title = evento[1].trim()

    const local = line.match(/^\W*Local:\s*(.+)$/i)
    if (local) location = local[1].trim()

    const dataHora = line.match(/^\W*Data\/Hora:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*às\s*(\d{1,2}):(\d{2})(?:\s*às\s*(\d{1,2}):(\d{2}))?/i)
    if (dataHora) {
      const [, d, m, y, h1, mi1, h2, mi2] = dataHora
      date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      timeStart = `${h1.padStart(2, '0')}:${mi1}`
      timeEnd = h2 ? `${h2.padStart(2, '0')}:${mi2}` : null
    }
  }

  if (!date || !timeStart) return null
  return { event_date: date, event_time: timeStart, title, location, end: timeEnd ? { date, time: timeEnd } : null }
}

// ── Formato D ────────────────────────────────────────────────────────────
// Resposta de confirmação de reserva, em prosa corrida (não em linhas
// rotuladas): "A reserva da Sala 316 – SEDE está confirmada para o dia
// 01/09/2026, das 16h00 às 17h30."
function parseFormatD(text) {
  const m = text.match(/reserva\s+d[ae]\s+(.+?)\s+est[áa]\s+confirmada\s+para\s+o\s+dia\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s*,?\s*das\s*(\d{1,2})h(\d{2})?\s*às\s*(\d{1,2})h(\d{2})?/i)
  if (!m) return null
  const [, location, d, mo, y, h1, mi1, h2, mi2] = m
  const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  return {
    event_date: date,
    event_time: `${h1.padStart(2, '0')}:${mi1 || '00'}`,
    title: null,
    location: location.trim().replace(/^[-–—]\s*/, ''),
    end: { date, time: `${h2.padStart(2, '0')}:${mi2 || '00'}` },
  }
}

// Horário em algum lugar do texto — usado pelos formatos E, F, G e H, que
// não têm rótulo fixo pra hora. Tenta, em ordem: intervalo "Xh(MM)? às
// Yh(MM)?", intervalo "HH:MM às HH:MM", e por último só o horário de início
// ("às Xh"). `[àa]s` (em vez de só "às") de propósito — já apareceu chamado
// real escrito sem o acento ("Das 8h30 as 12h"), e como o token sempre está
// espremido entre dois horários (dígito+h ... dígito+h), aceitar "as" sem
// acento não arrisca casar em outro lugar do texto por engano.
function findTimeRange(text) {
  let m = text.match(/(\d{1,2})\s*h\s*(\d{2})?\s*[àa]s\s*(\d{1,2})\s*h\s*(\d{2})?/i)
  if (m) return { start: `${m[1].padStart(2, '0')}:${m[2] || '00'}`, end: `${m[3].padStart(2, '0')}:${m[4] || '00'}` }

  m = text.match(/(\d{1,2}):(\d{2})\s*[àa]s\s*(\d{1,2}):(\d{2})/i)
  if (m) return { start: `${m[1].padStart(2, '0')}:${m[2]}`, end: `${m[3].padStart(2, '0')}:${m[4]}` }

  m = text.match(/[àa]s\s*(\d{1,2})\s*h\s*(\d{2})?/i) || text.match(/[àa]s\s*(\d{1,2}):(\d{2})/i)
  if (m) return { start: `${m[1].padStart(2, '0')}:${m[2] || '00'}`, end: null }

  return null
}

// ── Formato F ────────────────────────────────────────────────────────────
// Data relativa "hoje" em prosa, sem nenhuma data explícita — usa a própria
// data de criação do chamado no GLPI. Roda antes do fallback genérico E
// (que não reconheceria nada aqui mesmo, já que não há nenhum DD/MM no
// texto) só por clareza de intenção.
function parseFormatF(text, createdAt) {
  if (!/\bhoje\b/i.test(text)) return null
  const dateOnly = String(createdAt || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null // sem data de criação confiável — não arrisca

  const timeRange = findTimeRange(text)
  return {
    event_date: dateOnly,
    event_time: timeRange?.start || null,
    title: null,
    location: null,
    end: timeRange?.end ? { date: dateOnly, time: timeRange.end } : null,
  }
}

// Soma dias a uma data 'YYYY-MM-DD' em UTC (sem depender de fuso local) e
// devolve no mesmo formato — usado pelos formatos G e H.
function addDays(dateOnly, days) {
  const d = new Date(`${dateOnly}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── Formato G ────────────────────────────────────────────────────────────
// Data relativa "amanhã" em prosa — mesma lógica do Formato F, um dia à
// frente da data de criação do chamado.
function parseFormatG(text, createdAt) {
  // Sem \b no final de propósito: "ã" não conta como caractere de palavra
  // pro \w do JS (só ASCII), então \bamanh[ãa]\b nunca fecha depois de um
  // "ã" — \b só no início já basta (não existe outra palavra comum em
  // português que comece com "amanh" + "a"/"ã").
  if (!/\bamanh[ãa]/i.test(text)) return null
  const dateOnly = String(createdAt || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null

  const date = addDays(dateOnly, 1)
  const timeRange = findTimeRange(text)
  return {
    event_date: date,
    event_time: timeRange?.start || null,
    title: null,
    location: null,
    end: timeRange?.end ? { date, time: timeRange.end } : null,
  }
}

// ── Formato H ────────────────────────────────────────────────────────────
// "Na próxima segunda-feira, teremos..." / "próximo sábado" — dia da semana
// relativo à data de criação, sem nenhuma data explícita no texto. "Próxima"
// aqui é tratado como "a primeira ocorrência desse dia da semana depois de
// hoje" (se o chamado for criado numa segunda e falar de "próxima segunda",
// pula pra segunda da semana seguinte — não é o mesmo dia).
const WEEKDAYS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 }
function parseFormatH(text, createdAt) {
  const m = text.match(/pr[óo]xim[ao]\s+(domingo|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado)/i)
  if (!m) return null
  const dateOnly = String(createdAt || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null

  const key = m[1].toLowerCase().replace('-feira', '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento: "terça"->"terca", "sábado"->"sabado"
  const targetIdx = WEEKDAYS[key]
  if (targetIdx === undefined) return null

  const baseIdx = new Date(`${dateOnly}T00:00:00Z`).getUTCDay()
  const diff = ((targetIdx - baseIdx + 7) % 7) || 7 // nunca "hoje" — "próxima" sempre é adiante
  const date = addDays(dateOnly, diff)
  const timeRange = findTimeRange(text)
  return {
    event_date: date,
    event_time: timeRange?.start || null,
    title: null,
    location: null,
    end: timeRange?.end ? { date, time: timeRange.end } : null,
  }
}

// Primeira data DD/MM(/AAAA)? plausível (dia 1-31, mês 1-12) em qualquer
// lugar do texto — usado só pelo fallback genérico E.
function findDateToken(text) {
  const re = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g
  let m
  while ((m = re.exec(text))) {
    const day = parseInt(m[1], 10), month = parseInt(m[2], 10)
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return { day, month, year: m[3] ? parseInt(m[3], 10) : null }
    }
  }
  return null
}

// Sem ano explícito, assume o ano corrente — a não ser que essa data já
// tenha ficado mais de alguns dias no passado, caso em que assume o ano
// seguinte (reserva feita perto da virada do ano, pro ano que vem).
function resolveYear(day, month, explicitYear) {
  if (explicitYear) return explicitYear
  const now = new Date()
  let year = now.getUTCFullYear()
  const candidate = new Date(Date.UTC(year, month - 1, day))
  const diffDays = (candidate.getTime() - now.getTime()) / 86400000
  if (diffDays < -3) year += 1
  return year
}

// ── Formato E (fallback genérico) ───────────────────────────────────────
function parseFormatE(text) {
  const dateToken = findDateToken(text)
  if (!dateToken) return null

  const year = resolveYear(dateToken.day, dateToken.month, dateToken.year)
  const date = `${year}-${String(dateToken.month).padStart(2, '0')}-${String(dateToken.day).padStart(2, '0')}`
  const timeRange = findTimeRange(text)

  return {
    event_date: date,
    event_time: timeRange?.start || null,
    title: null,
    location: null,
    end: timeRange?.end ? { date, time: timeRange.end } : null,
  }
}

// Ordem importa: formatos mais específicos/confiáveis primeiro; o fallback
// genérico (E) sempre por último, já que é o mais sujeito a interpretar
// errado um texto ambíguo.
const LINE_PARSERS = [parseFormatA, parseFormatB, parseFormatC]
const TEXT_PARSERS = [parseFormatD]
const RELATIVE_PARSERS = [parseFormatF, parseFormatG, parseFormatH] // hoje / amanhã / próximo dia da semana

// Retorna null quando nenhum formato reconhece o texto (chamado cai pra
// revisão manual). `ticket` pode ser o objeto do chamado do GLPI (usa
// `ticket.content` pra descrição e `ticket.date` pra resolver "hoje") ou,
// por compatibilidade, uma string já sendo o conteúdo direto.
export function parseReservationDescription(ticket) {
  const isTicketObject = ticket && typeof ticket === 'object'
  const rawContent = isTicketObject ? ticket.content : ticket
  const createdAt = isTicketObject ? (ticket.date || ticket.date_creation || ticket.date_mod) : null

  const text = stripHtml(rawContent)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  for (const parser of LINE_PARSERS) {
    const result = parser(lines)
    if (result) return result
  }
  for (const parser of TEXT_PARSERS) {
    const result = parser(text)
    if (result) return result
  }
  for (const parser of RELATIVE_PARSERS) {
    const result = parser(text, createdAt)
    if (result) return result
  }

  return parseFormatE(text)
}

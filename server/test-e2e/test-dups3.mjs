import { groupDuplicates, createDupIndex, normTitle, mergeRooms, roomsOf, eventRange } from '../src/lib/glpiDuplicates.js'
const E = (id, title, d, h, sala, fim, st = null, fimDate = d) => ({ glpi_ticket_id: id, title, event_date: d, event_time: h, description: `Sala: ${sala} · Término: ${fim} - ${fimDate} · Importado do chamado GLPI #${id}`, glpi_resolve_state: st })
let ok = true
const check = (n, c) => { ok &&= !!c; console.log((c ? 'OK   ' : 'FALHA'), n) }

// Os pares REAIS que o usuário viu no GLPI
const rows = [
  E(16890, 'Ano Novo - Feriado', '2027-01-01', '06:00', 'SEDE - SALA 1', '23:15'),
  E(17003, 'Ano Novo - Feriado', '2027-01-01', '07:00', 'CENTRO - SALA 9', '22:40'),
  E(17260, 'Corpus Christi - Feriado', '2027-05-27', '06:00', 'SEDE - A', '23:15', null, '2027-05-28'),
  E(17313, 'Nova Reserva - Corpus Christi - Feriado', '2027-05-27', '07:00', 'CENTRO - B', '22:40', null, '2027-05-28'),
  E(17145, 'Tiradentes - Feriado', '2027-04-21', '06:00', 'SEDE - A', '23:15'),
  E(17209, 'FERIADO - Tiradentes', '2027-04-21', '07:00', 'CENTRO - B', '22:40'),
  E(17131, 'Sexta-Feira Santa - Feriado', '2027-03-26', '07:00', 'CENTRO - B', '22:40'),
  E(17137, 'SEXTA-FEIRA SANTA (FERIADO)', '2027-03-26', '06:00', 'SEDE - A', '23:15', null, '2027-03-27'),
  E(17414, 'Véspera de Natal', '2027-12-24', '06:00', 'SEDE - A', '23:15'),
  E(17454, 'Véspera de Natal', '2027-12-24', '07:00', 'CENTRO - B', '22:40'),
  // NÃO são duplicatas
  E(100, 'Aula Magna', '2027-02-12', '08:00', 'AUD 1', '12:00'),
  E(101, 'Aula Magna', '2027-02-12', '19:00', 'AUD 1', '22:00'),          // mesma data, horários que NÃO se sobrepõem
  E(102, 'Workshop', '2027-02-10', '09:00', 'AUD 1', '12:00'),
  E(103, 'Workshop', '2027-02-11', '09:00', 'AUD 1', '12:00'),             // outra data
]
const g = groupDuplicates(rows)
const keeps = Object.fromEntries(g.map(x => [x.keep.glpi_ticket_id, x.duplicates.map(d => d.glpi_ticket_id).join()]))
check('Ano Novo: 16890 fica, 17003 (07:00) a solucionar', keeps[16890] === '17003')
check('Corpus Christi (títulos diferentes, viagem de 2 dias): 17260 fica, 17313', keeps[17260] === '17313')
check('Tiradentes ("FERIADO - Tiradentes"): 17145 fica, 17209', keeps[17145] === '17209')
check('Sexta-Feira Santa: 17131 fica, 17137', keeps[17131] === '17137')
check('Véspera de Natal: 17414 fica, 17454', keeps[17414] === '17454')
check('Aula Magna em horários que não se sobrepõem NÃO é duplicata', !keeps[100] && !keeps[101])
check('Workshop em datas diferentes NÃO é duplicata', !keeps[102] && !keeps[103])
check('total: exatamente 5 grupos', g.length === 5)

// intervalos
const [s1, e1] = eventRange(E(1, 'x', '2027-05-27', '06:00', 'A', '23:15', null, '2027-05-28'))
check('intervalo atravessa a meia-noite (27/05 06:00 → 28/05 23:15)', e1 - s1 === (41 * 60 + 15) + 0 * 60 + 0 || e1 - s1 === 17 * 60 + 24 * 60 + 15)
check('evento sem término é um ponto', (() => { const [a, b] = eventRange({ event_date: '2027-01-01', event_time: '10:00', description: '' }); return a === b })())
check('evento sem hora vale o dia todo', (() => { const [a, b] = eventRange({ event_date: '2027-01-01', event_time: null, description: '' }); return b - a === 23 * 60 + 59 })())

// índice incremental (usado pelo importador): novo chamado cai no grupo certo
const idx = createDupIndex()
for (const r of rows.slice().sort((a, b) => a.glpi_ticket_id - b.glpi_ticket_id)) idx.add(r)
const novo = idx.add({ glpi_ticket_id: 99999, title: 'Nova Reserva - Ano Novo - Feriado', event_date: '2027-01-01', event_time: '12:00', description: 'Sala: X · Término: 13:00 - 2027-01-01' })
check('chamado novo (12:00–13:00) dentro do período do Ano Novo é repetição do 16890', novo.duplicate && novo.keeper.ticketId === 16890)
const outro = idx.add({ glpi_ticket_id: 99998, title: 'Ano Novo - Feriado', event_date: '2028-01-01', event_time: '06:00', description: 'Sala: X · Término: 23:15 - 2028-01-01' })
check('mesmo título em OUTRO ano não é repetição', !outro.duplicate)

// salas
let d = 'Sala: 00 - Principal - SALA 001 · Término: 23:15 - 2027-01-01 · Importado do chamado GLPI #1'
d = mergeRooms(d, ['02 - Centro - SALA 101']); d = mergeRooms(d, ['01 - SEDE - SALA 001'])
check('salas somadas sem repetir (2)', roomsOf(d).length === 2 && /^Salas \(2\):/.test(d))
process.exit(ok ? 0 : 1)

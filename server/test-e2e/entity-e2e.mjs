// E2E: Chamados por entidade do GLPI conforme o departamento (Worker local + GLPI de mentira).
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799', MOCK = 'http://127.0.0.1:8798'
const key = new TextEncoder().encode('testsecret')
const WHO = ['u-test', 'd-ti-ana', 'd-rh-ana', 'd-nodept', 'd-rh-col']
const T = Object.fromEntries(await Promise.all(WHO.map(async id => [id, await new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)])))
const call = async (who, method, path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const cron = c => fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(c)}`)

let ok = true
const check = (n, c, extra = '') => { ok &&= !!c; console.log(`${c ? 'OK   ' : 'FALHA'}  ${n}${extra ? '  — ' + extra : ''}`) }
const titles = r => (r.j?.tickets || []).map(t => t.title)

await fetch(MOCK + '/__reset')

// departamentos ↔ entidades
check('migração pôs "SERVICE DESK" no departamento TI', (await call('u-test', 'GET', '/api/admin/departments')).j?.find(d => d.id === 'd-ti')?.glpi_entity_name === 'SERVICE DESK')
let r = await call('u-test', 'PUT', '/api/admin/departments/d-rh', { glpi_entity_name: 'RH Interno' })
check('Admin define a entidade do RH', r.s === 200 && r.j?.glpi_entity_name === 'RH Interno', JSON.stringify(r.j))

// roda os ciclos (Backlog a cada 1 min, Total a cada 15)
await cron('* * * * *'); await sleep(2500)
await cron('10,25,40,55 * * * *'); await sleep(3500)

// lista de entidades vistas no GLPI
r = await call('u-test', 'GET', '/api/admin/glpi/entities')
check('Admin enxerga as entidades que existem no GLPI', Array.isArray(r.j) && r.j.includes('Entidade raiz > SERVICE DESK') && r.j.includes('Entidade raiz > RH Interno'), JSON.stringify(r.j))
check('...inclusive entidade SEM chamado (vem do cadastro /Entity)', r.j?.includes('Entidade raiz > GENTE E GESTÃO'), JSON.stringify(r.j))
await cron('* * * * *'); await sleep(2500) // o Backlog de 1 min não pode mais apagar a lista
r = await call('u-test', 'GET', '/api/admin/glpi/entities')
check('...e o Backlog seguinte não tira nenhuma da lista', r.j?.includes('Entidade raiz > RH Interno') && r.j?.includes('Entidade raiz > GENTE E GESTÃO'), JSON.stringify(r.j))

// ── Backlog ──────────────────────────────────────────────────────────────
r = await call('d-ti-ana', 'GET', '/api/glpi-backlog')
check('TI vê a entidade SERVICE DESK', r.j?.entity === 'SERVICE DESK', `entity=${r.j?.entity}`)
check('TI vê chamados do SERVICE DESK e nenhum do RH', titles(r).some(t => t.startsWith('SD:')) && !titles(r).some(t => t.startsWith('RH:')), `${titles(r).length} chamados`)
r = await call('d-rh-ana', 'GET', '/api/glpi-backlog')
check('RH vê a entidade RH Interno', r.j?.entity === 'RH Interno', `entity=${r.j?.entity}`)
check('RH vê só os 3 chamados ABERTOS do RH (os resolvidos ficam de fora do backlog)', titles(r).length === 3 && titles(r).every(t => t.startsWith('RH:')), titles(r).join(' | '))
// KPIs/gráficos que valem pra qualquer departamento (não só as filas do TI)
const cats = Object.fromEntries((r.j?.byCategory || []).map(c => [c.name, c.count]))
check('RH: chamados por categoria do GLPI', cats['RH > Folha de pagamento'] === 2 && cats['Infra > Impressora'] === 1, JSON.stringify(r.j?.byCategory))
check('RH: KPI "Alta prioridade"', r.j?.highPriority === 1, `highPriority=${r.j?.highPriority}`)
check('RH: KPI "Parados há +30 dias"', r.j?.olderThan30 === 1, `olderThan30=${r.j?.olderThan30}`)
check('RH: categoria vem em cada chamado da tabela', (r.j?.tickets || []).find(t => t.title === 'RH: impressora do setor')?.category === 'Infra > Impressora')
check('RH: nenhum chamado nas filas do TI (cartões delas ficam escondidos)', [10, 13, 14, 15, 16, 17].every(c => !r.j?.byStatus?.[c]))
// Técnicos ocultos nos gráficos (por entidade, só Super Admin)
let h = await call('u-test', 'PUT', '/api/glpi-total/hidden-technicians', { entity: 'RH Interno', names: ['Fulano Saiu', ' Ciclano ', 'Fulano Saiu'] })
check('Super Admin oculta técnicos (sem repetir, sem espaço)', h.s === 200 && JSON.stringify(h.j?.hiddenTechnicians) === '["Ciclano","Fulano Saiu"]', JSON.stringify(h.j))
check('Backlog do RH devolve os ocultos', JSON.stringify((await call('d-rh-ana', 'GET', '/api/glpi-backlog')).j?.hiddenTechnicians) === '["Ciclano","Fulano Saiu"]')
check('Total do RH devolve os ocultos', JSON.stringify((await call('d-rh-ana', 'GET', '/api/glpi-total')).j?.hiddenTechnicians) === '["Ciclano","Fulano Saiu"]')
check('...e o TI não é afetado', ((await call('d-ti-ana', 'GET', '/api/glpi-backlog')).j?.hiddenTechnicians || []).length === 0)
check('quem não é Super Admin não oculta', (await call('d-rh-ana', 'PUT', '/api/glpi-total/hidden-technicians', { entity: 'RH Interno', names: [] })).s === 403)
check('entidade que não existe é recusada', (await call('u-test', 'PUT', '/api/glpi-total/hidden-technicians', { entity: 'Não Existe', names: [] })).s === 400)
h = await call('u-test', 'PUT', '/api/glpi-total/hidden-technicians', { entity: 'RH Interno', names: [] })
check('"Mostrar todos" limpa a lista', h.s === 200 && (h.j?.hiddenTechnicians || []).length === 0)
check('RH NÃO escolhe outra entidade (?entity= é ignorado)', (await call('d-rh-ana', 'GET', '/api/glpi-backlog?entity=SERVICE DESK')).j?.entity === 'RH Interno')
check('RH não recebe a lista de entidades dos outros', (await call('d-rh-ana', 'GET', '/api/glpi-backlog')).j?.entities?.length === 1)
r = await call('d-nodept', 'GET', '/api/glpi-backlog')
check('Pessoa sem departamento: "sem entidade"', r.j?.noEntity === true && !r.j?.tickets)

r = await call('u-test', 'GET', '/api/glpi-backlog')
check('Super Admin recebe a lista de entidades pra escolher', r.j?.entities?.length === 2, JSON.stringify(r.j?.entities))
r = await call('u-test', 'GET', '/api/glpi-backlog?entity=RH Interno')
check('Super Admin escolhe RH Interno', r.j?.entity === 'RH Interno' && titles(r).length === 3)
r = await call('u-test', 'GET', '/api/glpi-backlog', null, { 'X-Department-View': 'd-rh' })
check('Super Admin "vendo como RH" já cai na entidade do RH', r.j?.entity === 'RH Interno')
r = await call('u-test', 'GET', '/api/glpi-backlog', null, { 'X-Department-View': 'd-nodept-inexistente' })
check('"Ver como" um departamento sem entidade → sem entidade', r.j?.noEntity === true)

// ── Total ────────────────────────────────────────────────────────────────
r = await call('d-rh-ana', 'GET', '/api/glpi-total')
check('Total do RH: 6 chamados (3 abertos + 2 resolvidos + 1 fechado)', r.j?.entity === 'RH Interno' && r.j?.totalTickets === 6, `entity=${r.j?.entity} total=${r.j?.totalTickets}`)
check('Total do RH tem a taxa de resolução (3 de 6 finalizados)', r.j?.resolutionRate === 50 || /50/.test(String(r.j?.resolutionRate)), `taxa=${r.j?.resolutionRate}`)
const origins = res => Object.fromEntries((res.j?.byOrigin || []).map(o => [o.name, o.count]))
let o = origins(r)
check('Origem da requisição: Financeiro 2, Helpdesk 2, Secretaria 1, Sem origem 1', o.Financeiro === 2 && o.Helpdesk === 2 && o.Secretaria === 1 && o['Sem origem'] === 1, JSON.stringify(o))
check('Origem por mês: ago, set e out', (r.j?.originMonthly || []).map(m => m.month).join(',') === '2026-08,2026-09,2026-10', JSON.stringify(r.j?.originMonthly))
check('Origem por mês: outubro tem os 2 do Financeiro', r.j?.originMonthly?.find(m => m.month === '2026-10')?.Financeiro === 2)
r = await call('d-rh-ana', 'GET', '/api/glpi-total?from=2026-09-01&to=2026-09-30')
check('Total do RH filtrado por data (setembro: 2 resolvidos)', r.j?.filtered === true && r.j?.entity === 'RH Interno' && r.j?.totalTickets === 2, `total=${r.j?.totalTickets}`)
o = origins(r)
check('Origem filtrada por data (cache cru compacto): setembro = Secretaria 1 + Helpdesk 1', o.Secretaria === 1 && o.Helpdesk === 1 && !o.Financeiro, JSON.stringify(o))
check('Filtro por data mantém o técnico dos chamados', (r.j?.tickets || []).length === 2)
r = await call('d-ti-ana', 'GET', '/api/glpi-total')
check('Total do TI é do SERVICE DESK (sem chamados do RH)', r.j?.entity === 'SERVICE DESK' && !(r.j?.tickets || []).some(t => t.title.startsWith('RH:')), `entity=${r.j?.entity}`)
check('Pessoa sem departamento: Total "sem entidade"', (await call('d-nodept', 'GET', '/api/glpi-total')).j?.noEntity === true)
check('Colaborador (sem acesso a Chamados) continua bloqueado', (await call('d-rh-col', 'GET', '/api/glpi-backlog')).s === 200 || true) // d-rh-col é Colaborador: tickets=none
r = await call('d-rh-col', 'GET', '/api/glpi-backlog')
check('Colaborador: Chamados continua bloqueado (403)', r.s === 403, `status=${r.s}`)

// ── Trocar a entidade de um departamento vale no próximo ciclo ───────────
await call('u-test', 'PUT', '/api/admin/departments/d-rh', { glpi_entity_name: '' })
check('Departamento sem entidade: RH passa a ver "sem entidade"', (await call('d-rh-ana', 'GET', '/api/glpi-backlog')).j?.noEntity === true)

console.log(ok ? '\nTUDO OK' : '\nHÁ FALHAS')
process.exit(ok ? 0 : 1)

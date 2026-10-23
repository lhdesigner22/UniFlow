// E2E: Impressoras → Estoque de insumos (saldo por prédio, trocas, transferência, ajuste).
//   cd server && node test-e2e/node-server.mjs   (seed-base + dept-seed)
//   node test-e2e/printer-supplies-e2e.mjs
import { SignJWT } from 'jose'

const BASE = 'http://127.0.0.1:8799'
const key = new TextEncoder().encode('testsecret')
const tok = id => new SignJWT({ id, name: id, email: `${id}@colegioser.com`, tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key)
const T = { admin: await tok('u-test'), ti: await tok('d-ti-ana'), colab: await tok('u-col'), aud: await tok('u-aud') }
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${T[who]}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch {}
  return { s: r.status, j }
}
let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }
const qty = (s, loc) => s?.stocks?.[loc]?.quantity

// Impressoras de verdade pra registrar as trocas
const pSede = (await call('admin', 'POST', '/api/printers', { location: 'sede', model: 'RICOH SP377SFNwX', ip: '10.0.0.5' })).j
const pAdm = (await call('admin', 'POST', '/api/printers', { location: 'adm', model: 'RICOH SP377SFNwX' })).j

// ── Catálogo ─────────────────────────────────────────────────────────────
let r = await call('ti', 'POST', '/api/printer-supplies', { name: 'Toner Ricoh SP 377 preto', code: '408161', type: 'toner', color: 'preto', models: ['RICOH SP377SFNwX', 'RICOH SP377SFNwX', ' '], minimums: { sede: 2, adm: 1 } })
expect('Analista (Impressoras=edit) cadastra insumo', r.s, 200)
const toner = r.j
expect('...modelos sem repetição', JSON.stringify(toner?.models), '["RICOH SP377SFNwX"]')
expect('...mínimo por prédio', `${toner?.stocks?.sede?.min_quantity}/${toner?.stocks?.adm?.min_quantity}/${toner?.stocks?.g5?.min_quantity}`, '2/1/0')
expect('...começa com saldo 0 em todos os prédios', ['sede', 'adm', 'centro', 'g5', 'clinicas'].every(l => qty(toner, l) === 0), true)
expect('tipo inválido recusado', (await call('ti', 'POST', '/api/printer-supplies', { name: 'x', type: 'xx' })).s, 400)
expect('Colaborador (Impressoras=view) vê o estoque', (await call('colab', 'GET', '/api/printer-supplies')).s, 200)
expect('Colaborador não cadastra', (await call('colab', 'POST', '/api/printer-supplies', { name: 'x', type: 'toner' })).s, 403)
expect('Auditor não movimenta', (await call('aud', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'entrada', location: 'sede', quantity: 1 })).s, 403)

// ── Menu: itens no mínimo ou abaixo ──────────────────────────────────────
r = await call('ti', 'GET', '/api/printer-supplies/low')
expect('sem saldo: SEDE e ADM no mínimo (aviso do menu)', `${r.j?.sede}/${r.j?.adm}/${r.j?.g5}`, '1/1/undefined')

// ── Entrada / troca / transferência / ajuste ─────────────────────────────
r = await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'entrada', location: 'sede', quantity: 5, note: 'NF 123' })
expect('entrada de 5 na SEDE', qty(r.j, 'sede'), 5)
r = await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'troca', location: 'sede', quantity: 1, printer_id: pSede.id, happened_at: '2026-10-01T09:30' })
expect('troca na impressora da SEDE: saldo 4', qty(r.j, 'sede'), 4)
expect('troca sem impressora recusada', (await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'troca', location: 'sede', quantity: 1 })).s, 400)
expect('troca com impressora de outro prédio recusada', (await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'troca', location: 'sede', quantity: 1, printer_id: pAdm.id })).s, 400)
expect('troca maior que o saldo recusada', (await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'troca', location: 'sede', quantity: 99, printer_id: pSede.id })).s, 400)
r = await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'transferencia', location: 'sede', to_location: 'adm', quantity: 2 })
expect('transferência SEDE → ADM: 2 e 2', `${qty(r.j, 'sede')}/${qty(r.j, 'adm')}`, '2/2')
expect('transferência pro mesmo prédio recusada', (await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'transferencia', location: 'sede', to_location: 'sede', quantity: 1 })).s, 400)
r = await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'ajuste', location: 'adm', quantity: 3, note: 'contagem' })
expect('ajuste de contagem no ADM: saldo 3', qty(r.j, 'adm'), 3)
expect('ajuste sem mudança recusado', (await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'ajuste', location: 'adm', quantity: 3 })).s, 400)
await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'troca', location: 'adm', quantity: 1, printer_id: pAdm.id, happened_at: '2026-10-20T14:00' })
await call('ti', 'POST', `/api/printer-supplies/${toner.id}/movements`, { kind: 'troca', location: 'sede', quantity: 1, printer_id: pSede.id, happened_at: '2026-10-21T10:00' })

// ── Histórico, consumo e menu de novo ────────────────────────────────────
r = await call('ti', 'GET', `/api/printer-supplies/${toner.id}/movements?location=sede`)
expect('histórico da SEDE: entrada, troca, transf., troca', (r.j || []).map(m => m.kind).sort().join(','), 'entrada,transferencia_saida,troca,troca')
expect('...cada movimento guarda o saldo depois', (r.j || []).find(m => m.kind === 'entrada')?.balance_after, 5)
expect('...troca mostra a impressora', (r.j || []).find(m => m.kind === 'troca')?.printer_model, 'RICOH SP377SFNwX')
r = await call('ti', 'GET', '/api/printer-supplies')
const t2 = (r.j || []).find(s => s.id === toner.id)
expect('consumo dos últimos 90 dias por prédio (trocas)', `${t2?.usage90?.sede}/${t2?.usage90?.adm}`, '2/1')
r = await call('ti', 'GET', `/api/printer-supplies/printer/${pSede.id}`)
expect('histórico da impressora: 2 trocas', (r.j || []).length, 2)
r = await call('ti', 'GET', '/api/printer-supplies/low')
expect('menu: SEDE com 1 (no mínimo 2), ADM ok', `${r.j?.sede}/${r.j?.adm}`, '1/undefined')
r = await call('admin', 'GET', '/api/printer-supplies/export')
expect('exportação traz itens e movimentos', `${r.j?.supplies?.length}/${r.j?.movements?.length}`, '1/7')

// ── Duas pessoas tirando o ÚLTIMO item ao mesmo tempo ────────────────────
const drum = (await call('ti', 'POST', '/api/printer-supplies', { name: 'Cilindro teste', type: 'cilindro' })).j
await call('ti', 'POST', `/api/printer-supplies/${drum.id}/movements`, { kind: 'entrada', location: 'sede', quantity: 1 })
const both = await Promise.all([1, 2].map(() => call('ti', 'POST', `/api/printer-supplies/${drum.id}/movements`, { kind: 'troca', location: 'sede', quantity: 1, printer_id: pSede.id })))
expect('ao mesmo tempo: só uma troca passa', both.filter(x => x.s === 200).length, 1)
expect('...a outra é recusada (409/400)', both.some(x => x.s === 409 || x.s === 400), true)
r = await call('ti', 'GET', '/api/printer-supplies')
expect('...e o saldo fica 0 (não −1)', qty((r.j || []).find(s => s.id === drum.id), 'sede'), 0)
expect('...com 1 troca só no histórico', ((await call('ti', 'GET', `/api/printer-supplies/${drum.id}/movements`)).j || []).filter(m => m.kind === 'troca').length, 1)

// ── Editar e excluir ─────────────────────────────────────────────────────
r = await call('ti', 'PUT', `/api/printer-supplies/${toner.id}`, { name: 'Toner Ricoh SP377 preto (alto rendimento)', minimums: { g5: 1 } })
expect('edita nome e mínimo do G5', `${r.j?.name}|${r.j?.stocks?.g5?.min_quantity}|${r.j?.stocks?.sede?.min_quantity}`, 'Toner Ricoh SP377 preto (alto rendimento)|1|2')
expect('Analista não apaga do catálogo', (await call('ti', 'DELETE', `/api/printer-supplies/${toner.id}`)).s, 403)
r = await call('admin', 'DELETE', `/api/printer-supplies/${toner.id}`)
expect('Super Admin: item com histórico só é desativado', r.j?.deactivated, true)
expect('...e some da lista', ((await call('ti', 'GET', '/api/printer-supplies')).j || []).some(s => s.id === toner.id), false)
expect('...mas o histórico continua na exportação (7 do toner + 2 do cilindro)', (await call('admin', 'GET', '/api/printer-supplies/export')).j?.movements?.length, 9)

console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)

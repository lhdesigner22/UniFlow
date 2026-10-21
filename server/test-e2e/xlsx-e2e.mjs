// E2E das planilhas XLSX: roda client/src/utils/exports.js no Node (a API
// aponta pro servidor de teste), captura o .xlsx que seria baixado e confere
// o conteúdo reabrindo com ExcelJS.
//   cd server && node test-e2e/node-server.mjs
//   node test-e2e/xlsx-e2e.mjs [pasta-pra-salvar-os-arquivos]
import { registerHooks, createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SignJWT } from 'jose'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.resolve(here, '../../client')
const BASE = 'http://127.0.0.1:8799'
const outDir = process.argv[2]
const token = await new SignJWT({ id: 'u-test', name: 'u-test', email: 'teste@colegioser.com', tv: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode('testsecret'))
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const post = async (p, body) => (await fetch(BASE + '/api' + p, { method: 'POST', headers: H, body: JSON.stringify(body) })).json()

// Stubs: services/api (axios) → fetch no servidor de teste; authStore → usuário fixo
const apiStub = `export default { get: async (url, { params } = {}) => {
  const qs = new URLSearchParams(params || {}).toString()
  const r = await fetch('${BASE}/api' + url + (qs ? '?' + qs : ''), { headers: ${JSON.stringify(H)} })
  return { data: await r.json() }
} }`
const authStub = `export const useAuthStore = { getState: () => ({ user: { name: 'Luiz Sanchez' } }) }`
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.endsWith('/services/api')) return { url: 'stub:api', shortCircuit: true }
    if (spec.endsWith('/store/authStore')) return { url: 'stub:auth', shortCircuit: true }
    if (spec.startsWith('./') && !path.extname(spec) && ctx.parentURL?.includes('/client/src/')) return next(spec + '.js', ctx) // imports do Vite sem extensão
    return next(spec, ctx)
  },
  load(url, ctx, next) {
    if (url === 'stub:api') return { format: 'module', source: apiStub, shortCircuit: true }
    if (url === 'stub:auth') return { format: 'module', source: authStub, shortCircuit: true }
    return next(url, ctx)
  },
})

// "Download" do navegador → guarda o arquivo
const files = {}
let lastBlob = null
globalThis.document = {
  createElement: () => ({ set download(n) { files[n] = lastBlob }, click() {}, remove() {} }),
  body: { appendChild() {} },
}
URL.createObjectURL = blob => { lastBlob = blob; return 'blob:test' }
URL.revokeObjectURL = () => {}

let ok = true
const expect = (name, got, want) => { const pass = got === want; ok &&= pass; console.log(`${pass ? 'OK   ' : 'FALHA'}  ${name}  (${JSON.stringify(got)}${pass ? '' : ', esperado ' + JSON.stringify(want)})`) }

// ── Dados ────────────────────────────────────────────────────────────────
await post('/equipment-loans', { requester_name: 'Ana Souza', requester_email: 'ana@fecaf.com.br', equipment_model: 'Chromebook', patrimony: 'PAT-001', building: 'sede', location: 'Sala 12' })
await post('/equipment-loans', { requester_name: 'Bruno Lima', equipment_model: 'Projetor', building: 'g5', status: 'devolvido' })
await post('/equipment-loans', { requester_name: '=CMD()', equipment_model: 'Chromebook', building: 'centro', notes: '+fórmula' })
const month = new Date().toISOString().slice(0, 7)
await post('/purchase-requests', { item_name: 'Mouse USB', quantity: 10, unit_price: 35.9, approver_ids: ['u-ana'], reference_month: month, link_url: 'https://loja.exemplo.com/mouse' })
await post('/purchase-requests', { item_name: 'Monitor 24"', quantity: 2, unit_price: 899.99, approver_ids: ['u-ana'], reference_month: month })
const board = await post('/boards', { name: 'Quadro Planilha' })
const cols = (await (await fetch(`${BASE}/api/boards/${board.id}`, { headers: H })).json()).columns
const card = await post(`/boards/${board.id}/cards`, { title: 'Instalar impressoras', column_id: cols[0].id })
const today = new Date().toISOString().slice(0, 10)
await post(`/cards/${card.id}/time`, { duration_seconds: 5400, note: 'Sede', date: today })
await post(`/cards/${card.id}/time`, { duration_seconds: 2700, note: 'G5', date: today })

const { exportTimeXlsx, exportPurchasesXlsx, exportLoansXlsx } = await import(pathToFileURL(path.join(clientDir, 'src/utils/exports.js')).href)
const ExcelJS = createRequire(path.join(clientDir, 'package.json'))('exceljs')
const open = async name => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await files[name].arrayBuffer()); return wb }

// ── Empréstimos ──────────────────────────────────────────────────────────
await exportLoansXlsx()
let wb = await open('emprestimo-equipamentos.xlsx')
expect('Empréstimos: abas', wb.worksheets.map(w => w.name).join(' | '), 'Empréstimos | Resumo por prédio | Por equipamento')
let ws = wb.getWorksheet('Empréstimos')
expect('título na A1', ws.getCell('A1').value, 'Empréstimo de equipamentos')
expect('"Gerado em ... por" na A3', /^Gerado pelo UniFlow em .+ por Luiz Sanchez$/.test(ws.getCell('A3').value), true)
expect('cabeçalho azul com texto branco', `${ws.getCell('A5').fill.fgColor.argb} ${ws.getCell('A5').font.color.argb}`, 'FF3B82F6 FFFFFFFF')
expect('cabeçalho congelado', ws.views[0].state === 'frozen' && ws.views[0].ySplit === 5, true)
expect('filtro no cabeçalho', !!ws.autoFilter, true)
expect('data como data de verdade', ws.getCell('A6').value instanceof Date && ws.getCell('A6').numFmt === 'dd/mm/yyyy', true)
const names = [6, 7, 8].map(r => ws.getCell(`B${r}`).value)
expect('texto "=CMD()" fica texto (não vira fórmula)', names.includes('=CMD()') && ![6, 7, 8].some(r => typeof ws.getCell(`B${r}`).value === 'object'), true)
const statusCell = [6, 7, 8].map(r => ws.getCell(`H${r}`)).find(c => c.value === 'Devolvido')
expect('situação colorida (Devolvido = verde)', statusCell?.fill?.fgColor?.argb, 'FFDCFCE7')
expect('total conta com SUBTOTAL', ws.getCell('H9').value?.formula, 'SUBTOTAL(103,H6:H8)')
ws = wb.getWorksheet('Resumo por prédio')
expect('resumo: 3 prédios + total', `${ws.getCell('A6').value},${ws.getCell('A7').value},${ws.getCell('A8').value} total=${ws.getCell('E9').value?.result}`, 'CENTRO,G5,SEDE total=3')

// ── Compras ──────────────────────────────────────────────────────────────
await exportPurchasesXlsx({ month })
wb = await open(`solicitacoes-compra-${month}.xlsx`)
ws = wb.getWorksheet('Solicitações')
expect('Compras: subtítulo com o mês', /^Mês de referência: /.test(ws.getCell('A2').value), true)
const money = ws.getColumn(9)
expect('valor total em R$', ws.getCell('I6').numFmt, '"R$" #,##0.00')
expect('valor total é número', typeof ws.getCell('I6').value, 'number')
expect('soma do valor total', Math.round(ws.getCell('I8').value?.result * 100) / 100, Math.round((10 * 35.9 + 2 * 899.99) * 100) / 100)
expect('soma da quantidade', ws.getCell('G8').value?.result, 12)
const link = [6, 7].map(r => ws.getCell(`L${r}`).value).find(v => v && v.hyperlink)
expect('link clicável', link?.hyperlink, 'https://loja.exemplo.com/mouse')
expect('aprovadores com decisão', [6, 7].map(r => ws.getCell(`K${r}`).value).every(v => /\(pendente\)/.test(v)), true)
expect('Compras: abas de resumo', wb.worksheets.map(w => w.name).join(' | '), 'Solicitações | Por status | Por mês')
void money

// ── Tempo ────────────────────────────────────────────────────────────────
await exportTimeXlsx({ from: today, to: today, boardId: board.id, boardName: 'Quadro Planilha' })
wb = await open(`tempo-equipe-${today}-a-${today}.xlsx`)
ws = wb.getWorksheet('Lançamentos')
expect('Tempo: duração em [h]:mm', ws.getCell('E6').numFmt, '[h]:mm')
// (ao reabrir, o ExcelJS devolve célula com formato de hora como Date — volta pro número de série do Excel)
const serial = v => (v instanceof Date ? (v.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : v)
expect('Tempo: total = 2h15 (fração de dia)', Math.round(serial(ws.getCell('E8').value?.result) * 86400), 8100)
expect('Tempo: 1º lançamento = 1h30', Math.round(serial(ws.getCell('E6').value) * 86400), 5400)
expect('Tempo: subtítulo com período e quadro', /Quadro: Quadro Planilha/.test(ws.getCell('A2').value), true)
ws = wb.getWorksheet('Por pessoa')
expect('Por pessoa: 2 lançamentos', ws.getCell('B6').value, 2)

// ── Incidentes Laboratórios ──────────────────────────────────────────────
await post('/lab-incidents', { building: 'sede', lab: 'Laboratório 3', category: 'projecao', severity: 'critica', title: 'TV sem sinal', occurred_at: '2026-10-21T19:40' })
const { exportLabIncidentsXlsx } = await import(pathToFileURL(path.join(clientDir, 'src/utils/exports.js')).href)
await exportLabIncidentsXlsx({ building: 'sede' })
wb = await open('incidentes-laboratorios-sede.xlsx')
expect('Incidentes: abas', wb.worksheets.map(w => w.name).join(' | '), 'Incidentes | Por laboratório | Por tipo')
ws = wb.getWorksheet('Incidentes')
const occ = ws.getCell('A6').value
expect('data/hora da ocorrência no horário de Brasília', occ instanceof Date && occ.toISOString().slice(0, 16), '2026-10-21T19:40')
expect('gravidade crítica em vermelho', ws.getCell('E6').fill?.fgColor?.argb, 'FFFEE2E2')
expect('situação "Aberto"', ws.getCell('N6').value, 'Aberto')

if (outDir) for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(outDir, n), Buffer.from(await b.arrayBuffer()))
console.log(ok ? '\nTUDO OK' : '\nHOUVE FALHAS')
process.exit(ok ? 0 : 1)

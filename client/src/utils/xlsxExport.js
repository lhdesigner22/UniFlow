// Planilhas XLSX das exportações (Tempo, Compras, Empréstimos), montadas no
// navegador com ExcelJS — o Worker (plano Free, ~10 ms de CPU) não aguentaria
// gerar o arquivo. O servidor só manda os dados (`/export?format=json`).
// A biblioteca é carregada sob demanda (import dinâmico): não pesa no app.
//
// Padrão visual de todas: título + subtítulo + "Gerado em", cabeçalho azul do
// UniFlow, linhas zebradas, filtro e cabeçalho congelado, números de verdade
// (R$, horas somáveis em [h]:mm, datas), linha de total com SUBTOTAL (respeita
// o filtro), situação colorida, impressão em paisagem ajustada à largura.

const BRAND = 'FF3B82F6'
const BRAND_DARK = 'FF1E3A8A'
const HEADER_TEXT = 'FFFFFFFF'
const ZEBRA = 'FFF5F8FC'
const BORDER = 'FFD9E1EC'
const TOTAL_FILL = 'FFE8F0FE'
const MUTED = 'FF64748B'

const FORMATS = {
  text: '@',
  int: '#,##0',
  money: '"R$" #,##0.00',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
  duration: '[h]:mm',
  month: 'mmm/yyyy',
}

// Cor de fundo/texto por valor (situação/status) — mesmas cores da tela.
export const BADGES = {
  green: { fill: 'FFDCFCE7', font: 'FF166534' },
  yellow: { fill: 'FFFEF9C3', font: 'FF854D0E' },
  red: { fill: 'FFFEE2E2', font: 'FF991B1B' },
  blue: { fill: 'FFDBEAFE', font: 'FF1E40AF' },
  purple: { fill: 'FFEDE9FE', font: 'FF5B21B6' },
  gray: { fill: 'FFF1F5F9', font: 'FF334155' },
}

// Excel não tem fuso: grava o horário LOCAL (Brasília) como se fosse UTC, que é
// como o ExcelJS converte Date → número de série.
function asExcelLocal(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()))
}
// 'YYYY-MM-DD HH:MM:SS' (UTC, do banco) ou ISO → Date pronta pro Excel
export function dbDateTime(v) {
  if (!v) return null
  const s = String(v)
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z')
  return isNaN(d) ? null : asExcelLocal(d)
}
// 'YYYY-MM-DD' (data sem hora) → Date
export function dbDate(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
}
// 'YYYY-MM' → 1º dia do mês
export function dbMonth(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})/)
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)) : null
}
// segundos → fração de dia (é assim que o Excel guarda duração)
export const secondsToDays = s => (Number(s) || 0) / 86400

const colLetter = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const thin = { style: 'thin', color: { argb: BORDER } }
const allBorders = { top: thin, left: thin, bottom: thin, right: thin }

function safeSheetName(name) {
  return String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Planilha'
}

// Uma aba com tabela formatada.
//   columns: [{ header, key, width, type: text|int|money|date|datetime|duration|month|link, wrap, badge: valor→cor, total: 'sum'|'count'|label }]
//   rows: objetos com as chaves de `columns` (já convertidos: Date, número...)
function addTableSheet(wb, { name, title, subtitle, columns, rows, totalLabel = 'Total', meta, tabColor }) {
  const ws = wb.addWorksheet(safeSheetName(name), {
    properties: { tabColor: { argb: tabColor || BRAND } },
    views: [{ state: 'frozen', ySplit: 5, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
    headerFooter: { oddFooter: `&L&8UniFlow — ${String(title).replace(/&/g, '&&')}&R&8Página &P de &N` },
  })
  const last = colLetter(columns.length)
  ws.columns = columns.map(c => ({ key: c.key, width: c.width || 16 }))

  // Linhas 1–3: título, subtítulo, gerado em
  ws.mergeCells(`A1:${last}1`)
  ws.getCell('A1').value = title
  ws.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: BRAND_DARK } }
  ws.getRow(1).height = 26
  ws.mergeCells(`A2:${last}2`)
  ws.getCell('A2').value = subtitle || ''
  ws.getCell('A2').font = { name: 'Calibri', size: 11, color: { argb: MUTED } }
  ws.mergeCells(`A3:${last}3`)
  ws.getCell('A3').value = meta
  ws.getCell('A3').font = { name: 'Calibri', size: 9, italic: true, color: { argb: MUTED } }

  // Linha 5: cabeçalho
  const HEADER_ROW = 5
  const header = ws.getRow(HEADER_ROW)
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: HEADER_TEXT } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
    cell.alignment = { vertical: 'middle', horizontal: ['money', 'int', 'duration'].includes(c.type) ? 'right' : 'left', wrapText: true }
    cell.border = allBorders
  })
  header.height = 24

  // Dados
  rows.forEach((r, idx) => {
    const row = ws.getRow(HEADER_ROW + 1 + idx)
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      let v = r[c.key]
      if (c.type === 'link') {
        const url = typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null
        cell.value = url ? { text: 'Abrir', hyperlink: url, tooltip: url } : (v || null)
        if (url) cell.font = { color: { argb: BRAND }, underline: true }
      } else {
        if (v === undefined || v === '') v = null
        cell.value = v
        if (FORMATS[c.type] && c.type !== 'text') cell.numFmt = FORMATS[c.type]
      }
      cell.alignment = { vertical: 'top', wrapText: !!c.wrap, horizontal: ['money', 'int', 'duration'].includes(c.type) ? 'right' : (c.badge ? 'center' : 'left') }
      cell.border = allBorders
      const badge = c.badge && v != null ? BADGES[c.badge[v]] : null
      if (badge) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: badge.fill } }
        cell.font = { bold: true, color: { argb: badge.font } }
      } else if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } }
      }
    })
  })

  const firstData = HEADER_ROW + 1
  const lastData = HEADER_ROW + rows.length
  if (rows.length) ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: lastData, column: columns.length } }

  // Total (SUBTOTAL 109/103: soma/conta só o que está visível no filtro)
  if (columns.some(c => c.total) && rows.length) {
    const row = ws.getRow(lastData + 1)
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      const L = colLetter(i + 1)
      if (c.total === 'sum') {
        const result = rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0)
        cell.value = { formula: `SUBTOTAL(109,${L}${firstData}:${L}${lastData})`, result }
        if (FORMATS[c.type]) cell.numFmt = FORMATS[c.type]
      } else if (c.total === 'count') {
        cell.value = { formula: `SUBTOTAL(103,${L}${firstData}:${L}${lastData})`, result: rows.length }
      } else if (i === 0) {
        cell.value = totalLabel
      }
      cell.font = { bold: true, color: { argb: BRAND_DARK } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }
      cell.border = { ...allBorders, top: { style: 'medium', color: { argb: BRAND } } }
      cell.alignment = { horizontal: ['money', 'int', 'duration'].includes(c.type) || c.total === 'count' ? 'right' : 'left' }
    })
    row.height = 20
  }

  if (!rows.length) {
    ws.mergeCells(`A${firstData}:${last}${firstData}`)
    ws.getCell(`A${firstData}`).value = 'Nenhum registro no período/filtro escolhido.'
    ws.getCell(`A${firstData}`).font = { italic: true, color: { argb: MUTED } }
  }

  ws.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`
  return ws
}

// Agrupa linhas e soma — pras abas de resumo.
export function groupSum(rows, keyFn, sums = {}) {
  const map = new Map()
  for (const r of rows) {
    const k = keyFn(r) ?? '—'
    const g = map.get(k) || { key: k, count: 0, ...Object.fromEntries(Object.keys(sums).map(s => [s, 0])) }
    g.count++
    for (const [s, fn] of Object.entries(sums)) g[s] += Number(fn(r)) || 0
    map.set(k, g)
  }
  return [...map.values()]
}

// Monta e baixa. `sheets`: lista de abas (ver addTableSheet). A primeira é a principal.
export async function downloadXlsx({ fileName, title, subtitle, sheets, author }) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = author ? `UniFlow — ${author}` : 'UniFlow'
  wb.created = new Date()
  wb.title = title
  const generated = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const meta = `Gerado pelo UniFlow em ${generated}${author ? ` por ${author}` : ''}`
  for (const s of sheets) addTableSheet(wb, { title: s.title || title, subtitle: s.subtitle ?? subtitle, meta, ...s })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

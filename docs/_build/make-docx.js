// Converte a documentação em Markdown (docs/*.md) num único .docx
// ("UniFlow - Documentacao Tecnica.docx", gerado na raiz do repo).
// Parser propositalmente simples — cobre só os construtos usados nesses
// arquivos (headers, **bold**, `code`, links [texto](url), listas com
// "- "/"1. ", tabelas "|", blocos ```), não é um parser de Markdown genérico.
//
// Rodar de novo depois de editar algum docs/*.md:
//   cd docs/_build && npm install docx && node make-docx.js
// (docx não é dependência do projeto, só dessa ferramenta pontual — mesmo
// padrão do scripts/gen-icons.mjs em client/.)
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, PageBreak, AlignmentType, TableOfContents,
  LevelFormat, convertInchesToTwip, ExternalHyperlink,
} = require('docx')

const ROOT = path.join(__dirname, '..')
const REPO_ROOT = path.join(__dirname, '..', '..')
const BRAND = '2563EB'
const TEXT_MUTED = '5B6B8C'
const CODE_BG = 'F1F3F9'
const BORDER_GRAY = 'D9DEE8'

// ── Inline parsing (**bold**, `code`, [texto](url)) → array de TextRun/ExternalHyperlink ──
function parseInline(text) {
  const runs = []
  const re = /(\*\*.+?\*\*|`[^`]+?`|\[[^\]]+?\]\([^)]+?\))/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push(new TextRun(text.slice(last, m.index)))
    const token = m[0]
    if (token.startsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }))
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      runs.push(new ExternalHyperlink({
        link: linkMatch[2],
        children: [new TextRun({ text: linkMatch[1], style: 'Hyperlink' })],
      }))
    } else {
      runs.push(new TextRun({
        text: token.slice(1, -1), font: 'Consolas', size: 20,
        shading: { type: ShadingType.CLEAR, fill: CODE_BG },
      }))
    }
    last = re.lastIndex
  }
  if (last < text.length) runs.push(new TextRun(text.slice(last)))
  return runs.length ? runs : [new TextRun(text)]
}

let numberingCounter = 0
const numberingConfigs = []

function newNumberedRef() {
  const reference = `num-${numberingCounter++}`
  numberingConfigs.push({
    reference,
    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } } }],
  })
  return reference
}

// ── Parser de blocos ────────────────────────────────────────────────────
function parseMarkdown(md, { firstIsTitlePage = false } = {}) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const nodes = []
  let i = 0

  const joinWrapped = startIdx => {
    let text = lines[startIdx].trim()
    let j = startIdx + 1
    while (j < lines.length && lines[j].trim() !== '' && !isBlockStart(lines[j])) {
      text += ' ' + lines[j].trim()
      j++
    }
    return [text, j]
  }

  function isBlockStart(line) {
    const t = line.trim()
    return /^#{1,6}\s/.test(t) || /^```/.test(t) || /^-\s/.test(t) || /^\d+\.\s/.test(t) || /^\|/.test(t)
  }

  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trim()

    if (line === '') { i++; continue }

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) { codeLines.push(lines[i]); i++ }
      i++ // skip closing fence
      nodes.push({ type: 'code', lines: codeLines })
      continue
    }

    // Heading
    const hMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (hMatch) {
      nodes.push({ type: 'heading', level: hMatch[1].length, text: hMatch[2] })
      i++
      continue
    }

    // Table
    if (line.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim()); i++ }
      const cells = rows.map(r => r.slice(1, -1).split('|').map(c => c.trim()))
      const header = cells[0]
      const body = cells.slice(2) // skip separator row
      nodes.push({ type: 'table', header, body })
      continue
    }

    // Bullet list
    if (/^-\s/.test(line)) {
      const items = []
      while (i < lines.length && /^-\s/.test(lines[i].trim())) {
        const [text, next] = joinWrapped(i)
        items.push(text.replace(/^-\s/, ''))
        i = next
      }
      nodes.push({ type: 'bullets', items })
      continue
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      const items = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        const [text, next] = joinWrapped(i)
        items.push(text.replace(/^\d+\.\s/, ''))
        i = next
      }
      nodes.push({ type: 'numbered', items })
      continue
    }

    // Paragraph
    {
      const [text, next] = joinWrapped(i)
      nodes.push({ type: 'p', text })
      i = next
    }
  }
  return nodes
}

function headingStyle(level) {
  return [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][level - 1]
}

function headerCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: BRAND },
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20 })] })],
  })
}
function bodyCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
    children: [new Paragraph({ children: parseInline(text) })],
  })
}

function nodesToDocxChildren(nodes) {
  const children = []
  for (const node of nodes) {
    if (node.type === 'heading') {
      children.push(new Paragraph({
        heading: headingStyle(node.level),
        spacing: { before: node.level === 1 ? 100 : 260, after: 140 },
        children: parseInline(node.text),
      }))
    } else if (node.type === 'p') {
      children.push(new Paragraph({ spacing: { after: 160 }, children: parseInline(node.text) }))
    } else if (node.type === 'bullets') {
      for (const item of node.items) {
        children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: parseInline(item) }))
      }
    } else if (node.type === 'numbered') {
      const ref = newNumberedRef()
      for (const item of node.items) {
        children.push(new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 80 }, children: parseInline(item) }))
      }
    } else if (node.type === 'code') {
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
          left: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
          right: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
        },
        rows: [new TableRow({ children: [new TableCell({
          shading: { type: ShadingType.CLEAR, fill: CODE_BG },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: (node.lines.length ? node.lines : ['']).map(l => new Paragraph({
            spacing: { after: 0 },
            children: [new TextRun({ text: l.length ? l : ' ', font: 'Consolas', size: 18 })],
          })),
        })] })],
      }))
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }))
    } else if (node.type === 'table') {
      const nCols = node.header.length
      const totalWidth = 9350
      const colWidth = Math.floor(totalWidth / nCols)
      const colWidths = Array(nCols).fill(colWidth)
      children.push(new Table({
        width: { size: totalWidth, type: WidthType.DXA },
        columnWidths: colWidths,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
          left: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
          right: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
          insideVertical: { style: BorderStyle.SINGLE, size: 2, color: BORDER_GRAY },
        },
        rows: [
          new TableRow({ tableHeader: true, children: node.header.map((h, idx) => headerCell(h, colWidths[idx])) }),
          ...node.body.map(row => new TableRow({ children: row.map((c, idx) => bodyCell(c, colWidths[idx])) })),
        ],
      }))
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }))
    }
  }
  return children
}

// ── Monta o documento ───────────────────────────────────────────────────
const files = [
  '_build/00-intro.md',
  'ARQUITETURA.md',
  'BANCO_DE_DADOS.md',
  'FUNCIONALIDADES.md',
  'INTEGRACOES.md',
  'DEPLOY.md',
  'LICOES_APRENDIDAS.md',
]

let body = []

// Capa
body.push(
  new Paragraph({ spacing: { before: 2400, after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'UniFlow', bold: true, size: 72, color: BRAND })] }),
  new Paragraph({ spacing: { after: 600 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Documentação Técnica do Projeto', size: 32, color: TEXT_MUTED })] }),
  new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Colégio SER / UniFECAF — TI', size: 24, color: TEXT_MUTED })] }),
  new Paragraph({ spacing: { after: 3200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: new Date().toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' }), size: 22, color: TEXT_MUTED })] }),
  new Paragraph({ children: [new PageBreak()] }),
)

// Sumário
body.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 120 }, children: [new TextRun('Sumário')] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({
    text: 'Se a lista abaixo aparecer em branco, clique nela com o botão direito e escolha "Atualizar campo" (ou selecione tudo e aperte F9).',
    italics: true, size: 20, color: TEXT_MUTED,
  })] }),
  new TableOfContents('Sumário', { hyperlink: true, headingStyleRange: '1-3' }),
  new Paragraph({ children: [new PageBreak()] }),
)

files.forEach((file, idx) => {
  const md = fs.readFileSync(path.join(ROOT, file), 'utf-8')
  const nodes = parseMarkdown(md)
  if (idx > 0) body.push(new Paragraph({ children: [new PageBreak()] }))
  body.push(...nodesToDocxChildren(nodes))
})

const doc = new Document({
  creator: 'UniFlow',
  title: 'UniFlow — Documentação Técnica',
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22 } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 34, bold: true, color: BRAND, font: 'Calibri' },
        paragraph: { spacing: { before: 100, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 27, bold: true, color: '1F2937', font: 'Calibri' },
        paragraph: { spacing: { before: 260, after: 120 } } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, color: '374151', font: 'Calibri' },
        paragraph: { spacing: { before: 200, after: 100 } } },
    ],
  },
  numbering: { config: numberingConfigs },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
      },
    },
    children: body,
  }],
})

Packer.toBuffer(doc).then(buf => {
  const out = path.join(REPO_ROOT, 'UniFlow - Documentacao Tecnica.docx')
  fs.writeFileSync(out, buf)
  console.log('wrote', out)
})

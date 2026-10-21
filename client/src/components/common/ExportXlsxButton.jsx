import { useState } from 'react'
import { alertDialog } from '../../store/dialogStore'

// Botão "Exportar Excel" das telas com exportação (ver utils/exports.js).
// `onExport` busca os dados e baixa o .xlsx — pode levar uns segundos na 1ª vez
// (carrega a biblioteca da planilha), por isso o "Gerando...".
export default function ExportXlsxButton({ onExport, label = 'Exportar Excel', className = 'btn btn-ghost' }) {
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      await onExport()
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Não deu pra gerar a planilha. Tenta de novo?', { title: 'Erro ao exportar', danger: true })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className={className} onClick={run} disabled={busy} title="Baixar planilha do Excel (.xlsx)">
      {busy ? 'Gerando planilha...' : `📊 ${label}`}
    </button>
  )
}

import { useState, useEffect, useMemo } from 'react'
import api from '../../services/api'
import Modal from './Modal'

// Histórico de trocas de insumo de UMA impressora (aberto pelo cartão em
// Impressoras): o que foi trocado, quando, por quem, e de quanto em quanto
// tempo cada insumo costuma ser trocado nela.
const fmt = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '—' }
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000

export default function PrinterSupplyHistory({ printer, onClose }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { api.get(`/printer-supplies/printer/${printer.id}`).then(r => setRows(r.data || [])).catch(() => setRows([])) }, [printer.id])

  // Intervalo médio entre trocas do mesmo insumo (precisa de 2+ trocas)
  const intervals = useMemo(() => {
    const by = {}
    for (const r of rows || []) (by[r.supply_name] ||= []).push(r.happened_at)
    return Object.entries(by).map(([name, dates]) => {
      const sorted = dates.slice().sort()
      const avg = sorted.length > 1 ? days(sorted[sorted.length - 1], sorted[0]) / (sorted.length - 1) : null
      return { name, count: sorted.length, avg, last: sorted[sorted.length - 1] }
    })
  }, [rows])

  return (
    <Modal title={`Insumos — ${printer.model}${printer.department ? ` (${printer.department})` : ''}`} onClose={onClose} width={680}>
      {!rows ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando...</p> : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nenhuma troca de insumo registrada nesta impressora ainda. As trocas são registradas em Impressoras → Estoque de insumos (botão 🔄).</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {intervals.map(i => (
              <div key={i.name} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--surface-2)', fontSize: 12.5 }}>
                <strong>{i.name}</strong><br />
                <span style={{ color: 'var(--text-muted)' }}>
                  {i.count} troca(s){i.avg != null ? ` · a cada ~${Math.round(i.avg)} dias` : ''} · última {fmt(i.last).slice(0, 10)}
                  {i.avg != null ? ` · próxima ~${new Date(Date.parse(i.last) + i.avg * 86400000).toLocaleDateString('pt-BR')}` : ''}
                </span>
              </div>
            ))}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}><th style={{ padding: 6 }}>Quando</th><th style={{ padding: 6 }}>Insumo</th><th style={{ padding: 6 }}>Qtd</th><th style={{ padding: 6 }}>Quem</th><th style={{ padding: 6 }}>Obs.</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border2)' }}>
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{fmt(r.happened_at)}</td>
                  <td style={{ padding: 6 }}>{r.supply_name}</td>
                  <td style={{ padding: 6 }}>{-r.delta}</td>
                  <td style={{ padding: 6 }}>{r.user_name || '—'}</td>
                  <td style={{ padding: 6, color: 'var(--text-muted)' }}>{r.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

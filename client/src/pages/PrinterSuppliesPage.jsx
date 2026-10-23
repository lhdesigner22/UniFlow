import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { exportPrinterSuppliesXlsx } from '../utils/exports'
import ExportXlsxButton from '../components/common/ExportXlsxButton'
import Modal from '../components/common/Modal'
import s from './PrinterSuppliesPage.module.css'

// Impressoras → Estoque de insumos: saldo POR PRÉDIO de toner, cilindro, tinta...
// Cada troca fica ligada à impressora (dá o consumo e a previsão de quando
// acaba). Servidor: server/src/routes/printerSupplies.js.

export const SUPPLY_LOCATIONS = [
  { key: 'sede', label: 'SEDE' }, { key: 'adm', label: 'ADM' }, { key: 'centro', label: 'CENTRO' },
  { key: 'g5', label: 'G5' }, { key: 'clinicas', label: 'CLÍNICAS' },
]
const LOC_LABEL = Object.fromEntries(SUPPLY_LOCATIONS.map(l => [l.key, l.label]))
export const SUPPLY_TYPES = {
  toner: '🖨️ Toner', cilindro: '🥁 Cilindro / fotocondutor', tinta: '💧 Tinta (garrafa)', cartucho: '🧴 Cartucho',
  fusor: '🔥 Fusor', residuo: '🗑️ Caixa de resíduo', kit: '🧰 Kit de manutenção', outro: '📦 Outro',
}
const COLORS = { '': '—', preto: 'Preto', ciano: 'Ciano', magenta: 'Magenta', amarelo: 'Amarelo', colorido: 'Colorido' }
const COLOR_DOT = { preto: '#111827', ciano: '#06B6D4', magenta: '#DB2777', amarelo: '#EAB308', colorido: 'conic-gradient(#06B6D4, #DB2777, #EAB308, #06B6D4)' }
const KIND_LABEL = {
  entrada: '➕ Entrada', troca: '🔄 Troca', transferencia_saida: '⇄ Transferido para', transferencia_entrada: '⇄ Recebido de', ajuste: '✎ Ajuste',
}

const pad = n => String(n).padStart(2, '0')
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
export const fmtWhen = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '—' }

// Consumo por mês (trocas dos últimos 90 dias ÷ 3) e quantos meses o saldo dura
function forecast(supply, loc) {
  const used = supply.usage90?.[loc] || 0
  const perMonth = used / 3
  const qty = supply.stocks?.[loc]?.quantity || 0
  return { perMonth, months: perMonth > 0 ? qty / perMonth : null }
}
const isLow = (supply, loc) => { const st = supply.stocks?.[loc]; return !!st && st.min_quantity > 0 && st.quantity <= st.min_quantity }

function ColorDot({ color }) {
  if (!color) return null
  return <span className={s.colorDot} style={{ background: COLOR_DOT[color] }} title={COLORS[color]} />
}

// ── Cadastro do insumo ─────────────────────────────────────────────────────
function SupplyEditor({ supply, knownModels, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: supply?.name || '', code: supply?.code || '', type: supply?.type || 'toner', color: supply?.color || '',
    notes: supply?.notes || '', models: supply?.models || [],
    minimums: Object.fromEntries(SUPPLY_LOCATIONS.map(l => [l.key, supply?.stocks?.[l.key]?.min_quantity ?? 0])),
  })
  const [newModel, setNewModel] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleModel = m => set('models', form.models.includes(m) ? form.models.filter(x => x !== m) : [...form.models, m])
  const allModels = [...new Set([...knownModels, ...form.models])].sort((a, b) => a.localeCompare(b, 'pt-BR'))

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true); setError('')
    try {
      const { data } = supply ? await api.put(`/printer-supplies/${supply.id}`, form) : await api.post('/printer-supplies', form)
      onSaved(data)
    } catch (e) { setError(e.response?.data?.error || 'Erro ao salvar.'); setSaving(false) }
  }

  return (
    <Modal title={supply ? 'Editar insumo' : 'Novo insumo'} onClose={onClose} width={620}>
      <div className="form-group">
        <label className="label">Nome *</label>
        <input autoFocus value={form.name} maxLength={120} onChange={e => set('name', e.target.value)} placeholder="Ex: Toner Ricoh SP 377 preto" />
      </div>
      <div className={s.formGrid3}>
        <div className="form-group">
          <label className="label">Tipo</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}>
            {Object.entries(SUPPLY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Cor</label>
          <select value={form.color} onChange={e => set('color', e.target.value)}>
            {Object.entries(COLORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Código / part number</label>
          <input value={form.code} maxLength={60} onChange={e => set('code', e.target.value)} placeholder="Ex: 408161" />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Serve nas impressoras (modelos)</label>
        <div className={s.modelChips}>
          {allModels.map(m => (
            <button key={m} type="button" className={`${s.modelChip} ${form.models.includes(m) ? s.modelChipOn : ''}`} onClick={() => toggleModel(m)}>
              {form.models.includes(m) ? '✓ ' : ''}{m}
            </button>
          ))}
        </div>
        <div className={s.inlineRow}>
          <input value={newModel} onChange={e => setNewModel(e.target.value)} placeholder="Outro modelo..." onKeyDown={e => { if (e.key === 'Enter' && newModel.trim()) { set('models', [...form.models, newModel.trim()]); setNewModel('') } }} />
          <button type="button" className="btn btn-ghost btn-sm" disabled={!newModel.trim()} onClick={() => { set('models', [...form.models, newModel.trim()]); setNewModel('') }}>+ Adicionar</button>
        </div>
      </div>
      <div className="form-group">
        <label className="label">Estoque mínimo por prédio (avisa quando chegar nele)</label>
        <div className={s.minGrid}>
          {SUPPLY_LOCATIONS.map(l => (
            <label key={l.key} className={s.minCell}>
              <span>{l.label}</span>
              <input type="number" min={0} max={10000} value={form.minimums[l.key]} onChange={e => set('minimums', { ...form.minimums, [l.key]: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} />
            </label>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label className="label">Observações</label>
        <textarea rows={2} value={form.notes} maxLength={1000} onChange={e => set('notes', e.target.value)} placeholder="Fornecedor, rendimento (páginas), onde fica guardado..." />
      </div>
      {error && <p className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.name.trim() || saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
    </Modal>
  )
}

// ── Movimento (entrada, troca, transferência, ajuste) ──────────────────────
const MOVE_TITLES = { entrada: '➕ Entrada no estoque', troca: '🔄 Troca na impressora', transferencia: '⇄ Transferir para outro prédio', ajuste: '✎ Ajustar saldo (contagem)' }

function MovementModal({ supply, location, kind, printers, onClose, onSaved }) {
  const current = supply.stocks?.[location]?.quantity || 0
  const here = printers.filter(p => p.location === location)
  const norm = m => String(m || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const fits = p => supply.models.some(m => norm(m) === norm(p.model))
  const compatible = here.filter(fits)
  const others = here.filter(p => !fits(p))
  const [form, setForm] = useState({
    quantity: kind === 'ajuste' ? current : 1,
    printer_id: compatible.length === 1 ? compatible[0].id : '',
    to_location: SUPPLY_LOCATIONS.find(l => l.key !== location)?.key,
    happened_at: nowLocal(), note: '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const qty = Number(form.quantity)
  const tooMuch = (kind === 'troca' || kind === 'transferencia') && qty > current
  const valid = Number.isInteger(qty) && qty >= (kind === 'ajuste' ? 0 : 1) && !tooMuch && (kind !== 'troca' || form.printer_id)

  const save = async () => {
    setSaving(true); setError('')
    try {
      const { data } = await api.post(`/printer-supplies/${supply.id}/movements`, { kind, location, ...form, quantity: qty })
      onSaved(data)
    } catch (e) { setError(e.response?.data?.error || 'Erro ao registrar.'); setSaving(false) }
  }
  const printerLabel = p => `${p.model}${p.department ? ` — ${p.department}` : ''}${p.ip ? ` (${p.ip})` : ''}`

  return (
    <Modal title={MOVE_TITLES[kind]} onClose={onClose} width={520}>
      <p className={s.moveHead}><ColorDot color={supply.color} /> <strong>{supply.name}</strong> · {LOC_LABEL[location]} · saldo atual <strong>{current}</strong></p>
      {kind === 'troca' && (
        <div className="form-group">
          <label className="label">Em qual impressora? *</label>
          <select value={form.printer_id} onChange={e => set('printer_id', e.target.value)}>
            <option value="">Escolha a impressora...</option>
            {compatible.length > 0 && <optgroup label="Compatíveis com este insumo">{compatible.map(p => <option key={p.id} value={p.id}>{printerLabel(p)}</option>)}</optgroup>}
            {others.length > 0 && <optgroup label={compatible.length ? 'Outras deste prédio' : 'Impressoras deste prédio'}>{others.map(p => <option key={p.id} value={p.id}>{printerLabel(p)}</option>)}</optgroup>}
          </select>
          {here.length === 0 && <p className={s.hint}>Nenhuma impressora cadastrada em {LOC_LABEL[location]}.</p>}
        </div>
      )}
      {kind === 'transferencia' && (
        <div className="form-group">
          <label className="label">Para qual prédio?</label>
          <select value={form.to_location} onChange={e => set('to_location', e.target.value)}>
            {SUPPLY_LOCATIONS.filter(l => l.key !== location).map(l => <option key={l.key} value={l.key}>{l.label} (saldo {supply.stocks?.[l.key]?.quantity || 0})</option>)}
          </select>
        </div>
      )}
      <div className={s.formGrid2}>
        <div className="form-group">
          <label className="label">{kind === 'ajuste' ? 'Quantidade contada (saldo real)' : 'Quantidade'}</label>
          <input type="number" min={kind === 'ajuste' ? 0 : 1} max={10000} value={form.quantity} onChange={e => set('quantity', e.target.value)} />
          {tooMuch && <p className={s.error}>Só tem {current} em {LOC_LABEL[location]}.</p>}
        </div>
        <div className="form-group">
          <label className="label">Quando</label>
          <input type="datetime-local" value={form.happened_at} onChange={e => set('happened_at', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Observação</label>
        <input value={form.note} maxLength={500} onChange={e => set('note', e.target.value)} placeholder={kind === 'entrada' ? 'Ex: NF 1234, fornecedor X' : kind === 'troca' ? 'Ex: contador 45.210 páginas, chamado #123' : 'Opcional'} />
      </div>
      {error && <p className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!valid || saving} onClick={save}>{saving ? 'Registrando...' : 'Registrar'}</button>
    </Modal>
  )
}

// ── Histórico do item no prédio ────────────────────────────────────────────
function HistoryModal({ supply, location, onClose }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { api.get(`/printer-supplies/${supply.id}/movements`, { params: { location } }).then(r => setRows(r.data || [])).catch(() => setRows([])) }, [supply.id, location])
  return (
    <Modal title={`Histórico — ${supply.name} (${LOC_LABEL[location]})`} onClose={onClose} width={720}>
      {!rows ? <p className={s.hint}>Carregando...</p> : rows.length === 0 ? <p className={s.hint}>Nenhuma movimentação ainda neste prédio.</p> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Quando</th><th>Movimento</th><th>Qtd</th><th>Saldo</th><th>Impressora / detalhe</th><th>Quem</th></tr></thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.id}>
                  <td className={s.mono}>{fmtWhen(m.happened_at)}</td>
                  <td>{KIND_LABEL[m.kind] || m.kind}{m.related_location ? ` ${LOC_LABEL[m.related_location]}` : ''}</td>
                  <td className={m.delta < 0 ? s.neg : s.pos}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                  <td className={s.mono}>{m.balance_after}</td>
                  <td>{m.printer_model ? `${m.printer_model}${m.printer_department ? ` — ${m.printer_department}` : ''}${m.printer_ip ? ` (${m.printer_ip})` : ''}` : ''}{m.note ? <span className={s.note}>{m.printer_model ? ' · ' : ''}{m.note}</span> : ''}</td>
                  <td>{m.user_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

export default function PrinterSuppliesPage() {
  const { location = 'sede' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [supplies, setSupplies] = useState(null)
  const [printers, setPrinters] = useState([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [editing, setEditing] = useState(null) // null | {} | supply
  const [moving, setMoving] = useState(null) // { supply, kind }
  const [history, setHistory] = useState(null) // supply
  const writable = canEditModule(user, 'printers')

  const load = () => api.get('/printer-supplies').then(r => setSupplies(r.data || [])).catch(() => setSupplies(prev => prev || []))
  useEffect(() => { load(); api.get('/printers').then(r => setPrinters(r.data || [])).catch(() => {}) }, [])
  useLiveRefresh(['printer-supplies'], () => load())

  const knownModels = useMemo(() => [...new Set(printers.map(p => p.model.replace(/\s+/g, ' ').trim()))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [printers])
  const lowByLoc = useMemo(() => Object.fromEntries(SUPPLY_LOCATIONS.map(l => [l.key, (supplies || []).filter(sp => isLow(sp, l.key)).length])), [supplies])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (supplies || []).filter(sp => {
      if (typeFilter && sp.type !== typeFilter) return false
      if (onlyLow && !isLow(sp, location)) return false
      if (q && ![sp.name, sp.code, sp.notes, ...sp.models].some(v => (v || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [supplies, search, typeFilter, onlyLow, location])
  const stats = useMemo(() => {
    const list = supplies || []
    return {
      units: list.reduce((a, sp) => a + (sp.stocks?.[location]?.quantity || 0), 0),
      low: lowByLoc[location] || 0,
      swaps: list.reduce((a, sp) => a + (sp.usage90?.[location] || 0), 0),
      items: list.length,
    }
  }, [supplies, location, lowByLoc])

  const upsert = sp => setSupplies(prev => (prev || []).some(x => x.id === sp.id) ? prev.map(x => (x.id === sp.id ? sp : x)) : [...(prev || []), sp])
  const remove = async sp => {
    if (!(await confirmDialog(`Remover "${sp.name}" do catálogo? Se já tiver histórico, ele é só desativado (o histórico fica).`, { title: 'Remover insumo' }))) return
    try { await api.delete(`/printer-supplies/${sp.id}`); setSupplies(prev => prev.filter(x => x.id !== sp.id)) }
    catch (e) { await alertDialog(e.response?.data?.error || 'Erro ao remover.', { title: 'Erro', danger: true }) }
  }

  if (!supplies) return <div className={s.loading}>Carregando estoque...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Estoque de insumos — {LOC_LABEL[location] || location.toUpperCase()}</h1>
          <p className={s.sub}>Toner, cilindro, tinta e demais insumos das impressoras: saldo por prédio, cada troca registrada na impressora e aviso quando chega no mínimo.</p>
        </div>
        <div className={s.headerActions}>
          <ExportXlsxButton onExport={() => exportPrinterSuppliesXlsx()} />
          {writable && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo insumo</button>}
        </div>
      </div>

      <div className={s.tabs}>
        {SUPPLY_LOCATIONS.map(l => (
          <button key={l.key} className={`${s.tab} ${l.key === location ? s.tabOn : ''}`} onClick={() => navigate(`/estoque-insumos/${l.key}`)}>
            {l.label}{lowByLoc[l.key] ? <span className={s.tabBadge}>{lowByLoc[l.key]}</span> : null}
          </button>
        ))}
      </div>

      <div className={s.stats}>
        <div className={s.stat}><strong>{stats.units}</strong><span>Unidades em estoque</span></div>
        <button className={`${s.stat} ${s.statWarn} ${onlyLow ? s.statOn : ''}`} onClick={() => setOnlyLow(v => !v)}><strong>{stats.low}</strong><span>No mínimo ou abaixo</span></button>
        <div className={s.stat}><strong>{stats.swaps}</strong><span>Trocas nos últimos 90 dias</span></div>
        <div className={s.stat}><strong>{stats.items}</strong><span>Itens no catálogo</span></div>
      </div>

      <div className={s.toolbar}>
        <input className={s.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por insumo, código ou modelo de impressora..." />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(SUPPLY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className={s.check}><input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} /> Só no mínimo / abaixo</label>
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>{supplies.length ? 'Nada com esse filtro' : 'Nenhum insumo cadastrado ainda'}</h3>
          <p>{supplies.length ? 'Mude o filtro ou a busca.' : 'Cadastre os insumos (toner, cilindro, tinta...) com os modelos em que servem e o estoque mínimo de cada prédio. Depois é só dar entrada e registrar as trocas.'}</p>
        </div>
      ) : (
        <div className={s.tableCard}>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr><th>Insumo</th><th>Tipo</th><th>Serve em</th><th className={s.num}>Saldo</th><th className={s.num}>Mínimo</th><th className={s.num}>Consumo/mês</th><th className={s.num}>Dura</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {filtered.map(sp => {
                  const st = sp.stocks[location]
                  const low = isLow(sp, location)
                  const f = forecast(sp, location)
                  const otherStock = SUPPLY_LOCATIONS.filter(l => l.key !== location && sp.stocks[l.key]?.quantity > 0).map(l => `${l.label}: ${sp.stocks[l.key].quantity}`).join(' · ')
                  return (
                    <tr key={sp.id} className={low ? s.rowLow : ''}>
                      <td>
                        <div className={s.supplyName}><ColorDot color={sp.color} />{sp.name}</div>
                        <div className={s.supplyMeta}>{sp.code ? `Cód. ${sp.code}` : ''}{otherStock ? `${sp.code ? ' · ' : ''}outros prédios — ${otherStock}` : ''}</div>
                      </td>
                      <td className={s.typeCell}>{SUPPLY_TYPES[sp.type] || sp.type}</td>
                      <td className={s.modelsCell} title={sp.models.join(', ')}>{sp.models.length ? sp.models.join(', ') : <span className={s.muted}>—</span>}</td>
                      <td className={`${s.num} ${s.qty} ${low ? s.qtyLow : ''}`}>{st.quantity}</td>
                      <td className={`${s.num} ${s.muted}`}>{st.min_quantity || '—'}</td>
                      <td className={`${s.num} ${s.muted}`}>{f.perMonth ? f.perMonth.toFixed(1).replace('.', ',') : '—'}</td>
                      <td className={`${s.num} ${f.months != null && f.months < 1 ? s.qtyLow : s.muted}`} title="Saldo ÷ consumo médio dos últimos 90 dias">
                        {f.months == null ? '—' : f.months < 1 ? `~${Math.max(1, Math.round(f.months * 30))} dias` : `~${f.months.toFixed(1).replace('.', ',')} meses`}
                      </td>
                      <td>
                        <div className={s.actions}>
                          {writable && <>
                            <button className={s.actBtn} title="Entrada (compra/recebimento)" onClick={() => setMoving({ supply: sp, kind: 'entrada' })}>➕</button>
                            <button className={s.actBtn} title="Troca na impressora" disabled={!st.quantity} onClick={() => setMoving({ supply: sp, kind: 'troca' })}>🔄</button>
                            <button className={s.actBtn} title="Transferir para outro prédio" disabled={!st.quantity} onClick={() => setMoving({ supply: sp, kind: 'transferencia' })}>⇄</button>
                            <button className={s.actBtn} title="Ajustar saldo (contagem)" onClick={() => setMoving({ supply: sp, kind: 'ajuste' })}>✎</button>
                          </>}
                          <button className={s.actBtn} title="Histórico" onClick={() => setHistory(sp)}>🕘</button>
                          {writable && <button className={s.actBtn} title="Editar insumo" onClick={() => setEditing(sp)}>✏️</button>}
                          {user?.system_role === 'super_admin' && <button className={s.actBtn} title="Remover do catálogo" onClick={() => remove(sp)}>🗑️</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <SupplyEditor supply={editing.id ? editing : null} knownModels={knownModels} onClose={() => setEditing(null)} onSaved={sp => { upsert(sp); setEditing(null) }} />}
      {moving && <MovementModal supply={moving.supply} location={location} kind={moving.kind} printers={printers} onClose={() => setMoving(null)} onSaved={sp => { upsert(sp); setMoving(null) }} />}
      {history && <HistoryModal supply={history} location={location} onClose={() => setHistory(null)} />}
    </div>
  )
}

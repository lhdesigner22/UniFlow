import { useState, useEffect, useMemo, useCallback, useId } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
import s from './InventoryPage.module.css'

// Inventário → Brain (e futuros controles): quem está com cada kit, de que setor
// e qual o patrimônio — o mesmo formato da planilha "CONTROLE BRAIN".
const KINDS = {
  brain: { title: 'Brain', item: 'kit', items: 'kits', sub: 'Kits Brain entregues aos colaboradores.' },
}
const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function Highlight({ text, term }) {
  if (!term || !text) return text || null
  const i = norm(text).indexOf(norm(term))
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark className={s.hit}>{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>
}

function ItemModal({ kind, meta, item, sectors, onClose, onSaved }) {
  const id = useId()
  const [f, setF] = useState({ holder_name: item?.holder_name || '', sector: item?.sector || '', asset_tag: item?.asset_tag || '', notes: item?.notes || '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))
  const save = async e => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      if (item) await api.put(`/inventory/${kind}/${item.id}`, f)
      else await api.post(`/inventory/${kind}`, f)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível salvar.')
      setSaving(false)
    }
  }
  return (
    <Modal title={item ? `Editar ${meta.item}` : `Cadastrar ${meta.item}`} onClose={onClose} width={480}>
      <form onSubmit={save}>
        <div className="form-group">
          <label className="label" htmlFor={`${id}-r`}>Responsável</label>
          <input id={`${id}-r`} autoFocus value={f.holder_name} onChange={set('holder_name')} maxLength={120} placeholder="Nome de quem está com o kit" />
        </div>
        <div className={s.formRow}>
          <div className="form-group">
            <label className="label" htmlFor={`${id}-s`}>Setor</label>
            <input id={`${id}-s`} list={`${id}-sl`} value={f.sector} onChange={set('sector')} maxLength={80} placeholder="Ex: COMERCIAL POLOS" />
            <datalist id={`${id}-sl`}>{sectors.map(x => <option key={x} value={x} />)}</datalist>
          </div>
          <div className="form-group">
            <label className="label" htmlFor={`${id}-p`}>Patrimônio</label>
            <input id={`${id}-p`} value={f.asset_tag} onChange={set('asset_tag')} maxLength={40} inputMode="numeric" placeholder="Ex: 8270" />
          </div>
        </div>
        <div className="form-group">
          <label className="label" htmlFor={`${id}-o`}>Observação (opcional)</label>
          <input id={`${id}-o`} value={f.notes} onChange={set('notes')} maxLength={300} placeholder="Ex: fone com o Paulo" />
        </div>
        {error && <p role="alert" className={s.error}>{error}</p>}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!f.holder_name.trim() || saving}>
          {saving ? 'Salvando...' : item ? 'Salvar alterações' : `Cadastrar ${meta.item}`}
        </button>
      </form>
    </Modal>
  )
}

export default function InventoryPage() {
  const { kind } = useParams()
  const meta = KINDS[kind]
  const { user } = useAuthStore()
  const editable = canEditModule(user, 'inventory')
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [sector, setSector] = useState('')
  const [modal, setModal] = useState(null) // null | {} | item

  const load = useCallback(async () => {
    if (!meta) return
    try { setItems((await api.get(`/inventory/${kind}`)).data.items); setError('') }
    catch (e) { setError(e.response?.data?.error || 'Não foi possível carregar o inventário.') }
  }, [kind, meta])
  useEffect(() => { setItems(null); load() }, [load])
  useLiveRefresh(['inventory'], load)

  const sectors = useMemo(() => [...new Set((items || []).map(i => i.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [items])
  const dupTags = useMemo(() => {
    const c = {}
    for (const i of items || []) if (i.asset_tag) c[i.asset_tag] = (c[i.asset_tag] || 0) + 1
    return new Set(Object.keys(c).filter(k => c[k] > 1))
  }, [items])
  const shown = useMemo(() => (items || []).filter(i =>
    (!sector || i.sector === sector) &&
    (!q || norm(`${i.holder_name} ${i.asset_tag || ''} ${i.notes || ''}`).includes(norm(q)))), [items, q, sector])

  if (!meta) return <div className={s.page}><p className={s.error}>Controle de inventário não encontrado.</p></div>

  const remove = async it => {
    if (!(await confirmDialog(`Excluir o ${meta.item} de ${it.holder_name}${it.asset_tag ? ` (patrimônio ${it.asset_tag})` : ''}?`, { title: `Excluir ${meta.item}`, confirmLabel: 'Excluir' }))) return
    try { await api.delete(`/inventory/${kind}/${it.id}`); load() }
    catch (e) { alertDialog(e.response?.data?.error || 'Não foi possível excluir.', { danger: true }) }
  }
  const exportXlsx = async () => {
    const { downloadXlsx } = await import('../utils/xlsxExport')
    await downloadXlsx({
      fileName: `Controle ${meta.title}`, title: `Controle de kits ${meta.title}`,
      subtitle: `${shown.length} ${shown.length === 1 ? meta.item : meta.items}${sector ? ` do setor ${sector}` : ''}`, author: user?.name,
      sheets: [{ name: meta.title, columns: [
        { header: 'Responsável', key: 'holder_name', width: 38 },
        { header: 'Setor', key: 'sector', width: 24 },
        { header: 'Patrimônio', key: 'asset_tag', width: 14 },
        { header: 'Observação', key: 'notes', width: 40, wrap: true },
      ], rows: shown.map(i => ({ holder_name: i.holder_name, sector: i.sector || '', asset_tag: i.asset_tag || '', notes: i.notes || '' })) }],
    })
  }

  const total = items?.length || 0
  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>{meta.title}</h1>
          <p className={s.sub}>
            {items ? `${total} ${total === 1 ? meta.item : meta.items} em ${sectors.length} ${sectors.length === 1 ? 'setor' : 'setores'}.` : meta.sub}
            {dupTags.size > 0 && <span className={s.warn}> {dupTags.size === 1 ? 'Um patrimônio aparece' : `${dupTags.size} patrimônios aparecem`} em mais de um {meta.item}.</span>}
          </p>
        </div>
        <div className={s.actions}>
          <button type="button" className="btn btn-ghost" onClick={exportXlsx} disabled={!shown.length}><LineIcon name="sheet" /> Excel</button>
          {editable && <button type="button" className="btn btn-primary" onClick={() => setModal({})}><LineIcon name="plus" /> Cadastrar {meta.item}</button>}
        </div>
      </header>

      <div className={s.toolbar}>
        <label className={s.search}>
          <LineIcon name="search" />
          <span className="sr-only">Buscar</span>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nome, patrimônio ou observação" />
        </label>
        <label className={s.filter}>
          <span>Setor</span>
          <select value={sector} onChange={e => setSector(e.target.value)}>
            <option value="">Todos</option>
            {sectors.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        {(q || sector) && items && <span className={s.count} role="status">{shown.length} de {total}</span>}
      </div>

      {error && <p role="alert" className={s.error}>{error}</p>}
      {!items && !error && <p className={s.muted}>Carregando…</p>}

      {items && total === 0 && (
        <div className={s.emptyBox}>
          <LineIcon name="list" size={26} />
          <p>{editable ? `Nenhum ${meta.item} cadastrado. Use "Cadastrar ${meta.item}" para começar.` : `Nenhum ${meta.item} cadastrado ainda.`}</p>
        </div>
      )}

      {items && total > 0 && (
        shown.length === 0 ? <p className={s.muted}>Nada encontrado com esse filtro.</p> : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Responsável</th>
                  <th scope="col">Setor</th>
                  <th scope="col" className={s.num}>Patrimônio</th>
                  <th scope="col">Observação</th>
                  {editable && <th scope="col"><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody>
                {shown.map(it => (
                  <tr key={it.id}>
                    <td className={s.name}><Highlight text={it.holder_name} term={q} /></td>
                    <td className={s.sector}>{it.sector || '—'}</td>
                    <td className={s.num}>
                      {it.asset_tag ? <span className={dupTags.has(it.asset_tag) ? s.dup : ''} title={dupTags.has(it.asset_tag) ? 'Este patrimônio aparece em mais de um registro' : undefined}>
                        <Highlight text={it.asset_tag} term={q} />{dupTags.has(it.asset_tag) && <LineIcon name="alert" size={13} />}
                      </span> : '—'}
                    </td>
                    <td className={s.notes}>{it.notes && it.notes !== '-' ? <Highlight text={it.notes} term={q} /> : <span className={s.muted}>—</span>}</td>
                    {editable && (
                      <td className={s.menu}>
                        <RowMenu name={it.holder_name} items={[
                          { label: 'Editar', icon: 'edit', onClick: () => setModal(it) },
                          { label: 'Excluir', icon: 'trash', danger: true, onClick: () => remove(it) },
                        ]} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {modal && <ItemModal kind={kind} meta={meta} item={modal.id ? modal : null} sectors={sectors} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />}
    </div>
  )
}

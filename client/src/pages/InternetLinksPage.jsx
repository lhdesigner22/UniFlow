import { useState, useEffect, useMemo } from 'react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useCopy } from '../hooks/useCopy'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import s from './InternetLinksPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
import { useSortableSensors, sortableAccessibility, useSerialSave, refocusMoveButton } from '../utils/sortableA11y'

const LOCATIONS = [
  { key: 'sede', label: 'Sede' },
  { key: 'campus-conceito', label: 'Campus Conceito' },
  { key: 'administrativo', label: 'Administrativo' },
  { key: 'clinicas', label: 'Clínicas' },
]

// Só os dígitos, no máximo 8, formatado como 00000-000
function formatCep(value) {
  return value.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
}

function Editor({ link, defaultLocation, onClose, onSaved }) {
  const [form, setForm] = useState({
    location: link?.location || defaultLocation || 'sede',
    provider: link?.provider || '',
    speed: link?.speed || '',
    dual_approach: !!link?.dual_approach,
    account_manager: link?.account_manager || '',
    contact: link?.contact || '',
    cnpj: link?.cnpj || '',
    address: link?.address || '',
    department_id: link ? link.department_id : defaultDepartment(),
  })
  const [cep, setCep] = useState('')
  const [cepLoading, setCepLoading] = useState(false)
  const [cepError, setCepError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ViaCEP — API pública e gratuita (sem chave, sem cadastro), busca o
  // endereço pelo CEP e preenche o campo automaticamente. O número/
  // complemento não vem da API — o campo continua editável pra completar.
  const onCepChange = e => {
    const formatted = formatCep(e.target.value)
    setCep(formatted)
    setCepError('')
    const digits = formatted.replace(/\D/g, '')
    if (digits.length === 8) lookupCep(digits)
  }

  const lookupCep = async digits => {
    setCepLoading(true)
    setCepError('')
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await res.json()
      if (data.erro) {
        setCepError('CEP não encontrado.')
        return
      }
      const linha = [data.logradouro, data.bairro, [data.localidade, data.uf].filter(Boolean).join(' - ')]
        .filter(Boolean).join(', ')
      const full = `${linha}${linha ? ', ' : ''}CEP ${formatCep(digits)}`
      setForm(f => ({ ...f, address: full }))
    } catch {
      setCepError('Não deu para buscar o CEP. Tente de novo ou preencha o endereço à mão.')
    } finally {
      setCepLoading(false)
    }
  }

  const save = async () => {
    if (!form.provider.trim()) return
    setSaving(true)
    setError('')
    try {
      const saved = link
        ? (await api.put(`/internet-links/${link.id}`, form)).data
        : (await api.post('/internet-links', form)).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Não deu para salvar o link. Tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={link ? 'Editar link de internet' : 'Novo link de internet'} onClose={onClose} width={520}>
      <div className="form-group">
        <label htmlFor="internet-links-local" className="label">Local</label>
        <select id="internet-links-local" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}>
          {LOCATIONS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="internet-links-nome-da-operadora" className="label">Nome da operadora</label>
        <input id="internet-links-nome-da-operadora" autoFocus value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} placeholder="Ex: Vivo, Claro, Algar..." />
      </div>
      <div className="form-group">
        <label htmlFor="internet-links-velocidade-do-link" className="label">Velocidade do link</label>
        <input id="internet-links-velocidade-do-link" value={form.speed} onChange={e => setForm(f => ({ ...f, speed: e.target.value }))} placeholder="Ex: 500 Mbps, 1 Gbps..." />
      </div>
      <div className="form-group">
        <label className={s.checkboxLabel}>
          <input type="checkbox" checked={form.dual_approach} onChange={e => setForm(f => ({ ...f, dual_approach: e.target.checked }))} />
          Dupla abordagem
        </label>
      </div>
      <div className="form-group">
        <label htmlFor="internet-links-gerente-de-negocios" className="label">Gerente de negócios</label>
        <input id="internet-links-gerente-de-negocios" value={form.account_manager} onChange={e => setForm(f => ({ ...f, account_manager: e.target.value }))} placeholder="Nome do gerente" />
      </div>
      <div className="form-group">
        <label htmlFor="internet-links-contato" className="label">Contato</label>
        <input id="internet-links-contato" value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} placeholder="Telefone ou e-mail do gerente" />
      </div>
      <div className="form-group">
        <label htmlFor="internet-links-cnpj-registrado" className="label">CNPJ registrado</label>
        <input id="internet-links-cnpj-registrado" value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" />
      </div>
      <div className="form-group">
        <label htmlFor="internet-links-cep" className="label">CEP</label>
        <input id="internet-links-cep" value={cep} onChange={onCepChange} placeholder="00000-000" inputMode="numeric" />
        {cepLoading && <p className={s.cepHint}>Buscando endereço...</p>}
        {cepError && <p role="alert" className={s.fileError}>{cepError}</p>}
      </div>
      <div className="form-group">
        <label htmlFor="internet-links-endereco" className="label">Endereço</label>
        <textarea id="internet-links-endereco" rows={2} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Preenche sozinho a partir do CEP acima — complete com número e complemento" />
      </div>
      {error && <p role="alert" className={s.fileError}>{error}</p>}
      <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.provider.trim() || saving} onClick={save}>
        {saving ? 'Salvando…' : link ? 'Salvar alterações' : 'Cadastrar link'}
      </button>
    </Modal>
  )
}

// Contato do gerente: e-mail vira mailto:, telefone vira tel:.
const contactHref = c => (c.includes('@') ? `mailto:${c.trim()}` : /\d{4}/.test(c) ? `tel:${c.replace(/[^\d+]/g, '')}` : null)

// Uma linha por link — arrastável só pela alça, para não atrapalhar os botões.
function LinkRow({ link: l, index, total, draggable, canEdit, onEdit, onDelete, onMove, copied, copy }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: l.id, disabled: !draggable, attributes: { roleDescription: 'item reordenável' } })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const copyBtn = (k, text, what) => (
    <button type="button" className={s.copyBtn} onClick={() => copy(k, text)} aria-label={copied === k ? `${what} copiado` : `Copiar ${what}`}>
      <LineIcon name={copied === k ? 'check' : 'copy'} size={13} />{copied === k ? 'Copiado' : 'Copiar'}
    </button>
  )
  const href = l.contact ? contactHref(l.contact) : null

  return (
    <li ref={setNodeRef} style={style} className={s.row}>
      <div className={s.speedCol}>
        {draggable && (
          <button type="button" className={s.dragHandle} {...attributes} {...listeners} aria-label={`Reordenar ${l.provider}`} title="Arrastar para reordenar">
            <LineIcon name="grip" size={16} />
          </button>
        )}
        <span className={s.speed}>{l.speed || '—'}</span>
      </div>
      <div className={s.main}>
        <div className={s.titleLine}>
          <h2 className={s.provider}>{l.provider}</h2>
          <span className={`${s.pill} ${l.dual_approach ? s.pillOn : ''}`} title="Dupla abordagem: o cabo chega por dois caminhos diferentes">
            {l.dual_approach ? 'Dupla abordagem' : 'Sem dupla abordagem'}
          </span>
        </div>
        <dl className={s.facts}>
          {(l.account_manager || l.contact) && (<>
            <dt>Gerente</dt>
            <dd>
              {l.account_manager && <span>{l.account_manager}</span>}
              {l.contact && (href ? <a className={s.contactLink} href={href}>{l.contact}</a> : <span>{l.contact}</span>)}
              {l.contact && copyBtn(`${l.id}:contato`, l.contact, 'contato')}
            </dd>
          </>)}
          {l.cnpj && (<>
            <dt>CNPJ</dt>
            <dd><span className={s.num}>{l.cnpj}</span>{copyBtn(`${l.id}:cnpj`, l.cnpj, 'CNPJ')}</dd>
          </>)}
          {l.address && (<>
            <dt>Endereço</dt>
            <dd>
              <span>{l.address}</span>
              {copyBtn(`${l.id}:end`, l.address, 'endereço')}
              <a className={s.copyBtn} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address)}`} target="_blank" rel="noreferrer">
                <LineIcon name="pin" size={13} />Abrir no mapa
              </a>
            </dd>
          </>)}
        </dl>
      </div>
      <div className={s.actions}>
        {draggable && (
          <span className={s.moveBtns}>
            <button type="button" className={s.iconBtn} aria-label={`Mover ${l.provider} para cima`} title="Mover para cima" data-move={`${l.id}:-1`} disabled={index === 0} onClick={() => { onMove(index, index - 1); refocusMoveButton(l.id, -1) }}><LineIcon name="chevronUp" size={15} /></button>
            <button type="button" className={s.iconBtn} aria-label={`Mover ${l.provider} para baixo`} title="Mover para baixo" data-move={`${l.id}:1`} disabled={index === total - 1} onClick={() => { onMove(index, index + 1); refocusMoveButton(l.id, 1) }}><LineIcon name="chevronDown" size={15} /></button>
          </span>
        )}
        {canEdit(l) && (
          <RowMenu name={`Ações do link ${l.provider}`} items={[
            { label: 'Editar link', icon: 'edit', onClick: () => onEdit(l) },
            { label: 'Excluir link', icon: 'trash', danger: true, onClick: () => onDelete(l) },
          ]} />
        )}
      </div>
    </li>
  )
}

export default function InternetLinksPage() {
  const { user } = useAuthStore()
  const [locationTab, setLocationTab] = useState('sede')
  const [links, setLinks] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, link = editar
  const { copied, copy } = useCopy()

  useLiveRefresh(['internet-links'], () => load())
  const load = () => {
    api.get('/internet-links')
      .then(r => setLinks(r.data || []))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => (links || []).filter(l => l.location === locationTab), [links, locationTab])
  const counts = useMemo(() => Object.fromEntries(LOCATIONS.map(l => [l.key, (links || []).filter(x => x.location === l.key).length])), [links])

  const onSaved = link => {
    setLinks(prev => {
      const exists = (prev || []).some(l => l.id === link.id)
      return exists ? prev.map(l => l.id === link.id ? link : l) : [...(prev || []), link]
    })
    setEditing(null)
  }

  const deleteLink = async l => {
    const ok = await confirmDialog(`Excluir o link da "${l.provider}"?`, { title: 'Excluir link de internet' })
    if (!ok) return
    try {
      await api.delete(`/internet-links/${l.id}`)
      setLinks(prev => (prev || []).filter(x => x.id !== l.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Não deu para excluir o link.', { title: 'Erro', danger: true })
    }
  }

  const canEdit = l => l.created_by === user?.id || user?.system_role === 'super_admin'
  const canReorder = user?.system_role === 'super_admin' && filtered.length > 1
  const sensors = useSortableSensors()
  const saveOrder = useSerialSave(ids => api.put('/internet-links/reorder', { ids }))

  // Arrastar-e-soltar pra reordenar dentro do local atual — atualiza a tela
  // na hora e persiste a nova ordem; se falhar, refaz a busca pra desfazer.
  const handleDragEnd = e => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    moveTo(filtered.findIndex(l => l.id === active.id), filtered.findIndex(l => l.id === over.id))
  }

  // Também usado pelos botões ↑ ↓ (quem não consegue arrastar).
  const moveTo = async (oldIndex, newIndex) => {
    if (oldIndex === -1 || newIndex < 0 || newIndex >= filtered.length) return
    const reordered = arrayMove(filtered, oldIndex, newIndex)
    setLinks(prev => [...(prev || []).filter(l => l.location !== locationTab), ...reordered])
    try {
      await saveOrder(reordered.map(l => l.id))
    } catch {
      load()
    }
  }

  if (loading) return <div className={s.loading}>Carregando links de internet…</div>
  const place = LOCATIONS.find(l => l.key === locationTab)?.label

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>Links de internet</h1>
          <p className={s.sub}>Operadora, velocidade e com quem falar em cada local. O primeiro da lista é o link principal.</p>
        </div>
        {user?.system_role === 'super_admin' && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Novo link</button>
        )}
      </header>

      <nav className={s.tabs} aria-label="Local">
        {LOCATIONS.map(l => (
          <button key={l.key} type="button" aria-pressed={locationTab === l.key} className={`${s.tab} ${locationTab === l.key ? s.tabActive : ''}`} onClick={() => setLocationTab(l.key)}>
            {l.label} <span className={s.tabCount}>{counts[l.key] || 0}</span>
          </button>
        ))}
      </nav>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h2>Nenhum link cadastrado em {place}</h2>
          <p>{user?.system_role === 'super_admin' ? 'Use "Novo link" para cadastrar a operadora deste local.' : 'Peça a um Super Admin para cadastrar os links.'}</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}
          accessibility={sortableAccessibility(filtered, l => l.provider)}>
          <SortableContext items={filtered.map(l => l.id)} strategy={verticalListSortingStrategy}>
            <ul className={s.list}>
              {filtered.map((l, i) => (
                <LinkRow key={l.id} link={l} index={i} total={filtered.length} draggable={canReorder} canEdit={canEdit}
                  onEdit={setEditing} onDelete={deleteLink} onMove={moveTo} copied={copied} copy={copy} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {editing && (
        <Editor
          link={editing.id ? editing : null}
          defaultLocation={locationTab}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

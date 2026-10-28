import { useState, useEffect, useMemo } from 'react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import s from './InternetLinksPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import LineIcon from '../components/common/LineIcon'
import { useSortableSensors, sortableAccessibility, useSerialSave, refocusMoveButton } from '../utils/sortableA11y'

const LOCATIONS = [
  { key: 'sede', label: 'SEDE' },
  { key: 'campus-conceito', label: 'CAMPUS CONCEITO' },
  { key: 'administrativo', label: 'ADMINISTRATIVO' },
  { key: 'clinicas', label: 'CLÍNICAS' },
]

function timeAgo(iso) {
  if (!iso) return null
  const mins = Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 60000)
  if (mins < 1) return 'agora mesmo'
  if (mins < 60) return `há ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `há ${days}d`
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR')
}

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
      setCepError('Erro ao buscar o CEP. Tenta de novo?')
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
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
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
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

// Um card de link — arrastável só pela alça (⠿), pra não atrapalhar cliques
// nos botões de editar/excluir ou no link "Abrir no Google Maps".
function LinkCard({ link: l, index, total, draggable, canEdit, onEdit, onDelete, onMove }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: l.id, disabled: !draggable, attributes: { roleDescription: 'item reordenável' } })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div ref={setNodeRef} style={style} className={s.card}>
      <div className={s.cardHeader}>
        {draggable && (
          <button type="button" className={s.dragHandle} title="Arrastar para reordenar" {...attributes} aria-label={`Reordenar ${l.provider}`} {...listeners}>⠿</button>
        )}
        <h3 className={s.cardTitle}>{l.provider}</h3>
        {canEdit(l) && (
          <div className={s.cardActions}>
            {draggable && <>
              <button type="button" className={s.iconBtn} title="Mover para antes" aria-label={`Mover ${l.provider} para antes`} data-move={`${l.id}:-1`} disabled={index === 0} onClick={() => { onMove(index, index - 1); refocusMoveButton(l.id, -1) }}><LineIcon name="chevronLeft" /></button>
              <button type="button" className={s.iconBtn} title="Mover para depois" aria-label={`Mover ${l.provider} para depois`} data-move={`${l.id}:1`} disabled={index === total - 1} onClick={() => { onMove(index, index + 1); refocusMoveButton(l.id, 1) }}><LineIcon name="chevronRight" /></button>
            </>}
            <button className={s.iconBtn} title="Editar" onClick={() => onEdit(l)}>✏️</button>
            <button className={s.iconBtn} title="Excluir" onClick={() => onDelete(l)}>🗑️</button>
          </div>
        )}
      </div>
      {l.speed && <p className={s.cardLine}>⚡ {l.speed}</p>}
      <p className={s.cardLine}>
        🔀 Dupla abordagem: <span className={l.dual_approach ? s.yes : s.no}>{l.dual_approach ? 'Sim' : 'Não'}</span>
      </p>
      {l.account_manager && <p className={s.cardLine}>👤 {l.account_manager}</p>}
      {l.contact && <p className={s.cardLine}>📞 {l.contact}</p>}
      {l.cnpj && <p className={s.cardLine}>CNPJ: <span className={s.mono}>{l.cnpj}</span></p>}
      {l.address && (
        <>
          <p className={s.cardLine}>📍 {l.address}</p>
          <iframe
            className={s.mapEmbed}
            title={`Mapa — ${l.provider}`}
            src={`https://www.google.com/maps?q=${encodeURIComponent(l.address)}&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <a
            className={s.cardLink}
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address)}`}
            target="_blank" rel="noreferrer"
          >
            🗺️ Abrir no Google Maps
          </a>
        </>
      )}
      <div className={s.cardFooter}>
        <span className={s.cardMeta}>{l.author_name || 'Alguém'} · {timeAgo(l.updated_at)}</span>
      </div>
    </div>
  )
}

export default function InternetLinksPage() {
  const { user } = useAuthStore()
  const [locationTab, setLocationTab] = useState('sede')
  const [links, setLinks] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, link = editar

  useLiveRefresh(['internet-links'], () => load())
  const load = () => {
    api.get('/internet-links')
      .then(r => setLinks(r.data || []))
      .catch(() => setLinks([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => (links || []).filter(l => l.location === locationTab), [links, locationTab])

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
      await alertDialog(e.response?.data?.error || 'Erro ao excluir o link.', { title: 'Erro', danger: true })
    }
  }

  const canEdit = l => l.created_by === user?.id || user?.system_role === 'super_admin'
  const canReorder = user?.system_role === 'super_admin'
  const sensors = useSortableSensors()
  const saveOrder = useSerialSave(ids => api.put('/internet-links/reorder', { ids }))

  // Arrastar-e-soltar pra reordenar dentro do local atual — atualiza a tela
  // na hora e persiste a nova ordem; se falhar, refaz a busca pra desfazer.
  const handleDragEnd = e => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    moveTo(filtered.findIndex(l => l.id === active.id), filtered.findIndex(l => l.id === over.id))
  }

  // Também usado pelos botões ‹ › (quem não consegue arrastar).
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

  if (loading) return <div className={s.loading}>Carregando links de internet...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Link de Internet</h1>
          <p className={s.sub}>Operadora, velocidade, dupla abordagem e contato do gerente de negócios, por local.</p>
        </div>
        {user?.system_role === 'super_admin' && (
          <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo link</button>
        )}
      </div>

      <div className={s.tabs}>
        {LOCATIONS.map(l => (
          <button key={l.key} className={`${s.tab} ${locationTab === l.key ? s.tabActive : ''}`} onClick={() => setLocationTab(l.key)}>
            {l.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhum link em {LOCATIONS.find(l => l.key === locationTab)?.label}</h3>
          <p>{user?.system_role === 'super_admin' ? 'Cadastre o primeiro link desse local.' : 'Peça pra um Super Admin cadastrar.'}</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}
          accessibility={sortableAccessibility(filtered, l => l.provider)}>
          <SortableContext items={filtered.map(l => l.id)} strategy={rectSortingStrategy}>
            <div className={s.grid}>
              {filtered.map((l, i) => (
                <LinkCard key={l.id} link={l} index={i} total={filtered.length} draggable={canReorder} canEdit={canEdit} onEdit={setEditing} onDelete={deleteLink} onMove={moveTo} />
              ))}
            </div>
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

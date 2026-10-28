import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { downloadFile } from '../utils/download'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
import s from './PrintersPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import { safeHref } from '../utils/safeHref'
import PrinterSupplyHistory from '../components/common/PrinterSupplyHistory'
import LineIcon from '../components/common/LineIcon'
import { useSortableSensors, sortableAccessibility, useSerialSave, refocusMoveButton } from '../utils/sortableA11y'

// Mesmo teto aplicado no servidor — 95 MB, o máximo seguro dentro do limite
// real de corpo de requisição da Cloudflare (100 MB no plano atual, um teto
// de plataforma, não nosso). Acima disso, usar o campo de link direto.
const MAX_FILE_BYTES = 95 * 1024 * 1024

const LOCATIONS = [
  { key: 'sede', label: 'SEDE' },
  { key: 'adm', label: 'ADM' },
  { key: 'centro', label: 'CENTRO' },
  { key: 'g5', label: 'G5' },
  { key: 'clinicas', label: 'CLÍNICAS' },
]
const LOCATION_MAP = Object.fromEntries(LOCATIONS.map(l => [l.key, l]))

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

// Envolve um card pra poder arrastá-lo; entrega as props da alça (⠿) via
// render-prop — só ela inicia o arrasto, pra não atrapalhar os botões do card.
function SortableCard({ id, disabled, className, children }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled, attributes: { roleDescription: 'item reordenável' } })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children({ ...attributes, ...listeners })}
    </div>
  )
}

function Editor({ printer, defaultLocation, onClose, onSaved }) {
  const [form, setForm] = useState({
    location: printer?.location || defaultLocation || 'sede',
    model: printer?.model || '',
    ip: printer?.ip || '',
    department: printer?.department || '',
    link_url: printer?.link_url || '',
    department_id: printer ? printer.department_id : defaultDepartment(),
  })
  const [existingAttachment, setExistingAttachment] = useState(
    printer?.has_attachment ? { name: printer.attachment_name, type: printer.attachment_type } : null
  )
  const [newAttachmentFile, setNewAttachmentFile] = useState(null)
  const [removeAttachment, setRemoveAttachment] = useState(false)
  const [fileError, setFileError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)

  const onFileChange = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`Arquivo grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB) — máx. 95 MB. Pra maior que isso, suba no Drive e cole o link direto.`)
      return
    }
    setFileError('')
    setNewAttachmentFile(file)
    setRemoveAttachment(false)
  }

  const removeExisting = () => { setExistingAttachment(null); setRemoveAttachment(true) }

  const save = async () => {
    if (!form.model.trim()) return
    setSaving(true)
    setFileError('')
    try {
      let saved = printer
        ? (await api.put(`/printers/${printer.id}`, form)).data
        : (await api.post('/printers', form)).data

      if (newAttachmentFile) {
        setSaving(false)
        setUploadingFile(true)
        const fd = new FormData()
        fd.append('file', newAttachmentFile)
        saved = (await api.post(`/printers/${saved.id}/attachment`, fd, { timeout: 300_000 })).data
        setUploadingFile(false)
      } else if (removeAttachment) {
        saved = (await api.delete(`/printers/${saved.id}/attachment`)).data
      }

      onSaved(saved)
    } catch (e) {
      setSaving(false)
      setUploadingFile(false)
      setFileError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
    }
  }

  return (
    <Modal title={printer ? 'Editar impressora' : 'Nova impressora'} onClose={onClose} width={520}>
      <div className="form-group">
        <label htmlFor="printers-local" className="label">Local</label>
        <select id="printers-local" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}>
          {LOCATIONS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="printers-modelo" className="label">Modelo</label>
        <input id="printers-modelo" autoFocus value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="Ex: HP LaserJet Pro M404dw" />
      </div>
      <div className="form-group">
        <label htmlFor="printers-ip" className="label">IP</label>
        <input id="printers-ip" value={form.ip} onChange={e => setForm(f => ({ ...f, ip: e.target.value }))} placeholder="Ex: 192.168.1.50" />
      </div>
      <div className="form-group">
        <label htmlFor="printers-departamento" className="label">Departamento</label>
        <input id="printers-departamento" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Ex: Financeiro, TI, Secretaria..." />
      </div>
      <div className="form-group">
        <label className="label">Driver (opcional, até 95 MB)</label>
        {newAttachmentFile ? (
          <div className={s.attachmentRow}>
            <span>📎 {newAttachmentFile.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewAttachmentFile(null)}>✕ Cancelar</button>
          </div>
        ) : existingAttachment ? (
          <div className={s.attachmentRow}>
            <span>📎 {existingAttachment.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={removeExisting}>✕ Remover</button>
          </div>
        ) : (
          <input type="file" onChange={onFileChange} />
        )}
        {fileError && <p role="alert" className={s.fileError}>{fileError}</p>}
      </div>
      <div className="form-group">
        <label htmlFor="printers-ou-link-direto-de-instal" className="label">Ou link direto de instalação (opcional)</label>
        <input id="printers-ou-link-direto-de-instal"
          value={form.link_url}
          onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))}
          placeholder="Ex: link do site do fabricante ou do Drive"
        />
      </div>
      <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.model.trim() || saving || uploadingFile} onClick={save}>
        {uploadingFile ? 'Enviando driver...' : saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

export default function PrintersPage() {
  const { user } = useAuthStore()
  const { location: locationParam } = useParams()
  // O local vem da rota (/impressoras/sede|adm|centro — controlada pelo
  // dropdown da sidebar, igual "Chamados"); se vier algo inválido, cai em sede.
  const locationTab = LOCATION_MAP[locationParam] ? locationParam : 'sede'
  const [printers, setPrinters] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, impressora = editar
  const [suppliesFor, setSuppliesFor] = useState(null) // impressora cujo histórico de insumos está aberto

  useLiveRefresh(['printers'], () => load()) // alguém mexeu em outro aparelho
  const load = () => {
    api.get('/printers')
      .then(r => setPrinters(r.data || []))
      .catch(() => setPrinters([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => (printers || []).filter(p => p.location === locationTab), [printers, locationTab])

  const onSaved = printer => {
    setPrinters(prev => {
      const exists = (prev || []).some(p => p.id === printer.id)
      return exists ? prev.map(p => p.id === printer.id ? printer : p) : [...(prev || []), printer]
    })
    setEditing(null)
  }

  const deletePrinter = async p => {
    const ok = await confirmDialog(`Excluir a impressora "${p.model}"?`, { title: 'Excluir impressora' })
    if (!ok) return
    try {
      await api.delete(`/printers/${p.id}`)
      setPrinters(prev => (prev || []).filter(x => x.id !== p.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir a impressora.', { title: 'Erro', danger: true })
    }
  }

  const canEdit = p => p.created_by === user?.id || user?.system_role === 'super_admin'
  const canReorder = user?.system_role === 'super_admin'
  const sensors = useSortableSensors()
  const saveOrder = useSerialSave(ids => api.put('/printers/reorder', { ids }))

  // Arrastar-e-soltar dentro do local atual: atualiza a tela na hora e salva
  // a nova ordem; se falhar, refaz a busca pra desfazer.
  const handleDragEnd = e => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    moveTo(filtered.findIndex(p => p.id === active.id), filtered.findIndex(p => p.id === over.id))
  }

  // Também usado pelos botões ‹ › (quem não consegue arrastar).
  const moveTo = async (oldIndex, newIndex) => {
    if (oldIndex === -1 || newIndex < 0 || newIndex >= filtered.length) return
    const reordered = arrayMove(filtered, oldIndex, newIndex)
    setPrinters(prev => [...(prev || []).filter(p => p.location !== locationTab), ...reordered])
    try {
      await saveOrder(reordered.map(p => p.id))
    } catch {
      load()
    }
  }

  if (loading) return <div className={s.loading}>Carregando impressoras...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Impressoras — {LOCATION_MAP[locationTab].label}</h1>
          <p className={s.sub}>Modelo, IP configurado e driver de instalação. Troque o local pelo menu "Impressoras" na barra lateral.</p>
        </div>
        {user?.system_role === 'super_admin' && (
          <button className="btn btn-primary" onClick={() => setEditing({})}>+ Nova impressora</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhuma impressora em {LOCATION_MAP[locationTab].label}</h3>
          <p>{user?.system_role === 'super_admin' ? 'Cadastre a primeira impressora desse local.' : 'Peça pra um Super Admin cadastrar.'}</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}
          accessibility={sortableAccessibility(filtered, p => p.model)}>
          <SortableContext items={filtered.map(p => p.id)} strategy={rectSortingStrategy}>
            <div className={s.grid}>
              {filtered.map((p, i) => (
                <SortableCard key={p.id} id={p.id} disabled={!canReorder} className={s.sortWrap}>
                  {handleProps => (
                    <Reveal delay={Math.min(i, 10) * 50} className={s.card}>
                      <div className={s.cardHeader}>
                        {canReorder && (
                          <button type="button" className={s.dragHandle} title="Arrastar para reordenar" aria-label={`Reordenar ${p.model}`} {...handleProps}>⠿</button>
                        )}
                        <h3 className={s.cardTitle}>{p.model}</h3>
                        {canEdit(p) && (
                          <div className={s.cardActions}>
                            {canReorder && <>
                              <button type="button" className={s.iconBtn} title="Mover para antes" aria-label={`Mover ${p.model} para antes`} data-move={`${p.id}:-1`} disabled={i === 0} onClick={() => { moveTo(i, i - 1); refocusMoveButton(p.id, -1) }}><LineIcon name="chevronLeft" /></button>
                              <button type="button" className={s.iconBtn} title="Mover para depois" aria-label={`Mover ${p.model} para depois`} data-move={`${p.id}:1`} disabled={i === filtered.length - 1} onClick={() => { moveTo(i, i + 1); refocusMoveButton(p.id, 1) }}><LineIcon name="chevronRight" /></button>
                            </>}
                            <button className={s.iconBtn} title="Editar" onClick={() => setEditing(p)}>✏️</button>
                            <button className={s.iconBtn} title="Excluir" onClick={() => deletePrinter(p)}>🗑️</button>
                          </div>
                        )}
                      </div>
                      {p.department && <p className={s.cardIp}>Depto: {p.department}</p>}
                      {p.ip && <p className={s.cardIp}>IP: <span className={s.mono}>{p.ip}</span></p>}
                      {!!p.has_attachment && (
                        <button type="button" className={s.cardLink} onClick={() => downloadFile(`/printers/${p.id}/attachment`, p.attachment_name || 'driver')}>
                          📎 Baixar driver ({p.attachment_name})
                        </button>
                      )}
                      {p.link_url && (
                        <a className={s.cardLink} href={safeHref(p.link_url)} target="_blank" rel="noreferrer">🔗 Link de instalação</a>
                      )}
                      <button type="button" className={s.cardLink} onClick={() => setSuppliesFor(p)}>🧴 Histórico de insumos</button>
                      <div className={s.cardFooter}>
                        <span className={s.cardMeta}>{p.author_name || 'Alguém'} · {timeAgo(p.updated_at)}</span>
                      </div>
                    </Reveal>
                  )}
                </SortableCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {suppliesFor && <PrinterSupplyHistory printer={suppliesFor} onClose={() => setSuppliesFor(null)} />}
      {editing && (
        <Editor
          printer={editing.id ? editing : null}
          defaultLocation={locationTab}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

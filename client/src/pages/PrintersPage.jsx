import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { downloadFile } from '../utils/download'
import Modal from '../components/common/Modal'
import RowMenu from '../components/common/RowMenu'
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

// Linha da tabela que pode ser arrastada; entrega as props da alça via
// render-prop — só ela inicia o arrasto, pra não atrapalhar os botões da linha.
function SortableRow({ id, disabled, children }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled, attributes: { roleDescription: 'item reordenável' } })
  const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.5 : 1, position: 'relative', zIndex: isDragging ? 2 : undefined }
  return (
    <tr ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </tr>
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
        <label htmlFor="printers-departamento" className="label">Setor onde fica</label>
        <input id="printers-departamento" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Ex: Financeiro, TI, Secretaria..." />
      </div>
      <div className="form-group">
        <label htmlFor="printers-driver" className="label">Driver (opcional, até 95 MB)</label>
        {newAttachmentFile ? (
          <div className={s.attachmentRow}>
            <span><LineIcon name="download" size={14} /> {newAttachmentFile.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewAttachmentFile(null)}>Cancelar</button>
          </div>
        ) : existingAttachment ? (
          <div className={s.attachmentRow}>
            <span><LineIcon name="download" size={14} /> {existingAttachment.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={removeExisting}>Remover driver</button>
          </div>
        ) : (
          <input id="printers-driver" type="file" onChange={onFileChange} />
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
        {uploadingFile ? 'Enviando driver...' : saving ? 'Salvando...' : printer ? 'Salvar alterações' : 'Cadastrar impressora'}
      </button>
    </Modal>
  )
}

export default function PrintersPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { location: locationParam } = useParams()
  // O local vem da rota (/impressoras/sede|adm|centro); se vier algo inválido, cai em sede.
  const locationTab = LOCATION_MAP[locationParam] ? locationParam : 'sede'
  const [printers, setPrinters] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, impressora = editar
  const [suppliesFor, setSuppliesFor] = useState(null) // impressora cujo histórico de insumos está aberto
  const [copiedIp, setCopiedIp] = useState(null)

  useLiveRefresh(['printers'], () => load()) // alguém mexeu em outro aparelho
  const load = () => {
    api.get('/printers')
      .then(r => setPrinters(r.data || []))
      .catch(() => setPrinters([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => (printers || []).filter(p => p.location === locationTab), [printers, locationTab])
  const countByLoc = useMemo(() => {
    const c = {}
    for (const p of printers || []) c[p.location] = (c[p.location] || 0) + 1
    return c
  }, [printers])

  const onSaved = printer => {
    setPrinters(prev => {
      const exists = (prev || []).some(p => p.id === printer.id)
      return exists ? prev.map(p => p.id === printer.id ? printer : p) : [...(prev || []), printer]
    })
    setEditing(null)
    if (printer.location !== locationTab) navigate(`/impressoras/${printer.location}`)
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

  const copyIp = async p => {
    try {
      await navigator.clipboard.writeText(p.ip)
      setCopiedIp(p.id)
      setTimeout(() => setCopiedIp(prev => (prev === p.id ? null : prev)), 1600)
    } catch { /* clipboard indisponível — ignora */ }
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

  // Também usado pelos botões ↑ ↓ (quem não consegue arrastar).
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

  const withIp = filtered.filter(p => p.ip).length
  const withDriver = filtered.filter(p => p.has_attachment || p.link_url).length

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Impressoras</h1>
          <p className={s.sub}>
            {filtered.length
              ? `${filtered.length} em ${LOCATION_MAP[locationTab].label}: ${withIp} com IP, ${withDriver} com driver ou link de instalação.`
              : 'Modelo, IP e driver de instalação de cada impressora, por prédio.'}
          </p>
        </div>
        <div className={s.headerActions}>
          <Link className="btn btn-ghost" to={`/estoque-insumos/${locationTab}`}><LineIcon name="list" size={15} /> Estoque de insumos</Link>
          {user?.system_role === 'super_admin' && (
            <button className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Nova impressora</button>
          )}
        </div>
      </div>

      <nav className={s.tabs} aria-label="Prédios">
        {LOCATIONS.map(l => (
          <Link key={l.key} to={`/impressoras/${l.key}`} aria-current={l.key === locationTab ? 'page' : undefined}
            className={`${s.tab} ${l.key === locationTab ? s.tabActive : ''}`}>
            {l.label}<span className={s.tabCount}>{countByLoc[l.key] || 0}</span>
          </Link>
        ))}
      </nav>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h2>Nenhuma impressora em {LOCATION_MAP[locationTab].label}</h2>
          <p>{user?.system_role === 'super_admin' ? 'Cadastre a primeira impressora deste prédio.' : 'Peça para um Super Admin cadastrar.'}</p>
          {user?.system_role === 'super_admin' && (
            <button className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Nova impressora</button>
          )}
        </div>
      ) : (
        <div className={s.card}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}
            accessibility={sortableAccessibility(filtered, p => p.model)}>
            <SortableContext items={filtered.map(p => p.id)} strategy={verticalListSortingStrategy}>
              <table className={s.table}>
                <thead>
                  <tr>
                    {canReorder && <th className={s.gripCol}><span className="sr-only">Ordem</span></th>}
                    <th>Impressora</th>
                    <th>IP</th>
                    <th>Instalação</th>
                    <th>Insumos</th>
                    <th className={s.actionsCol}><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <SortableRow key={p.id} id={p.id} disabled={!canReorder}>
                      {handleProps => <>
                        {canReorder && (
                          <td className={s.gripCol}>
                            <button type="button" className={s.dragHandle} title="Arrastar para reordenar" aria-label={`Reordenar ${p.model}`} {...handleProps}>
                              <LineIcon name="grip" size={16} />
                            </button>
                          </td>
                        )}
                        <td className={s.modelCell}>
                          <span className={s.model}>{p.model}</span>
                          <span className={s.dept}>{p.department || 'Sem setor informado'}</span>
                        </td>
                        <td>
                          {p.ip ? (
                            <button type="button" className={s.ip} onClick={() => copyIp(p)}
                              aria-label={copiedIp === p.id ? `IP ${p.ip} copiado` : `Copiar o IP ${p.ip}`} title="Copiar IP">
                              <span>{p.ip}</span>
                              <LineIcon name={copiedIp === p.id ? 'check' : 'copy'} size={13} />
                            </button>
                          ) : <span className={s.none}>Sem IP</span>}
                        </td>
                        <td>
                          <span className={s.links}>
                            {!!p.has_attachment && ( /* vem 0/1 do banco — sem o !! o React desenha o "0" */
                              <button type="button" className={s.linkBtn} onClick={() => downloadFile(`/printers/${p.id}/attachment`, p.attachment_name || 'driver')}
                                title={p.attachment_name}>
                                <LineIcon name="download" size={14} /> Baixar driver
                              </button>
                            )}
                            {p.link_url && (
                              <a className={s.linkBtn} href={safeHref(p.link_url)} target="_blank" rel="noreferrer">
                                <LineIcon name="link" size={14} /> Link de instalação
                              </a>
                            )}
                            {!p.has_attachment && !p.link_url && <span className={s.none}>Sem driver</span>}
                          </span>
                        </td>
                        <td>
                          <button type="button" className={s.linkBtn} onClick={() => setSuppliesFor(p)}>
                            <LineIcon name="clock" size={14} /> Histórico
                          </button>
                        </td>
                        <td className={s.actionsCol}>
                          <span className={s.rowActions}>
                            {canReorder && <>
                              <button type="button" className={s.iconBtn} title="Mover para cima" aria-label={`Mover ${p.model} para cima`} data-move={`${p.id}:-1`} disabled={i === 0} onClick={() => { moveTo(i, i - 1); refocusMoveButton(p.id, -1) }}><LineIcon name="chevronUp" size={15} /></button>
                              <button type="button" className={s.iconBtn} title="Mover para baixo" aria-label={`Mover ${p.model} para baixo`} data-move={`${p.id}:1`} disabled={i === filtered.length - 1} onClick={() => { moveTo(i, i + 1); refocusMoveButton(p.id, 1) }}><LineIcon name="chevronDown" size={15} /></button>
                            </>}
                            {canEdit(p) && (
                              <RowMenu name={p.model} items={[
                                { label: 'Editar impressora', icon: 'edit', onClick: () => setEditing(p) },
                                { label: 'Excluir impressora', icon: 'trash', danger: true, onClick: () => deletePrinter(p) },
                              ]} />
                            )}
                          </span>
                        </td>
                      </>}
                    </SortableRow>
                  ))}
                </tbody>
              </table>
            </SortableContext>
          </DndContext>
          <p className={s.foot}>
            {canReorder ? 'Arraste pela alça ou use as setas para mudar a ordem. ' : ''}
            Clique no IP para copiar.
          </p>
        </div>
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

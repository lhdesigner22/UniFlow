import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { photoPair } from '../utils/imageResize'
import { exportLabIncidentsXlsx } from '../utils/exports'
import ExportXlsxButton from '../components/common/ExportXlsxButton'
import Modal from '../components/common/Modal'
import LineIcon from '../components/common/LineIcon'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import s from './LabIncidentsPage.module.css'

// Fluxos → Incidentes Laboratórios: registro de máquinas com defeito, sinistros,
// projeção/TV, bagunça... nos laboratórios, com fotos, data/hora e o andamento
// até resolver. Servidor: server/src/routes/labIncidents.js.

export const INCIDENT_BUILDINGS = { sede: 'SEDE', centro: 'CENTRO', g5: 'G5' }
export const INCIDENT_CATEGORIES = {
  maquina: { label: 'Máquina com defeito', icon: 'monitor' },
  sinistro: { label: 'Sinistro / dano', icon: 'alert' },
  projecao: { label: 'Projeção / TV', icon: 'tv' },
  organizacao: { label: 'Bagunça / organização', icon: 'broom' },
  rede: { label: 'Rede / internet', icon: 'wifi' },
  outro: { label: 'Outro', icon: 'pin' },
}
export const INCIDENT_SEVERITIES = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' }
export const INCIDENT_STATUSES = { aberto: 'Aberto', em_andamento: 'Em andamento', resolvido: 'Resolvido' }
const MAX_PHOTOS = 10

const pad = n => String(n).padStart(2, '0')
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
const fmtOccurred = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : '—' }
const fmtDb = v => (v ? new Date(/Z$/.test(v) ? v : v.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

function Badge({ kind, value }) {
  const label = kind === 'severity' ? INCIDENT_SEVERITIES[value] : INCIDENT_STATUSES[value]
  return <span className={`${s.badge} ${s[`${kind}_${value}`] || ''}`}>{label || value}</span>
}

// Gravidade como escala de 4 barras (baixa → crítica): a cor só aparece nas barras cheias
const SEVERITY_LEVEL = { baixa: 1, media: 2, alta: 3, critica: 4 }
function Severity({ value }) {
  const level = SEVERITY_LEVEL[value] || 0
  return (
    <span className={s.severity} data-level={level}>
      <span className={s.bars} aria-hidden="true">{[1, 2, 3, 4].map(n => <span key={n} className={n <= level ? s.barOn : ''} />)}</span>
      <span>{INCIDENT_SEVERITIES[value] || value}</span>
    </span>
  )
}

// Escolher fotos: reduz no navegador e mostra a prévia (o envio é depois, ao salvar)
function PhotoPicker({ photos, setPhotos, max, onError }) {
  const [busy, setBusy] = useState(false)
  const pick = async e => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    const room = max - photos.length
    if (room <= 0) return onError(`Máximo de ${MAX_PHOTOS} fotos por incidente.`)
    setBusy(true)
    try {
      const out = []
      for (const f of files.slice(0, room)) out.push(await photoPair(f))
      setPhotos(prev => [...prev, ...out])
      if (files.length > room) onError(`Só couberam ${room} foto(s) — máximo de ${MAX_PHOTOS} por incidente.`)
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={s.photoPicker}>
      {photos.map((p, i) => (
        <div key={i} className={s.thumbWrap}>
          <img src={p.thumb} alt={`Foto ${i + 1}`} className={s.thumb} />
          <button type="button" className={s.thumbRemove} title="Tirar esta foto" aria-label={`Tirar a foto ${i + 1}`} onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {photos.length < max && (
        <label className={s.addPhoto}>
          {busy ? 'Preparando...' : <><LineIcon name="camera" size={20} /><span>Adicionar fotos</span></>}
          <input type="file" accept="image/*" multiple hidden onChange={pick} disabled={busy} />
        </label>
      )}
    </div>
  )
}

async function uploadPhotos(incidentId, photos, onProgress) {
  for (let i = 0; i < photos.length; i++) {
    onProgress?.(i + 1, photos.length)
    await api.post(`/lab-incidents/${incidentId}/photos`, photos[i], { timeout: 120_000 })
  }
}

function IncidentForm({ incident, building, knownLabs, onClose, onSaved }) {
  const [form, setForm] = useState({
    building: incident?.building || building,
    lab: incident?.lab || '',
    category: incident?.category || 'maquina',
    severity: incident?.severity || 'media',
    title: incident?.title || '',
    description: incident?.description || '',
    equipment: incident?.equipment || '',
    patrimony: incident?.patrimony || '',
    occurred_at: incident?.occurred_at || nowLocal(),
    reported_by_name: incident?.reported_by_name || '',
    class_info: incident?.class_info || '',
    glpi_ticket: incident?.glpi_ticket || '',
    department_id: incident ? incident.department_id : defaultDepartment(),
  })
  const [photos, setPhotos] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const valid = form.lab.trim() && form.title.trim() && form.occurred_at

  const save = async () => {
    if (!valid) return
    setError('')
    setSaving('Salvando...')
    try {
      const saved = incident
        ? (await api.put(`/lab-incidents/${incident.id}`, form)).data
        : (await api.post('/lab-incidents', form)).data
      if (photos.length) await uploadPhotos(saved.id, photos, (n, t) => setSaving(`Enviando foto ${n} de ${t}...`))
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
      setSaving('')
    }
  }

  return (
    <Modal title={incident ? 'Editar incidente' : 'Registrar incidente'} onClose={onClose} width={640}>
      <div className={s.formGrid}>
        <div className="form-group">
          <label htmlFor="lab-incidents-predio" className="label">Prédio</label>
          <select id="lab-incidents-predio" value={form.building} onChange={e => set('building', e.target.value)}>
            {Object.entries(INCIDENT_BUILDINGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="lab-incidents-laboratorio-sala" className="label">Laboratório / sala *</label>
          <input id="lab-incidents-laboratorio-sala" list="lab-names" value={form.lab} onChange={e => set('lab', e.target.value)} placeholder="Ex: Laboratório 3" autoFocus={!incident} />
          <datalist id="lab-names">{knownLabs.map(l => <option key={l} value={l} />)}</datalist>
        </div>
        <div className="form-group">
          <label htmlFor="lab-incidents-tipo" className="label">Tipo</label>
          <select id="lab-incidents-tipo" value={form.category} onChange={e => set('category', e.target.value)}>
            {Object.entries(INCIDENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="lab-incidents-gravidade" className="label">Gravidade</label>
          <select id="lab-incidents-gravidade" value={form.severity} onChange={e => set('severity', e.target.value)}>
            {Object.entries(INCIDENT_SEVERITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="lab-incidents-resumo" className="label">Resumo *</label>
        <input id="lab-incidents-resumo" value={form.title} maxLength={140} onChange={e => set('title', e.target.value)} placeholder="Ex: PC 12 não liga / Projetor sem imagem / Cadeiras quebradas" />
      </div>
      <div className="form-group">
        <label htmlFor="lab-incidents-o-que-aconteceu-detalhes" className="label">O que aconteceu (detalhes)</label>
        <textarea id="lab-incidents-o-que-aconteceu-detalhes" rows={4} value={form.description} maxLength={5000} onChange={e => set('description', e.target.value)} placeholder="Descreva o problema, o que já foi tentado, se há risco, o que precisa ser feito..." />
      </div>
      <div className={s.formGrid}>
        <div className="form-group">
          <label htmlFor="lab-incidents-data-e-hora-da-ocorrenci" className="label">Data e hora da ocorrência *</label>
          <input id="lab-incidents-data-e-hora-da-ocorrenci" type="datetime-local" value={form.occurred_at} onChange={e => set('occurred_at', e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="lab-incidents-equipamento" className="label">Equipamento</label>
          <input id="lab-incidents-equipamento" value={form.equipment} maxLength={140} onChange={e => set('equipment', e.target.value)} placeholder="Ex: PC 12 (bancada 3), Projetor Epson" />
        </div>
        <div className="form-group">
          <label htmlFor="lab-incidents-patrimonio" className="label">Patrimônio</label>
          <input id="lab-incidents-patrimonio" value={form.patrimony} maxLength={60} onChange={e => set('patrimony', e.target.value)} placeholder="Ex: 004512" />
        </div>
        <div className="form-group">
          <label htmlFor="lab-incidents-chamado-no-glpi" className="label">Chamado no GLPI</label>
          <input id="lab-incidents-chamado-no-glpi" value={form.glpi_ticket} maxLength={20} onChange={e => set('glpi_ticket', e.target.value)} placeholder="Nº do chamado (se abriu)" />
        </div>
        <div className="form-group">
          <label htmlFor="lab-incidents-quem-relatou" className="label">Quem relatou</label>
          <input id="lab-incidents-quem-relatou" value={form.reported_by_name} maxLength={120} onChange={e => set('reported_by_name', e.target.value)} placeholder="Professor, aluno, monitor..." />
        </div>
        <div className="form-group">
          <label htmlFor="lab-incidents-turma-aula-professor-no-" className="label">Turma / aula / professor no horário</label>
          <input id="lab-incidents-turma-aula-professor-no-" value={form.class_info} maxLength={200} onChange={e => set('class_info', e.target.value)} placeholder="Ex: ADS 3º sem — Prof. Fulano" />
        </div>
      </div>
      {!incident && (
        <div className="form-group">
          <span className="label">Fotos (até {MAX_PHOTOS})</span>
          <PhotoPicker photos={photos} setPhotos={setPhotos} max={MAX_PHOTOS} onError={setError} />
        </div>
      )}
      <DepartmentSelect value={form.department_id} onChange={v => set('department_id', v)} label="Visível para" />
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!valid || !!saving} onClick={save}>
        {saving || (incident ? 'Salvar alterações' : 'Registrar incidente')}
      </button>
    </Modal>
  )
}

function PhotoViewer({ incidentId, photo, onClose }) {
  const [full, setFull] = useState(null)
  useEffect(() => {
    api.get(`/lab-incidents/${incidentId}/photos/${photo.id}`).then(r => setFull(r.data.data)).catch(() => setFull(photo.thumb))
  }, [photo.id])
  return (
    <Modal title="Foto do incidente" onClose={onClose} width={1000}>
      <img src={full || photo.thumb} alt="Foto do incidente" className={s.fullPhoto} />
      {full && <a className={`btn btn-ghost btn-sm ${s.downloadLink}`} href={full} download={`incidente-foto-${photo.id.slice(0, 8)}.jpg`}><LineIcon name="download" size={14} /> Baixar foto</a>}
    </Modal>
  )
}

function IncidentDetail({ id, user, writable, onClose, onChanged, onEdit, onDeleted }) {
  const [inc, setInc] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [newPhotos, setNewPhotos] = useState([])
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = () => api.get(`/lab-incidents/${id}`).then(r => { setInc(r.data); setResolution(r.data.resolution || '') }).catch(() => setInc(false))
  useEffect(() => { load() }, [id])
  useLiveRefresh(['lab-incidents'], () => load())

  if (inc === null) return <Modal title="Incidente" onClose={onClose} width={720}><p className={s.muted}>Carregando...</p></Modal>
  if (inc === false) return <Modal title="Incidente" onClose={onClose} width={720}><p className={s.muted}>Incidente não encontrado.</p></Modal>

  const canEditData = writable && (inc.created_by === user?.id || user?.system_role === 'super_admin')
  const cat = INCIDENT_CATEGORIES[inc.category] || INCIDENT_CATEGORIES.outro

  const changeStatus = async status => {
    setBusy('status'); setError('')
    try {
      const { data } = await api.post(`/lab-incidents/${id}/status`, { status, resolution })
      setInc(prev => ({ ...prev, ...data })); onChanged(data)
    } catch (e) { setError(e.response?.data?.error || 'Erro ao mudar a situação.') } finally { setBusy('') }
  }
  const sendPhotos = async () => {
    setError('')
    try {
      await uploadPhotos(id, newPhotos, (n, t) => setBusy(`Enviando foto ${n} de ${t}...`))
      setNewPhotos([]); await load(); onChanged({ id, photo_count: (inc.photo_count || 0) + newPhotos.length })
    } catch (e) { setError(e.response?.data?.error || 'Erro ao enviar as fotos.') } finally { setBusy('') }
  }
  const removePhoto = async p => {
    if (!(await confirmDialog('Remover esta foto do incidente?', { title: 'Remover foto', confirmLabel: 'Remover' }))) return
    await api.delete(`/lab-incidents/${id}/photos/${p.id}`); load()
  }
  const remove = async () => {
    if (!(await confirmDialog(`Excluir o incidente "${inc.title}" e as fotos dele?`, { title: 'Excluir incidente' }))) return
    try { await api.delete(`/lab-incidents/${id}`); onDeleted(id) } catch (e) { await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true }) }
  }

  const Field = ({ label, children }) => children ? <div className={s.field}><span className={s.fieldLabel}>{label}</span><span className={s.fieldValue}>{children}</span></div> : null

  return (
    <Modal title={inc.title} onClose={onClose} width={760}>
      <div className={s.detailBadges}>
        <Severity value={inc.severity} />
        <span className={s.chip}><LineIcon name={cat.icon} size={13} />{cat.label}</span>
        <span className={s.chip}><LineIcon name="pin" size={13} />{INCIDENT_BUILDINGS[inc.building]}, {inc.lab}</span>
      </div>

      <div className={s.fields}>
        <Field label="Data e hora">{fmtOccurred(inc.occurred_at)}</Field>
        <Field label="Equipamento">{inc.equipment}</Field>
        <Field label="Patrimônio">{inc.patrimony}</Field>
        <Field label="Chamado GLPI">{inc.glpi_ticket && <a href={`https://glpi.inventario.unifecaf.edu.br/front/ticket.form.php?id=${encodeURIComponent(inc.glpi_ticket)}`} target="_blank" rel="noreferrer">#{inc.glpi_ticket}</a>}</Field>
        <Field label="Quem relatou">{inc.reported_by_name}</Field>
        <Field label="Turma / professor">{inc.class_info}</Field>
        <Field label="Registrado por">{`${inc.author_name || '—'} em ${fmtDb(inc.created_at)}`}</Field>
        <Field label="Departamento">{inc.department_name || 'Geral'}</Field>
        {inc.status === 'resolvido' && <Field label="Resolvido">{`${inc.resolved_by_name || '—'} em ${fmtDb(inc.resolved_at)}`}</Field>}
      </div>
      {inc.description && <div className={s.description}>{inc.description}</div>}

      <h3 className={s.sectionTitle}>Fotos <span className={s.sectionCount}>{inc.photos?.length || 0}</span></h3>
      <div className={s.gallery}>
        {(inc.photos || []).map(p => (
          <div key={p.id} className={s.thumbWrap}>
            <button type="button" className={s.thumbBtn} onClick={() => setViewing(p)} title="Ver em tamanho grande" aria-label="Ver em tamanho grande">
              <img src={p.thumb} alt="" className={s.thumb} />
            </button>
            {canEditData && <button type="button" className={s.thumbRemove} title="Remover foto" aria-label="Remover esta foto" onClick={() => removePhoto(p)}>×</button>}
          </div>
        ))}
        {!inc.photos?.length && <span className={s.muted}>Nenhuma foto.</span>}
      </div>
      {writable && (inc.photos?.length || 0) < MAX_PHOTOS && (
        <div className={s.addPhotosRow}>
          <PhotoPicker photos={newPhotos} setPhotos={setNewPhotos} max={MAX_PHOTOS - (inc.photos?.length || 0)} onError={setError} />
          {newPhotos.length > 0 && <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={sendPhotos}>{busy || `Enviar ${newPhotos.length} ${newPhotos.length === 1 ? 'foto' : 'fotos'}`}</button>}
        </div>
      )}

      <h3 className={s.sectionTitle}>Andamento</h3>
      {/* passo a passo de verdade: aberto → em andamento → resolvido */}
      <ol className={s.steps} aria-label="Situação do incidente">
        {Object.entries(INCIDENT_STATUSES).map(([k, v], idx) => {
          const cur = Object.keys(INCIDENT_STATUSES).indexOf(inc.status)
          return (
            <li key={k} className={`${s.step} ${idx < cur ? s.stepDone : ''} ${idx === cur ? s.stepNow : ''}`} aria-current={idx === cur ? 'step' : undefined}>
              <span className={s.stepDot}>{idx < cur || (idx === cur && k === 'resolvido') ? <LineIcon name="check" size={11} /> : idx + 1}</span>
              <span>{v}</span>
            </li>
          )
        })}
      </ol>
      {writable ? (
        <>
          <label htmlFor="incident-resolution" className="sr-only">O que foi feito</label>
          <textarea id="incident-resolution" rows={3} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="O que foi feito / solução (ex: trocada a fonte do PC 12, cabo HDMI substituído...)" />
          <div className={s.statusRow}>
            {inc.status === 'aberto' && <button className="btn btn-primary btn-sm" disabled={busy === 'status'} onClick={() => changeStatus('em_andamento')}><LineIcon name="wrench" size={14} /> Começar atendimento</button>}
            {inc.status !== 'resolvido' && <button className={`btn btn-sm ${inc.status === 'em_andamento' ? 'btn-primary' : 'btn-ghost'}`} disabled={busy === 'status'} onClick={() => changeStatus('resolvido')}><LineIcon name="check" size={14} /> Marcar como resolvido</button>}
            {inc.status === 'resolvido' && <button className="btn btn-ghost btn-sm" disabled={busy === 'status'} onClick={() => changeStatus('aberto')}><LineIcon name="undo" size={14} /> Reabrir</button>}
            <button className="btn btn-ghost btn-sm" disabled={busy === 'status' || resolution === (inc.resolution || '')} onClick={() => changeStatus(inc.status)}>Salvar anotação</button>
          </div>
        </>
      ) : (
        <p className={s.description}>{inc.resolution || 'Sem anotações ainda.'}</p>
      )}

      {error && <p role="alert" className={s.error}>{error}</p>}
      {canEditData && (
        <div className={s.detailActions}>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(inc)}><LineIcon name="edit" size={14} /> Editar dados</button>
          <button className={`btn btn-ghost btn-sm ${s.dangerBtn}`} onClick={remove}><LineIcon name="trash" size={14} /> Excluir incidente</button>
        </div>
      )}
      {viewing && <PhotoViewer incidentId={id} photo={viewing} onClose={() => setViewing(null)} />}
    </Modal>
  )
}

// "hoje, 08:40" / "ontem, 14:00" / "26/10, 22:10" — a lista lê melhor com o dia relativo
function whenShort(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return '—'
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today - d) / 86400000)
  const day = diff === 0 ? 'hoje' : diff === 1 ? 'ontem' : `${m[3]}/${m[2]}`
  return `${day}, ${m[4]}:${m[5]}`
}

export default function LabIncidentsPage() {
  const { building = 'sede' } = useParams()
  const { user } = useAuthStore()
  const [items, setItems] = useState(null)
  const [statusFilter, setStatusFilter] = useState('abertos')
  const [onlyUrgent, setOnlyUrgent] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null | {} novo | incidente
  const [openId, setOpenId] = useState(null)
  const writable = canEditModule(user, 'incidents')

  const load = () => api.get('/lab-incidents', { params: { building } }).then(r => setItems(r.data || [])).catch(() => setItems([]))
  useEffect(() => { setItems(null); load() }, [building])
  useLiveRefresh(['lab-incidents'], () => load())

  const knownLabs = useMemo(() => [...new Set((items || []).map(i => i.lab))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [items])
  const isUrgent = i => i.status !== 'resolvido' && (i.severity === 'critica' || i.severity === 'alta')
  const stats = useMemo(() => {
    const list = items || []
    return {
      openAll: list.filter(i => i.status !== 'resolvido').length,
      open: list.filter(i => i.status === 'aberto').length,
      progress: list.filter(i => i.status === 'em_andamento').length,
      resolved: list.filter(i => i.status === 'resolvido').length,
      urgent: list.filter(isUrgent).length,
      all: list.length,
    }
  }, [items])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (items || []).filter(i => {
      if (statusFilter === 'abertos' && i.status === 'resolvido') return false
      if (statusFilter !== 'abertos' && statusFilter !== 'todos' && i.status !== statusFilter) return false
      if (onlyUrgent && !isUrgent(i)) return false
      if (categoryFilter && i.category !== categoryFilter) return false
      if (q && ![i.title, i.lab, i.description, i.equipment, i.patrimony, i.reported_by_name, i.class_info, i.glpi_ticket].some(v => (v || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [items, statusFilter, onlyUrgent, categoryFilter, search])

  const upsert = inc => setItems(prev => {
    const list = prev || []
    return list.some(i => i.id === inc.id) ? list.map(i => (i.id === inc.id ? { ...i, ...inc } : i)) : [inc, ...list]
  })

  if (!items) return <div className={s.loading}>Carregando incidentes...</div>

  const tabs = [
    ['abertos', 'Pendentes', stats.openAll],
    ['aberto', 'Abertos', stats.open],
    ['em_andamento', 'Em andamento', stats.progress],
    ['resolvido', 'Resolvidos', stats.resolved],
    ['todos', 'Todos', stats.all],
  ]

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Incidentes nos laboratórios</h1>
          <p className={s.sub}>
            {INCIDENT_BUILDINGS[building] || building.toUpperCase()}:{' '}
            {stats.openAll ? `${stats.openAll} ${stats.openAll === 1 ? 'pendente' : 'pendentes'}${stats.urgent ? `, ${stats.urgent} de gravidade alta ou crítica` : ''}.` : 'nenhum incidente pendente.'}
          </p>
        </div>
        <div className={s.headerActions}>
          <ExportXlsxButton onExport={() => exportLabIncidentsXlsx({ building })} />
          {writable && <button className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Registrar incidente</button>}
        </div>
      </div>

      <div className={s.stats}>
        <button type="button" className={s.stat} onClick={() => { setStatusFilter('aberto'); setOnlyUrgent(false) }}><strong>{stats.open}</strong><span>Abertos, sem atendimento</span></button>
        <button type="button" className={s.stat} onClick={() => { setStatusFilter('em_andamento'); setOnlyUrgent(false) }}><strong>{stats.progress}</strong><span>Em andamento</span></button>
        <button type="button" aria-pressed={onlyUrgent} className={`${s.stat} ${stats.urgent ? s.statWarn : ''} ${onlyUrgent ? s.statOn : ''}`} onClick={() => { setStatusFilter('abertos'); setOnlyUrgent(v => !v) }}>
          <strong>{stats.urgent}</strong><span>{onlyUrgent ? 'Mostrando só estes' : 'Alta ou crítica pendentes'}</span>
        </button>
        <button type="button" className={s.stat} onClick={() => { setStatusFilter('resolvido'); setOnlyUrgent(false) }}><strong>{stats.resolved}</strong><span>Resolvidos</span></button>
      </div>

      <nav className={s.tabs} aria-label="Situação">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" aria-current={statusFilter === k ? 'true' : undefined}
            className={`${s.tab} ${statusFilter === k ? s.tabActive : ''}`} onClick={() => setStatusFilter(k)}>
            {label}<span className={s.tabCount}>{n}</span>
          </button>
        ))}
      </nav>

      <div className={s.toolbar}>
        <label className={s.search}>
          <LineIcon name="search" size={15} />
          <span className="sr-only">Buscar incidentes</span>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por laboratório, equipamento, patrimônio, descrição" />
        </label>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} aria-label="Tipo de incidente">
          <option value="">Todos os tipos</option>
          {Object.entries(INCIDENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h2>{items.length ? 'Nada com esse filtro' : 'Nenhum incidente registrado aqui'}</h2>
          <p>{items.length ? 'Mude a situação, o tipo ou a busca.' : 'Quando um laboratório tiver um problema, registre aqui com fotos: fica o histórico de cada sala e equipamento.'}</p>
        </div>
      ) : (
        <ul className={s.list}>
          {filtered.map(i => {
            const cat = INCIDENT_CATEGORIES[i.category] || INCIDENT_CATEGORIES.outro
            return (
              <li key={i.id}>
                <button type="button" className={`${s.row} ${i.status === 'resolvido' ? s.rowDone : ''}`} onClick={() => setOpenId(i.id)}>
                  {i.cover
                    ? <img src={i.cover} alt="" className={s.rowPhoto} />
                    : <span className={s.rowIcon} aria-hidden="true"><LineIcon name={cat.icon} size={20} /></span>}
                  <span className={s.rowMain}>
                    <span className={s.rowTitle}>{i.title}</span>
                    <span className={s.rowMeta}>
                      <strong>{i.lab}</strong>{cat.label}
                      {i.equipment && <span>{i.equipment}{i.patrimony ? ` (${i.patrimony})` : ''}</span>}
                    </span>
                  </span>
                  <span className={s.rowWhen}>
                    {whenShort(i.occurred_at)}
                    {!!i.photo_count && <span className={s.rowPhotos}><LineIcon name="camera" size={12} />{i.photo_count}</span>}
                  </span>
                  <Severity value={i.severity} />
                  <Badge kind="status" value={i.status} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <IncidentForm
          incident={editing.id ? editing : null}
          building={building}
          knownLabs={knownLabs}
          onClose={() => setEditing(null)}
          onSaved={inc => { setEditing(null); load(); if (!editing.id) setOpenId(inc.id) }}
        />
      )}
      {openId && (
        <IncidentDetail
          id={openId}
          user={user}
          writable={writable}
          onClose={() => setOpenId(null)}
          onChanged={upsert}
          onEdit={inc => { setOpenId(null); setEditing(inc) }}
          onDeleted={id => { setOpenId(null); setItems(prev => (prev || []).filter(i => i.id !== id)) }}
        />
      )}
    </div>
  )
}

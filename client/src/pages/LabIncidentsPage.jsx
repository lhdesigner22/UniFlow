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
import Reveal from '../components/common/Reveal'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import s from './LabIncidentsPage.module.css'

// Fluxos → Incidentes Laboratórios: registro de máquinas com defeito, sinistros,
// projeção/TV, bagunça... nos laboratórios, com fotos, data/hora e o andamento
// até resolver. Servidor: server/src/routes/labIncidents.js.

export const INCIDENT_BUILDINGS = { sede: 'SEDE', centro: 'CENTRO', g5: 'G5' }
export const INCIDENT_CATEGORIES = {
  maquina: { label: 'Máquina com defeito', icon: '🖥️' },
  sinistro: { label: 'Sinistro / dano', icon: '⚠️' },
  projecao: { label: 'Projeção / TV', icon: '📽️' },
  organizacao: { label: 'Bagunça / organização', icon: '🧹' },
  rede: { label: 'Rede / internet', icon: '🌐' },
  outro: { label: 'Outro', icon: '📌' },
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
          <button type="button" className={s.thumbRemove} title="Tirar esta foto" onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {photos.length < max && (
        <label className={s.addPhoto}>
          {busy ? 'Preparando...' : <>📷<span>Adicionar fotos</span></>}
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
            {Object.entries(INCIDENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
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
          <label className="label">Fotos (até {MAX_PHOTOS})</label>
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
      {full && <a className={s.downloadLink} href={full} download={`incidente-foto-${photo.id.slice(0, 8)}.jpg`}>⬇ Baixar foto</a>}
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
    <Modal title={`${cat.icon} ${inc.title}`} onClose={onClose} width={760}>
      <div className={s.detailBadges}>
        <Badge kind="status" value={inc.status} />
        <Badge kind="severity" value={inc.severity} />
        <span className={s.chip}>{cat.label}</span>
        <span className={s.chip}>{INCIDENT_BUILDINGS[inc.building]} · {inc.lab}</span>
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

      <h4 className={s.sectionTitle}>Fotos ({inc.photos?.length || 0})</h4>
      <div className={s.gallery}>
        {(inc.photos || []).map(p => (
          <div key={p.id} className={s.thumbWrap}>
            <button type="button" className={s.thumbBtn} onClick={() => setViewing(p)} title="Ver em tamanho grande">
              <img src={p.thumb} alt="Foto do incidente" className={s.thumb} />
            </button>
            {canEditData && <button type="button" className={s.thumbRemove} title="Remover foto" onClick={() => removePhoto(p)}>×</button>}
          </div>
        ))}
        {!inc.photos?.length && <span className={s.muted}>Nenhuma foto.</span>}
      </div>
      {writable && (inc.photos?.length || 0) < MAX_PHOTOS && (
        <div className={s.addPhotosRow}>
          <PhotoPicker photos={newPhotos} setPhotos={setNewPhotos} max={MAX_PHOTOS - (inc.photos?.length || 0)} onError={setError} />
          {newPhotos.length > 0 && <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={sendPhotos}>{busy || `Enviar ${newPhotos.length} foto(s)`}</button>}
        </div>
      )}

      <h4 className={s.sectionTitle}>Andamento</h4>
      {writable ? (
        <>
          <textarea rows={3} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="O que foi feito / solução (ex: trocada a fonte do PC 12, cabo HDMI substituído...)" />
          <div className={s.statusRow}>
            {Object.entries(INCIDENT_STATUSES).map(([k, v]) => (
              <button key={k} className={`btn btn-sm ${inc.status === k ? 'btn-primary' : 'btn-ghost'}`} disabled={busy === 'status'} onClick={() => changeStatus(k)}>
                {k === 'resolvido' ? '✓ ' : ''}{inc.status === k && k !== 'resolvido' ? `${v} (salvar nota)` : v}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className={s.description}>{inc.resolution || 'Sem anotações ainda.'}</p>
      )}

      {error && <p role="alert" className={s.error}>{error}</p>}
      {canEditData && (
        <div className={s.detailActions}>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(inc)}>✏️ Editar dados</button>
          <button className="btn btn-ghost btn-sm" onClick={remove}>🗑️ Excluir</button>
        </div>
      )}
      {viewing && <PhotoViewer incidentId={id} photo={viewing} onClose={() => setViewing(null)} />}
    </Modal>
  )
}

export default function LabIncidentsPage() {
  const { building = 'sede' } = useParams()
  const { user } = useAuthStore()
  const [items, setItems] = useState(null)
  const [statusFilter, setStatusFilter] = useState('abertos')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null | {} novo | incidente
  const [openId, setOpenId] = useState(null)
  const writable = canEditModule(user, 'incidents')

  const load = () => api.get('/lab-incidents', { params: { building } }).then(r => setItems(r.data || [])).catch(() => setItems([]))
  useEffect(() => { setItems(null); load() }, [building])
  useLiveRefresh(['lab-incidents'], () => load())

  const knownLabs = useMemo(() => [...new Set((items || []).map(i => i.lab))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [items])
  const stats = useMemo(() => {
    const list = items || []
    return {
      open: list.filter(i => i.status === 'aberto').length,
      progress: list.filter(i => i.status === 'em_andamento').length,
      resolved: list.filter(i => i.status === 'resolvido').length,
      urgent: list.filter(i => i.status !== 'resolvido' && (i.severity === 'critica' || i.severity === 'alta')).length,
    }
  }, [items])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (items || []).filter(i => {
      if (statusFilter === 'abertos' && i.status === 'resolvido') return false
      if (statusFilter !== 'abertos' && statusFilter !== 'todos' && i.status !== statusFilter) return false
      if (categoryFilter && i.category !== categoryFilter) return false
      if (q && ![i.title, i.lab, i.description, i.equipment, i.patrimony, i.reported_by_name, i.class_info, i.glpi_ticket].some(v => (v || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [items, statusFilter, categoryFilter, search])

  const upsert = inc => setItems(prev => {
    const list = prev || []
    return list.some(i => i.id === inc.id) ? list.map(i => (i.id === inc.id ? { ...i, ...inc } : i)) : [inc, ...list]
  })

  if (!items) return <div className={s.loading}>Carregando incidentes...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Incidentes Laboratórios — {INCIDENT_BUILDINGS[building] || building.toUpperCase()}</h1>
          <p className={s.sub}>Máquinas com defeito, sinistros, projeção/TV e organização dos laboratórios — com fotos, data e hora, até resolver.</p>
        </div>
        <div className={s.headerActions}>
          <ExportXlsxButton onExport={() => exportLabIncidentsXlsx({ building })} />
          {writable && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Registrar incidente</button>}
        </div>
      </div>

      <div className={s.stats}>
        <button className={`${s.stat} ${s.statOpen}`} onClick={() => setStatusFilter('aberto')}><strong>{stats.open}</strong><span>Abertos</span></button>
        <button className={`${s.stat} ${s.statProgress}`} onClick={() => setStatusFilter('em_andamento')}><strong>{stats.progress}</strong><span>Em andamento</span></button>
        <button className={`${s.stat} ${s.statUrgent}`} onClick={() => setStatusFilter('abertos')}><strong>{stats.urgent}</strong><span>Alta/crítica em aberto</span></button>
        <button className={`${s.stat} ${s.statDone}`} onClick={() => setStatusFilter('resolvido')}><strong>{stats.resolved}</strong><span>Resolvidos</span></button>
      </div>

      <div className={s.toolbar}>
        <input className={s.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por laboratório, equipamento, patrimônio, descrição..." />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="abertos">Em aberto (sem resolvidos)</option>
          <option value="todos">Todos</option>
          {Object.entries(INCIDENT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">Todos os tipos</option>
          {Object.entries(INCIDENT_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>{items.length ? 'Nada com esse filtro' : 'Nenhum incidente registrado aqui'}</h3>
          <p>{items.length ? 'Mude o filtro ou a busca.' : 'Quando um laboratório tiver um problema, registre aqui com fotos — fica o histórico de cada sala e equipamento.'}</p>
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((i, idx) => {
            const cat = INCIDENT_CATEGORIES[i.category] || INCIDENT_CATEGORIES.outro
            return (
              <Reveal key={i.id} delay={Math.min(idx, 10) * 40} className={`${s.card} ${s[`cardSev_${i.severity}`] || ''}`}>
                <button type="button" className={s.cardBtn} onClick={() => setOpenId(i.id)}>
                  {i.cover
                    ? <img src={i.cover} alt="" className={s.cover} />
                    : <div className={s.coverEmpty}>{cat.icon}</div>}
                  <div className={s.cardBody}>
                    <div className={s.cardBadges}>
                      <Badge kind="status" value={i.status} />
                      <Badge kind="severity" value={i.severity} />
                    </div>
                    <h3 className={s.cardTitle}>{i.title}</h3>
                    <p className={s.cardMeta}>{cat.icon} {cat.label} · <strong>{i.lab}</strong></p>
                    <p className={s.cardMeta}>🕒 {fmtOccurred(i.occurred_at)}{i.photo_count ? ` · 📷 ${i.photo_count}` : ''}</p>
                    {i.equipment && <p className={s.cardMeta}>🔧 {i.equipment}{i.patrimony ? ` (${i.patrimony})` : ''}</p>}
                  </div>
                </button>
              </Reveal>
            )
          })}
        </div>
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

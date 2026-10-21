import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { avatarColor } from '../utils/avatarColor'
import { safeHref } from '../utils/safeHref'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import s from './DevelopmentsPage.module.css'

// Gestão → Desenvolvimentos: vitrine dos sistemas que a equipe desenvolveu —
// logo, nome e para que cada um serve. O menu lateral lista cada um; abrir
// /gestao/desenvolvimentos/:id destaca aquele cartão aqui.

const STATUSES = {
  producao: { label: 'Em produção', className: 'statusProd' },
  desenvolvimento: { label: 'Em desenvolvimento', className: 'statusDev' },
  descontinuado: { label: 'Descontinuado', className: 'statusOff' },
}

const LOGO_SIZE = 256

// Reduz a imagem escolhida pra no máx. 256 px (mantendo a proporção) e devolve
// como data URL — fica leve pra guardar no banco e carregar na lista.
function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Use uma imagem PNG, JPG ou WEBP.'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, LOGO_SIZE / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      let data = canvas.toDataURL('image/webp', 0.9)
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/png') // navegador sem WEBP
      resolve(data)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não deu pra abrir essa imagem.')) }
    img.src = url
  })
}

function Logo({ dev, size = 56 }) {
  if (dev.logo) return <img className={s.logo} style={{ width: size, height: size }} src={dev.logo} alt={`Logo ${dev.name}`} />
  const initials = dev.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return <div className={s.logoFallback} style={{ width: size, height: size, background: avatarColor(dev.id || dev.name) }}>{initials || '?'}</div>
}

function Editor({ dev, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: dev?.name || '',
    purpose: dev?.purpose || '',
    url: dev?.url || '',
    logo: dev?.logo || '',
    status: dev?.status || 'producao',
    department_id: dev ? dev.department_id : defaultDepartment(),
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const onLogo = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setError('')
      set('logo', await resizeLogo(file))
    } catch (err) {
      setError(err.message)
    }
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    setError('')
    try {
      const saved = dev
        ? (await api.put(`/developments/${dev.id}`, form)).data
        : (await api.post('/developments', form)).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
      setSaving(false)
    }
  }

  return (
    <Modal title={dev ? 'Editar desenvolvimento' : 'Novo desenvolvimento'} onClose={onClose} width={560}>
      <div className={s.logoPicker}>
        <Logo dev={{ ...form, id: dev?.id, name: form.name || '?' }} size={72} />
        <div className={s.logoPickerActions}>
          <label className="btn btn-ghost btn-sm">
            {form.logo ? 'Trocar logo' : 'Escolher logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onLogo} />
          </label>
          {form.logo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('logo', '')}>Remover</button>}
          <span className={s.hint}>PNG, JPG ou WEBP — reduzida para 256 px.</span>
        </div>
      </div>
      <div className="form-group">
        <label className="label">Nome</label>
        <input autoFocus value={form.name} maxLength={80} onChange={e => set('name', e.target.value)} placeholder="Ex: UniFlow" />
      </div>
      <div className="form-group">
        <label className="label">Para que serve</label>
        <textarea rows={5} value={form.purpose} maxLength={2000} onChange={e => set('purpose', e.target.value)} placeholder="Ex: Quadros, chamados do GLPI, empréstimo de equipamentos e gestão da equipe de TI." />
      </div>
      <div className="form-group">
        <label className="label">Link (opcional)</label>
        <input value={form.url} onChange={e => set('url', e.target.value)} placeholder="Ex: https://uniflow.serfecaf.workers.dev" />
      </div>
      <div className="form-group">
        <label className="label">Situação</label>
        <select value={form.status} onChange={e => set('status', e.target.value)}>
          {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <DepartmentSelect value={form.department_id} onChange={v => set('department_id', v)} label="Visível para" />
      {error && <p className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.name.trim() || saving} onClick={save}>
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

export default function DevelopmentsPage() {
  const { id: selectedId } = useParams()
  const { user } = useAuthStore()
  const [devs, setDevs] = useState(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, dev = editar
  const cardRefs = useRef({})

  const load = () => api.get('/developments').then(r => setDevs(r.data || [])).catch(() => setDevs([]))
  useEffect(() => { load() }, [])
  useLiveRefresh(['developments'], () => load())

  // Veio do menu (um desenvolvimento específico): rola até o cartão dele.
  useEffect(() => {
    if (selectedId && devs) cardRefs.current[selectedId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [selectedId, devs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!devs || !q) return devs || []
    return devs.filter(d => d.name.toLowerCase().includes(q) || (d.purpose || '').toLowerCase().includes(q))
  }, [devs, search])

  const writable = canEditModule(user, 'gestao')
  const canEdit = d => writable && (d.created_by === user?.id || user?.system_role === 'super_admin')

  const onSaved = dev => {
    setDevs(prev => (prev || []).some(d => d.id === dev.id) ? prev.map(d => d.id === dev.id ? dev : d) : [...(prev || []), dev])
    setEditing(null)
  }

  const remove = async d => {
    if (!(await confirmDialog(`Excluir "${d.name}" dos Desenvolvimentos?`, { title: 'Excluir desenvolvimento' }))) return
    try {
      await api.delete(`/developments/${d.id}`)
      setDevs(prev => (prev || []).filter(x => x.id !== d.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  if (!devs) return <div className={s.loading}>Carregando desenvolvimentos...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Desenvolvimentos</h1>
          <p className={s.sub}>Sistemas e ferramentas desenvolvidos pela equipe — o que cada um faz e onde acessar.</p>
        </div>
        {writable && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo desenvolvimento</button>}
      </div>

      {devs.length > 3 && (
        <div className={s.toolbar}>
          <input className={s.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou descrição..." />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>{devs.length ? 'Nada bate com essa busca' : 'Nenhum desenvolvimento ainda'}</h3>
          <p>{devs.length ? 'Tente outro termo.' : 'Cadastre o primeiro: a logo, o nome e para que ele serve.'}</p>
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((d, i) => {
            const st = STATUSES[d.status] || STATUSES.producao
            return (
              <Reveal key={d.id} delay={Math.min(i, 10) * 50} className={`${s.card} ${d.id === selectedId ? s.cardSelected : ''}`}>
                <div ref={el => { cardRefs.current[d.id] = el }} className={s.cardInner}>
                  <div className={s.cardHeader}>
                    <Logo dev={d} />
                    <div className={s.cardHeading}>
                      <h3 className={s.cardTitle}>{d.name}</h3>
                      <span className={`${s.status} ${s[st.className]}`}>{st.label}</span>
                    </div>
                    {canEdit(d) && (
                      <div className={s.cardActions}>
                        <button className={s.iconBtn} title="Editar" onClick={() => setEditing(d)}>✏️</button>
                        <button className={s.iconBtn} title="Excluir" onClick={() => remove(d)}>🗑️</button>
                      </div>
                    )}
                  </div>
                  {d.purpose && <p className={s.purpose}>{d.purpose}</p>}
                  {d.url && <a className={s.cardLink} href={safeHref(d.url)} target="_blank" rel="noreferrer">🔗 Abrir {d.name}</a>}
                  <div className={s.cardFooter}>
                    <span className={s.cardMeta}>{d.author_name || 'Alguém'}{d.department_name ? ` · ${d.department_name}` : ''}</span>
                  </div>
                </div>
              </Reveal>
            )
          })}
        </div>
      )}

      {editing && <Editor dev={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  )
}

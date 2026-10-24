import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { photoPair } from '../utils/imageResize'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
import s from './SuccessCasesPage.module.css'

// Gestão → Cases de Sucesso: as entregas da TI no ano, para apresentar à
// diretoria. Cada case responde: como era antes, o que a TI fez e o que a
// instituição ganhou. "Modo apresentação" mostra um case por tela (setas do
// teclado, tela cheia). O detalhe técnico fica recolhido de propósito.

const PILLARS = {
  conectividade: { label: 'Conectividade', icon: '📶', color: '#3B82F6' },
  seguranca: { label: 'Segurança', icon: '🛡️', color: '#8B5CF6' },
  gestao: { label: 'Gestão e processos', icon: '📋', color: '#22C55E' },
  operacao: { label: 'Operação', icon: '⚙️', color: '#F59E0B' },
}
const STATUSES = {
  concluido: { label: 'Concluído', className: 'statusDone' },
  piloto: { label: 'Piloto', className: 'statusPilot' },
  andamento: { label: 'Em andamento', className: 'statusDoing' },
}
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const fmtMonth = ym => ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}` : null
const fmtNum = n => Number(n).toLocaleString('pt-BR')

// Números ao vivo que um case pode puxar do próprio UniFlow (GET /success-cases/stats)
const LIVE = {
  glpi_tickets: { label: 'chamados registrados no GLPI' },
  loans_year: { label: 'empréstimos registrados no UniFlow', withYear: true },
  incidents_resolved: { label: 'incidentes de laboratório resolvidos' },
  uniflow_modules: { label: 'módulos no sistema' },
}
const liveValue = (key, stats) => (key && stats && stats[key] != null ? stats[key] : null)

// O número em destaque do case: o digitado vale mais que o ao vivo
function resultOf(c, stats, year) {
  if (c.result_value) return { value: c.result_value, label: c.result_label }
  const v = liveValue(c.live_metric, stats)
  if (v != null) {
    const l = LIVE[c.live_metric]
    return { value: fmtNum(v), label: `${l.label}${l.withYear ? ` em ${year}` : ''}`, live: true, sentence: c.result_label }
  }
  return { value: null, label: c.result_label }
}

function PillarIcon({ pillar, size = 44 }) {
  const p = PILLARS[pillar] || PILLARS.gestao
  return (
    <span className={s.pillarIcon} style={{ width: size, height: size, fontSize: size * 0.5, background: `color-mix(in srgb, ${p.color} 16%, transparent)` }}>
      {p.icon}
    </span>
  )
}

function StatusBadge({ status }) {
  const st = STATUSES[status] || STATUSES.concluido
  return <span className={`${s.status} ${s[st.className]}`}>{st.label}</span>
}

function Editor({ item, year, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: item?.title || '',
    pillar: item?.pillar || 'gestao',
    headline: item?.headline || '',
    before_text: item?.before_text || '',
    solution_text: item?.solution_text || '',
    result_value: item?.result_value || '',
    result_label: item?.result_label || '',
    live_metric: item?.live_metric || '',
    technical: item?.technical || '',
    status: item?.status || 'concluido',
    completed_on: item?.completed_on || '',
    owner: item?.owner || 'Equipe de TI',
    year: item?.year || year,
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    setError('')
    try {
      const saved = item
        ? (await api.put(`/success-cases/${item.id}`, form)).data
        : (await api.post('/success-cases', form)).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
      setSaving(false)
    }
  }

  return (
    <Modal title={item ? 'Editar case' : 'Novo case'} onClose={onClose} width={640}>
      <div className="form-group">
        <label className="label">Título (em linguagem simples)</label>
        <input autoFocus value={form.title} maxLength={100} onChange={e => set('title', e.target.value)} placeholder="Ex: Wi-Fi padronizado em todos os prédios" />
      </div>
      <div className="form-group">
        <label className="label">Frase do cartão</label>
        <input value={form.headline} maxLength={160} onChange={e => set('headline', e.target.value)} placeholder="Ex: Um só padrão de Wi-Fi, gerenciado de um painel" />
      </div>
      <div className={s.formRow}>
        <div className="form-group">
          <label className="label">Pilar</label>
          <select value={form.pillar} onChange={e => set('pillar', e.target.value)}>
            {Object.entries(PILLARS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Situação</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}>
            {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="label">Concluído em</label>
          <input type="month" value={form.completed_on} onChange={e => set('completed_on', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Antes — qual era o problema</label>
        <textarea rows={2} value={form.before_text} maxLength={1000} onChange={e => set('before_text', e.target.value)} />
      </div>
      <div className="form-group">
        <label className="label">O que fizemos</label>
        <textarea rows={2} value={form.solution_text} maxLength={1000} onChange={e => set('solution_text', e.target.value)} />
      </div>
      <div className={s.formRow}>
        <div className="form-group" style={{ flex: '0 0 140px' }}>
          <label className="label">Número</label>
          <input value={form.result_value} maxLength={20} onChange={e => set('result_value', e.target.value)} placeholder="Ex: −40%" />
        </div>
        <div className="form-group">
          <label className="label">Resultado</label>
          <input value={form.result_label} maxLength={160} onChange={e => set('result_label', e.target.value)} placeholder="Ex: menos chamados de Wi-Fi" />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Número ao vivo do UniFlow (usado quando não há número digitado)</label>
        <select value={form.live_metric} onChange={e => set('live_metric', e.target.value)}>
          <option value="">Nenhum</option>
          {Object.entries(LIVE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div className={s.formRow}>
        <div className="form-group">
          <label className="label">Responsáveis</label>
          <input value={form.owner} maxLength={120} onChange={e => set('owner', e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: '0 0 110px' }}>
          <label className="label">Ano</label>
          <input type="number" value={form.year} onChange={e => set('year', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="label">Detalhe técnico (fica recolhido — não coloque IPs nem senhas)</label>
        <textarea rows={2} value={form.technical} maxLength={2000} onChange={e => set('technical', e.target.value)} />
      </div>
      {error && <p className={s.error}>{error}</p>}
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.title.trim() || saving} onClick={save}>
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

// Foto grande sob demanda (a lista só traz miniaturas)
function PhotoViewer({ caseId, photo, onClose }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    api.get(`/success-cases/${caseId}/photos/${photo.id}`).then(r => setData(r.data.data)).catch(() => setData(photo.thumb))
  }, [caseId, photo])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [onClose])
  return (
    <div className={s.viewer} onClick={onClose}>
      <img src={data || photo.thumb} alt={photo.caption || 'Foto do case'} />
      {photo.caption && <p>{photo.caption}</p>}
    </div>
  )
}

function ResultBox({ result }) {
  return (
    <div className={`${s.block} ${s.blockResult}`}>
      <span className={s.blockLabel}>Resultado{result.live && <span className={s.liveTag}>ao vivo</span>}</span>
      {result.value && <span className={s.resultValue}>{result.value}</span>}
      {result.label && <p className={s.blockText}>{result.label}</p>}
      {result.sentence && <p className={s.blockText}>{result.sentence}</p>}
    </div>
  )
}

function Detail({ id, stats, year, writable, onClose, onEdit, onDelete }) {
  const [item, setItem] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const load = useCallback(() => api.get(`/success-cases/${id}`).then(r => setItem(r.data)).catch(() => closeRef.current()), [id])
  useEffect(() => { load() }, [load])

  const upload = async e => {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      for (const f of files) await api.post(`/success-cases/${id}/photos`, { ...(await photoPair(f)), caption })
      setCaption('')
      await load()
    } catch (err) {
      await alertDialog(err.response?.data?.error || err.message || 'Erro ao enviar a foto.', { title: 'Erro', danger: true })
    }
    setUploading(false)
  }
  const removePhoto = async p => {
    if (!(await confirmDialog('Remover esta foto?', { title: 'Remover foto' }))) return
    await api.delete(`/success-cases/${id}/photos/${p.id}`)
    load()
  }

  if (!item) return <Modal title="Carregando..." onClose={onClose} width={820}><p className={s.muted}>Carregando...</p></Modal>
  const p = PILLARS[item.pillar] || PILLARS.gestao
  const result = resultOf(item, stats, year)

  return (
    <Modal title={item.title} onClose={onClose} width={860}>
      <div className={s.detailMeta}>
        <span className={s.pillarText} style={{ color: p.color }}>{p.icon} {p.label}</span>
        <StatusBadge status={item.status} />
        {item.completed_on && <span className={s.muted}>Concluído em {fmtMonth(item.completed_on)}</span>}
        {item.owner && <span className={s.muted}>· {item.owner}</span>}
      </div>
      {item.headline && <p className={s.detailHeadline}>{item.headline}</p>}
      <div className={s.blocks}>
        <div className={s.block}><span className={s.blockLabel}>Antes</span><p className={s.blockText}>{item.before_text || '—'}</p></div>
        <div className={s.block}><span className={s.blockLabel}>O que fizemos</span><p className={s.blockText}>{item.solution_text || '—'}</p></div>
        <ResultBox result={result} />
      </div>

      {(item.photos.length > 0 || writable) && (
        <div className={s.photosSection}>
          <span className={s.blockLabel}>Fotos</span>
          <div className={s.photos}>
            {item.photos.map(ph => (
              <div key={ph.id} className={s.photo}>
                <img src={ph.thumb} alt={ph.caption || 'Foto'} onClick={() => setViewing(ph)} />
                {ph.caption && <span className={s.photoCaption}>{ph.caption}</span>}
                {writable && <button className={s.photoRemove} title="Remover" onClick={() => removePhoto(ph)}>✕</button>}
              </div>
            ))}
          </div>
          {writable && item.photos.length < 6 && (
            <div className={s.photoAdd}>
              <input value={caption} maxLength={60} onChange={e => setCaption(e.target.value)} placeholder="Legenda (ex: Antes, Depois)" />
              <label className="btn btn-ghost btn-sm">
                {uploading ? 'Enviando...' : '📷 Adicionar foto'}
                <input type="file" accept="image/*" multiple hidden disabled={uploading} onChange={upload} />
              </label>
            </div>
          )}
        </div>
      )}

      {item.technical && (
        <details className={s.technical}>
          <summary>Detalhe técnico</summary>
          <p>{item.technical}</p>
        </details>
      )}

      {writable && (
        <div className={s.detailActions}>
          <button className="btn btn-ghost btn-sm" onClick={() => onDelete(item)}>🗑️ Excluir</button>
          <button className="btn btn-primary btn-sm" onClick={() => onEdit(item)}>✏️ Editar</button>
        </div>
      )}
      {viewing && <PhotoViewer caseId={item.id} photo={viewing} onClose={() => setViewing(null)} />}
    </Modal>
  )
}

// Um case por tela, para a reunião. Slide 0 = capa com os números do ano.
function Presentation({ cases, stats, year, onClose }) {
  const [index, setIndex] = useState(0)
  const [photos, setPhotos] = useState({})
  const rootRef = useRef(null)
  const total = cases.length + 1
  const go = useCallback(d => setIndex(i => Math.max(0, Math.min(total - 1, i + d))), [total])

  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Tela cheia só ao abrir; sair dela (Esc do navegador) fecha a apresentação
  useEffect(() => {
    rootRef.current?.requestFullscreen?.().catch(() => {})
    const onFs = () => { if (!document.fullscreenElement) closeRef.current() }
    document.addEventListener('fullscreenchange', onFs)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.body.style.overflow = ''
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const onKey = e => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(1) }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(-1) }
      else if (e.key === 'Home') setIndex(0)
      else if (e.key === 'End') setIndex(total - 1)
      else if (e.key === 'Escape' && !document.fullscreenElement) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, total])

  // Miniaturas do case atual (e do próximo, pra não piscar)
  useEffect(() => {
    for (const c of [cases[index - 1], cases[index]]) {
      if (c && c.photo_count > 0 && !photos[c.id]) {
        setPhotos(p => ({ ...p, [c.id]: [] }))
        api.get(`/success-cases/${c.id}`).then(r => setPhotos(p => ({ ...p, [c.id]: r.data.photos || [] }))).catch(() => {})
      }
    }
  }, [index, cases, photos])

  const c = index > 0 ? cases[index - 1] : null
  const done = cases.filter(x => x.status === 'concluido').length
  const pillarCounts = Object.keys(PILLARS).map(k => [k, cases.filter(x => x.pillar === k).length]).filter(([, n]) => n)

  return (
    <div ref={rootRef} className={s.pres} onClick={e => { if (e.target === e.currentTarget) go(1) }}>
      {!c ? (
        <div className={s.presCover} onClick={() => go(1)}>
          <span className={s.presKicker}>Tecnologia da Informação · UniFECAF</span>
          <h1 className={s.presCoverTitle}>Cases de Sucesso {year}</h1>
          <p className={s.presCoverSub}>O que a TI entregou para alunos, professores e a operação da instituição</p>
          <div className={s.presKpis}>
            <div><strong>{cases.length}</strong><span>entregas no ano</span></div>
            <div><strong>{done}</strong><span>concluídas</span></div>
            {stats?.glpi_tickets != null && <div><strong>{fmtNum(stats.glpi_tickets)}</strong><span>chamados registrados no GLPI</span></div>}
          </div>
          <div className={s.presPillars}>
            {pillarCounts.map(([k, n]) => <span key={k}>{PILLARS[k].icon} {PILLARS[k].label} · {n}</span>)}
          </div>
        </div>
      ) : (() => {
        const p = PILLARS[c.pillar] || PILLARS.gestao
        const result = resultOf(c, stats, year)
        const ph = photos[c.id] || []
        return (
          <div className={s.presSlide} key={c.id}>
            <div className={s.presHead}>
              <span className={s.presPillar} style={{ color: p.color }}>{p.icon} {p.label}</span>
              <StatusBadge status={c.status} />
              {c.completed_on && <span className={s.presMuted}>{fmtMonth(c.completed_on)}</span>}
            </div>
            <h2 className={s.presTitle}>{c.title}</h2>
            {c.headline && <p className={s.presHeadline}>{c.headline}</p>}
            <div className={s.presBlocks}>
              <div className={s.presBlock}><span>Antes</span><p>{c.before_text || '—'}</p></div>
              <div className={s.presArrow}>→</div>
              <div className={s.presBlock}><span>O que fizemos</span><p>{c.solution_text || '—'}</p></div>
              <div className={s.presArrow}>→</div>
              <div className={`${s.presBlock} ${s.presBlockResult}`}>
                <span>Resultado{result.live && ' · ao vivo'}</span>
                {result.value && <strong>{result.value}</strong>}
                {result.label && <p>{result.label}</p>}
                {result.sentence && <p>{result.sentence}</p>}
              </div>
            </div>
            {ph.length > 0 && (
              <div className={s.presPhotos}>
                {ph.slice(0, 4).map(x => (
                  <figure key={x.id}><img src={x.thumb} alt={x.caption || ''} />{x.caption && <figcaption>{x.caption}</figcaption>}</figure>
                ))}
              </div>
            )}
          </div>
        )
      })()}
      <div className={s.presNav}>
        <button onClick={() => go(-1)} disabled={index === 0} aria-label="Anterior">‹</button>
        <span>{index + 1} / {total}</span>
        <button onClick={() => go(1)} disabled={index === total - 1} aria-label="Próximo">›</button>
        <button onClick={onClose} aria-label="Sair">✕</button>
      </div>
      <div className={s.presProgress} style={{ width: `${((index + 1) / total) * 100}%` }} />
    </div>
  )
}

export default function SuccessCasesPage() {
  const { user } = useAuthStore()
  const [data, setData] = useState(null) // { year, years, cases }
  const [year, setYear] = useState(null)
  const [stats, setStats] = useState(null)
  const [pillar, setPillar] = useState('')
  const [openId, setOpenId] = useState(null)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, case = editar
  const [presenting, setPresenting] = useState(false)
  const writable = canEditModule(user, 'gestao')

  const load = useCallback(() => {
    api.get('/success-cases', { params: year ? { year } : {} })
      .then(r => { setData(r.data); if (!year) setYear(r.data.year) })
      .catch(() => setData({ year: year || new Date().getFullYear(), years: [], cases: [] }))
  }, [year])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (year) api.get('/success-cases/stats', { params: { year } }).then(r => setStats(r.data)).catch(() => {})
  }, [year])
  useLiveRefresh(['success-cases'], () => load())

  const cases = data?.cases || []
  const filtered = useMemo(() => pillar ? cases.filter(c => c.pillar === pillar) : cases, [cases, pillar])
  const shownYear = data?.year || year

  const onSaved = saved => {
    setEditing(null)
    if (saved.year !== shownYear) setYear(saved.year)
    else load()
    setOpenId(saved.id)
  }

  const remove = async item => {
    if (!(await confirmDialog(`Excluir o case "${item.title}"? As fotos também saem.`, { title: 'Excluir case' }))) return
    try {
      await api.delete(`/success-cases/${item.id}`)
      setOpenId(null)
      load()
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  const move = async (item, dir) => {
    const ids = cases.map(c => c.id)
    const i = ids.indexOf(item.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setData(d => ({ ...d, cases: ids.map(id => d.cases.find(c => c.id === id)) }))
    await api.put('/success-cases/order', { ids }).catch(() => load())
  }

  if (!data) return <div className={s.loading}>Carregando cases...</div>

  const done = cases.filter(c => c.status === 'concluido').length

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <span className={s.kicker}>Gestão · Cases de Sucesso</span>
          <h1 className={s.title}>TI UniFECAF em {shownYear}</h1>
          <p className={s.sub}>O que a TI entregou no ano: como era antes, o que fizemos e o que a instituição ganhou.</p>
        </div>
        <div className={s.headerActions}>
          {data.years.length > 1 && (
            <select value={shownYear} onChange={e => setYear(Number(e.target.value))}>
              {data.years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {writable && <button className="btn btn-ghost" onClick={() => setEditing({})}>+ Novo case</button>}
          {cases.length > 0 && <button className="btn btn-primary" onClick={() => setPresenting(true)}>▶ Modo apresentação</button>}
        </div>
      </div>

      <div className={s.kpis}>
        <div className={s.kpi}><span>Entregas no ano</span><strong>{cases.length}</strong></div>
        <div className={s.kpi}><span>Concluídas</span><strong>{done}</strong></div>
        <div className={s.kpi}><span>Chamados no GLPI <em>ao vivo</em></span><strong>{stats?.glpi_tickets != null ? fmtNum(stats.glpi_tickets) : '—'}</strong></div>
        <div className={s.kpi}><span>Empréstimos em {shownYear} <em>ao vivo</em></span><strong>{stats?.loans_year != null ? fmtNum(stats.loans_year) : '—'}</strong></div>
      </div>

      <div className={s.chips}>
        <button className={`${s.chip} ${!pillar ? s.chipActive : ''}`} onClick={() => setPillar('')}>Todos · {cases.length}</button>
        {Object.entries(PILLARS).map(([k, p]) => {
          const n = cases.filter(c => c.pillar === k).length
          if (!n) return null
          return <button key={k} className={`${s.chip} ${pillar === k ? s.chipActive : ''}`} onClick={() => setPillar(pillar === k ? '' : k)}>{p.icon} {p.label} · {n}</button>
        })}
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhum case em {shownYear}</h3>
          <p>{writable ? 'Cadastre a primeira entrega do ano: como era antes, o que a TI fez e o resultado.' : 'A equipe de TI ainda não cadastrou os cases deste ano.'}</p>
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((c, i) => {
            const p = PILLARS[c.pillar] || PILLARS.gestao
            const result = resultOf(c, stats, shownYear)
            return (
              <Reveal key={c.id} delay={Math.min(i, 12) * 40} className={s.card}>
                <button className={s.cardBtn} onClick={() => setOpenId(c.id)}>
                  {c.cover
                    ? <img className={s.cover} src={c.cover} alt="" />
                    : <div className={s.coverIcon} style={{ background: `color-mix(in srgb, ${p.color} 10%, transparent)` }}><PillarIcon pillar={c.pillar} size={56} /></div>}
                  <div className={s.cardBody}>
                    <div className={s.cardTop}>
                      <span className={s.pillarText} style={{ color: p.color }}>{p.icon} {p.label}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <h3 className={s.cardTitle}>{c.title}</h3>
                    {c.headline && <p className={s.cardHeadline}>{c.headline}</p>}
                    {result.value && (
                      <p className={s.cardResult}><strong>{result.value}</strong> {result.label}</p>
                    )}
                  </div>
                </button>
                {writable && !pillar && (
                  <div className={s.cardOrder}>
                    <button title="Mover para antes" disabled={i === 0} onClick={() => move(c, -1)}>←</button>
                    <button title="Mover para depois" disabled={i === filtered.length - 1} onClick={() => move(c, 1)}>→</button>
                  </div>
                )}
              </Reveal>
            )
          })}
        </div>
      )}

      {openId && (
        <Detail
          key={openId}
          id={openId}
          stats={stats}
          year={shownYear}
          writable={writable}
          onClose={() => setOpenId(null)}
          onEdit={item => { setOpenId(null); setEditing(item) }}
          onDelete={remove}
        />
      )}
      {editing && <Editor item={editing.id ? editing : null} year={shownYear} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {presenting && <Presentation cases={filtered} stats={stats} year={shownYear} onClose={() => setPresenting(false)} />}
    </div>
  )
}

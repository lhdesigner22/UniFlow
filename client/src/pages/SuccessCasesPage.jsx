import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { photoPair } from '../utils/imageResize'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
import LineIcon from '../components/common/LineIcon'
import s from './SuccessCasesPage.module.css'

// Gestão → Cases de Sucesso: as entregas da TI no ano, para apresentar à
// diretoria. Cada case responde: como era antes, o que a TI fez e o que a
// instituição ganhou. "Modo apresentação" mostra um case por tela (setas do
// teclado, tela cheia). O detalhe técnico fica recolhido de propósito.

// Ícones de linha dos pilares (traço de 1.75, tamanho = 1em, cor = currentColor).
// Antes eram emojis — o que mais tirava o ar "premium" da página.
const GLYPHS = {
  conectividade: <><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><path d="M12 20h.01" /></>,
  seguranca: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>,
  gestao: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6M9 16h4" /></>,
  operacao: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" /></>,
}
function Glyph({ name }) {
  return (
    <svg className={s.glyph} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{GLYPHS[name]}</svg>
  )
}

const PILLARS = {
  conectividade: { label: 'Conectividade', icon: <Glyph name="conectividade" />, color: '#3B82F6' },
  seguranca: { label: 'Segurança', icon: <Glyph name="seguranca" />, color: '#8B5CF6' },
  gestao: { label: 'Gestão e processos', icon: <Glyph name="gestao" />, color: '#22C55E' },
  operacao: { label: 'Operação', icon: <Glyph name="operacao" />, color: '#F59E0B' },
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

// Save financeiro: valor por ano, em 36 meses (contrato), por mês ou uma vez.
// O total do painel soma o valor de cada case (só o mensal vira ano: × 12).
const SAVING_PERIODS = {
  anual: { label: 'Por ano', short: 'Por ano', suffix: '/ano', totalFactor: 1 },
  meses36: { label: 'Em 36 meses (contrato de 3 anos)', short: 'Em 36 meses', suffix: 'em 36 meses', totalFactor: 1 },
  mensal: { label: 'Por mês', short: 'Por mês', suffix: '/mês', totalFactor: 12 },
  unico: { label: 'Uma vez (economia única)', short: 'Uma vez', suffix: 'uma vez', totalFactor: 1 },
}
const fmtBRL = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: Number(n) % 1 ? 2 : 0 })
// "R$ 12.500,50" / "12500,5" / "12500.50" → 12500.5 (vazio → null)
function parseBRL(text) {
  const t = String(text ?? '').replace(/[^\d,.-]/g, '').trim()
  if (!t) return null
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normalized)
  return Number.isFinite(n) ? n : NaN
}
const countedSave = c => (c.saving_value ? c.saving_value * (SAVING_PERIODS[c.saving_period]?.totalFactor || 1) : 0)

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
    <span className={s.pillarIcon} style={{ width: size, height: size, fontSize: size * 0.46, color: p.color }}>
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
    saving_text: item?.saving_value != null ? String(item.saving_value).replace('.', ',') : '',
    saving_period: item?.saving_period || 'anual',
    saving_note: item?.saving_note || '',
  })
  const [tab, setTab] = useState('case')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const savingValue = parseBRL(form.saving_text)

  const save = async () => {
    if (!form.title.trim()) return
    if (Number.isNaN(savingValue) || savingValue < 0) { setTab('save'); setError('Valor do save inválido — use só números, ex: 12.500,00'); return }
    setSaving(true)
    setError('')
    try {
      const { saving_text, ...rest } = form
      const body = { ...rest, saving_value: savingValue }
      const saved = item
        ? (await api.put(`/success-cases/${item.id}`, body)).data
        : (await api.post('/success-cases', body)).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
      setSaving(false)
    }
  }

  return (
    <Modal title={item ? 'Editar case' : 'Novo case'} onClose={onClose} width={640}>
      <div className={s.editorTabs}>
        <button type="button" className={tab === 'case' ? s.editorTabOn : ''} onClick={() => setTab('case')}>Case</button>
        <button type="button" className={tab === 'save' ? s.editorTabOn : ''} onClick={() => setTab('save')}>
          Save financeiro{savingValue ? ` · ${fmtBRL(savingValue)}` : ''}
        </button>
      </div>
      {tab === 'save' ? (
        <>
          <p className={s.saveHint}>Quanto esta entrega economizou para a instituição. Entra no total “Save financeiro” do painel e na apresentação.</p>
          <div className={s.formRow}>
            <div className="form-group">
              <label className="label">Valor economizado (R$)</label>
              <input autoFocus inputMode="decimal" value={form.saving_text} onChange={e => set('saving_text', e.target.value)} placeholder="Ex: 12.500,00" />
            </div>
            <div className="form-group">
              <label className="label">Esse valor é</label>
              <select value={form.saving_period} onChange={e => set('saving_period', e.target.value)}>
                {Object.entries(SAVING_PERIODS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          {savingValue > 0 && (
            <p className={s.savePreview}>
              {form.saving_period === 'mensal'
                ? <>Equivale a <strong>{fmtBRL(savingValue * 12)}</strong> no ano.</>
                : <>Conta <strong>{fmtBRL(savingValue)}</strong> no total do Save financeiro.</>}
            </p>
          )}
          <div className="form-group">
            <label className="label">Como chegamos nesse valor (opcional)</label>
            <textarea rows={4} value={form.saving_note} maxLength={500} onChange={e => set('saving_note', e.target.value)}
              placeholder="Ex: Licença do sistema anterior custava R$ 1.200/mês; o GLPI é open source, sem custo de licença." />
          </div>
          {item?.saving_value != null && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => set('saving_text', '')}>Remover o save deste case</button>
          )}
        </>
      ) : (
      <>
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
            {Object.entries(PILLARS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
      </>
      )}
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

function Detail({ id, stats, year, writable, onClose, onEdit, onDelete, onChanged }) {
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
  const [savingStatus, setSavingStatus] = useState(false)
  const changeStatus = async status => {
    if (status === item.status) return
    setSavingStatus(true)
    try {
      const saved = (await api.put(`/success-cases/${id}`, { status })).data
      setItem(it => ({ ...it, ...saved, photos: it.photos }))
      onChanged?.()
    } catch (err) {
      await alertDialog(err.response?.data?.error || 'Erro ao mudar a situação.', { title: 'Erro', danger: true })
    }
    setSavingStatus(false)
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
        {writable ? (
          <div className={s.statusPicker} role="group" aria-label="Situação">
            {Object.entries(STATUSES).map(([k, v]) => (
              <button key={k} type="button" disabled={savingStatus}
                className={`${s.statusOption} ${item.status === k ? `${s.status} ${s[v.className]}` : ''}`}
                onClick={() => changeStatus(k)}>{v.label}</button>
            ))}
          </div>
        ) : <StatusBadge status={item.status} />}
        {item.completed_on && <span className={s.muted}>{item.status === 'concluido' ? 'Concluído em' : 'Previsto para'} {fmtMonth(item.completed_on)}</span>}
        {item.owner && <span className={s.muted}>· {item.owner}</span>}
      </div>
      {item.headline && <p className={s.detailHeadline}>{item.headline}</p>}
      <div className={s.blocks}>
        <div className={s.block}><span className={s.blockLabel}>Antes</span><p className={s.blockText}>{item.before_text || '—'}</p></div>
        <div className={s.block}><span className={s.blockLabel}>O que fizemos</span><p className={s.blockText}>{item.solution_text || '—'}</p></div>
        <ResultBox result={result} />
      </div>
      {item.saving_value > 0 && (
        <div className={s.saveBox}>
          <span className={s.blockLabel}>Save financeiro</span>
          <strong>{fmtBRL(item.saving_value)} <small>{SAVING_PERIODS[item.saving_period]?.suffix}</small></strong>
          {item.saving_period === 'mensal' && <span className={s.muted}>= {fmtBRL(countedSave(item))} no ano</span>}
          {item.saving_note && <p className={s.blockText}>{item.saving_note}</p>}
        </div>
      )}

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
          <button className="btn btn-ghost btn-sm" onClick={() => onDelete(item)}>Excluir</button>
          <button className="btn btn-primary btn-sm" onClick={() => onEdit(item)}>Editar</button>
        </div>
      )}
      {viewing && <PhotoViewer caseId={item.id} photo={viewing} onClose={() => setViewing(null)} />}
    </Modal>
  )
}

// Cores da situação nos arquivos baixados (fundo escuro, como a apresentação)
const DECK_STATUS = {
  concluido: { color: '4ADE80', bg: '153322' },
  piloto: { color: '93C5FD', bg: '172A4A' },
  andamento: { color: 'FBBF24', bg: '3A2C10' },
}

// Monta os dados da apresentação para baixar (utils/casesDeck.js desenha o
// PPTX e o PDF). Mesmo conteúdo do "Modo apresentação": capa + um case por
// slide, na ordem e com o filtro de pilar da tela. Fotos: as miniaturas.
async function buildDeckModel(cases, stats, year) {
  const photosById = {}
  await Promise.all(cases.filter(c => c.photo_count > 0).map(c =>
    api.get(`/success-cases/${c.id}`).then(r => { photosById[c.id] = (r.data.photos || []).map(p => p.thumb) }).catch(() => {})))
  const done = cases.filter(c => c.status === 'concluido').length
  const totalSave = cases.reduce((n, c) => n + countedSave(c), 0)
  const kpis = [
    { value: String(cases.length), label: 'entregas no ano' },
    { value: String(done), label: 'concluídas' },
  ]
  if (stats?.glpi_tickets != null) kpis.push({ value: fmtNum(stats.glpi_tickets), label: 'chamados registrados no GLPI' })
  if (totalSave > 0) kpis.push({ value: fmtBRL(totalSave), label: 'de save financeiro', accent: true })
  return {
    year,
    generatedAt: new Date().toLocaleDateString('pt-BR'),
    kpis,
    pillars: Object.entries(PILLARS)
      .map(([k, p]) => ({ label: p.label, color: p.color.slice(1), count: cases.filter(c => c.pillar === k).length }))
      .filter(p => p.count),
    slides: cases.map(c => {
      const p = PILLARS[c.pillar] || PILLARS.gestao
      const st = STATUSES[c.status] || STATUSES.concluido
      const result = resultOf(c, stats, year)
      return {
        title: c.title,
        headline: c.headline,
        pillarLabel: p.label,
        pillarColor: p.color.slice(1),
        status: { label: st.label, ...(DECK_STATUS[c.status] || DECK_STATUS.concluido) },
        month: c.completed_on ? fmtMonth(c.completed_on) : '',
        save: c.saving_value > 0 ? `Save ${fmtBRL(c.saving_value)} ${SAVING_PERIODS[c.saving_period]?.suffix || ''}`.trim() : '',
        before: c.before_text,
        solution: c.solution_text,
        result,
        photos: photosById[c.id] || [],
        notes: [c.headline, c.saving_note && `Save financeiro: ${c.saving_note}`, c.owner && `Responsáveis: ${c.owner}`].filter(Boolean).join('\n'),
      }
    }),
  }
}

// Botão "Baixar PPTX / PDF" (as bibliotecas só carregam no clique)
function DeckDownload({ cases, stats, year }) {
  const [busy, setBusy] = useState(null)
  const run = async format => {
    setBusy(format)
    try {
      const [model, deck] = await Promise.all([buildDeckModel(cases, stats, year), import('../utils/casesDeck')])
      await (format === 'pptx' ? deck.exportCasesPptx(model) : deck.exportCasesPdf(model))
    } catch (e) {
      console.error(e)
      await alertDialog('Não deu pra gerar o arquivo. Tenta de novo?', { title: 'Erro ao baixar', danger: true })
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('pptx')} title="Baixar a apresentação em PowerPoint (.pptx)">
        <LineIcon name="download" /> {busy === 'pptx' ? 'Gerando...' : 'PPTX'}
      </button>
      <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('pdf')} title="Baixar a apresentação em PDF">
        <LineIcon name="download" /> {busy === 'pdf' ? 'Gerando...' : 'PDF'}
      </button>
    </>
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
  const totalSave = cases.reduce((n, x) => n + countedSave(x), 0)
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
            {totalSave > 0 && <div><strong className={s.presSave}>{fmtBRL(totalSave)}</strong><span>de save financeiro</span></div>}
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
              {c.saving_value > 0 && <span className={s.presSaveChip}>{fmtBRL(c.saving_value)} {SAVING_PERIODS[c.saving_period]?.suffix}</span>}
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
  const [view, setView] = useState('cases') // cases | save
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
  const withSave = cases.filter(c => c.saving_value > 0).sort((a, b) => countedSave(b) - countedSave(a))
  const totalSave = withSave.reduce((n, c) => n + countedSave(c), 0)

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
            <select value={shownYear} onChange={e => setYear(Number(e.target.value))} aria-label="Ano">
              {data.years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
          {writable && <button className="btn btn-ghost" onClick={() => setEditing({})}>+ Novo case</button>}
          {filtered.length > 0 && <DeckDownload cases={filtered} stats={stats} year={shownYear} />}
          {cases.length > 0 && <button className="btn btn-primary" onClick={() => setPresenting(true)}>▶ Modo apresentação</button>}
        </div>
      </div>

      <div className={s.kpis}>
        <div className={s.kpi}><span>Entregas no ano</span><strong>{cases.length}</strong></div>
        <div className={s.kpi}><span>Concluídas</span><strong>{done}</strong></div>
        <div className={s.kpi}><span>Chamados no GLPI <em>ao vivo</em></span><strong>{stats?.glpi_tickets != null ? fmtNum(stats.glpi_tickets) : '—'}</strong></div>
        <div className={s.kpi}><span>Empréstimos em {shownYear} <em>ao vivo</em></span><strong>{stats?.loans_year != null ? fmtNum(stats.loans_year) : '—'}</strong></div>
        <button type="button" className={`${s.kpi} ${s.kpiSave}`} onClick={() => setView('save')} title="Ver o save de cada case">
          <span>Save financeiro</span>
          <strong>{fmtBRL(totalSave)}</strong>
          <small>{withSave.length} de {cases.length} cases com valor</small>
        </button>
      </div>

      <div className={s.viewTabs}>
        <button type="button" className={view === 'cases' ? s.viewTabOn : ''} onClick={() => setView('cases')}>Cases</button>
        <button type="button" className={view === 'save' ? s.viewTabOn : ''} onClick={() => setView('save')}>Save financeiro</button>
      </div>

      {view === 'save' ? (
        <div className={s.saveTable}>
          {withSave.length === 0 ? (
            <div className={s.empty}>
              <h3>Nenhum save cadastrado em {shownYear}</h3>
              <p>{writable ? 'Abra um case, clique em Editar e use a aba “Save financeiro” para informar quanto ele economizou.' : 'A equipe de TI ainda não informou o save dos cases.'}</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr><th>Case</th><th>Pilar</th><th className={s.num}>Valor</th><th>Período</th><th className={s.num}>Conta no total</th><th>Como chegamos nesse valor</th></tr>
              </thead>
              <tbody>
                {withSave.map(c => {
                  const p = PILLARS[c.pillar] || PILLARS.gestao
                  return (
                    <tr key={c.id} onClick={() => setOpenId(c.id)}>
                      <td className={s.saveCase}>{c.title}</td>
                      <td><span className={s.pillarText} style={{ color: p.color }}>{p.icon} {p.label}</span></td>
                      <td className={s.num}>{fmtBRL(c.saving_value)}</td>
                      <td>{SAVING_PERIODS[c.saving_period]?.short || '—'}</td>
                      <td className={`${s.num} ${s.saveYear}`}>{fmtBRL(countedSave(c))}</td>
                      <td className={s.saveNote}>{c.saving_note || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>Total ·{withSave.length} {withSave.length === 1 ? 'case' : 'cases'}</td><td className={`${s.num} ${s.saveYear}`}>{fmtBRL(totalSave)}</td><td /></tr>
              </tfoot>
            </table>
          )}
          {cases.length > withSave.length && withSave.length > 0 && (
            <p className={s.muted} style={{ marginTop: 10 }}>Sem valor informado: {cases.filter(c => !(c.saving_value > 0)).map(c => c.title).join(' · ')}</p>
          )}
        </div>
      ) : (
      <>
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
                    : <div className={s.coverIcon} style={{ '--pillar': p.color }}><PillarIcon pillar={c.pillar} size={52} /></div>}
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
                    {c.saving_value > 0 && (
                      <span className={s.cardSave}>{fmtBRL(c.saving_value)} {SAVING_PERIODS[c.saving_period]?.suffix}</span>
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
      </>
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
          onChanged={load}
        />
      )}
      {editing && <Editor item={editing.id ? editing : null} year={shownYear} onClose={() => setEditing(null)} onSaved={onSaved} />}
      {presenting && <Presentation cases={filtered} stats={stats} year={shownYear} onClose={() => setPresenting(false)} />}
    </div>
  )
}

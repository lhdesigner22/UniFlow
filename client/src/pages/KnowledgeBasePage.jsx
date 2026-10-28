import { useState, useEffect, useMemo } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { downloadFile } from '../utils/download'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
import s from './KnowledgeBasePage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import { safeHref } from '../utils/safeHref'
import MachineStandards from '../components/kb/MachineStandards'

// Aba com tela própria (não é categoria de artigo): ver components/kb/MachineStandards.jsx
const MACHINES_TAB = 'maquinas'

// O anexo vai pro Google Drive (storage externo — ver server/src/lib/driveClient.js),
// não mais pro banco. Teto de 95 MB — o máximo seguro dentro do limite real
// de corpo de requisição da Cloudflare (100 MB no plano atual, teto de
// plataforma). Mesmo valor aplicado no servidor.
const MAX_FILE_BYTES = 95 * 1024 * 1024

const CATEGORIES = [
  { key: 'texto_pronto', label: 'Textos prontos', icon: '📋' },
  { key: 'politica', label: 'Políticas', icon: '📜' },
  { key: 'documento', label: 'Documentos', icon: '📄' },
  { key: 'outro', label: 'Outros', icon: '🔖' },
]
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]))

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

function Editor({ article, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: article?.title || '',
    category: article?.category || 'texto_pronto',
    content: article?.content || '',
    link_url: article?.link_url || '',
    department_id: article ? article.department_id : defaultDepartment(),
  })
  const [existingAttachment, setExistingAttachment] = useState(
    article?.has_attachment ? { name: article.attachment_name, type: article.attachment_type } : null
  )
  const [newAttachmentFile, setNewAttachmentFile] = useState(null) // File — só enviado no save, depois do artigo já existir
  const [removeAttachment, setRemoveAttachment] = useState(false)
  const [fileError, setFileError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)

  const onFileChange = e => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite escolher o mesmo arquivo de novo depois, se precisar
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`Arquivo grande demais (${(file.size / 1024 / 1024).toFixed(1)} MB) — máx. 95 MB.`)
      return
    }
    setFileError('')
    setNewAttachmentFile(file)
    setRemoveAttachment(false)
  }

  const removeExisting = () => { setExistingAttachment(null); setRemoveAttachment(true) }

  const save = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    setFileError('')
    try {
      // 1) Campos de texto primeiro — cria o artigo, se for novo, ou
      // atualiza os campos, se já existir. O anexo (se houver) precisa de
      // um artigo já existente, então vem depois.
      let saved = article
        ? (await api.put(`/kb/${article.id}`, form)).data
        : (await api.post('/kb', form)).data

      if (newAttachmentFile) {
        setSaving(false)
        setUploadingFile(true)
        const fd = new FormData()
        fd.append('file', newAttachmentFile)
        // Timeout maior que o padrão (30s) — um anexo de até 95 MB pode
        // demorar mais que isso numa conexão mais lenta.
        saved = (await api.post(`/kb/${saved.id}/attachment`, fd, { timeout: 300_000 })).data
        setUploadingFile(false)
      } else if (removeAttachment) {
        saved = (await api.delete(`/kb/${saved.id}/attachment`)).data
      }

      onSaved(saved)
    } catch (e) {
      setSaving(false)
      setUploadingFile(false)
      setFileError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
    }
  }

  return (
    <Modal title={article ? 'Editar artigo' : 'Novo artigo'} onClose={onClose} width={560}>
      <div className="form-group">
        <label className="label">Título</label>
        <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Resposta padrão — reset de senha" />
      </div>
      <div className="form-group">
        <label className="label">Categoria</label>
        <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
          {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="label">Conteúdo</label>
        <textarea
          rows={8}
          value={form.content}
          onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          placeholder="Texto do artigo — pra textos prontos de chamado, escreva já do jeito que vai ser copiado e colado na resposta."
          className={s.contentArea}
        />
      </div>
      <div className="form-group">
        <label className="label">Anexo (opcional, até 95 MB)</label>
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
        {fileError && <p className={s.fileError}>{fileError}</p>}
      </div>
      <div className="form-group">
        <label className="label">Ou link do documento (opcional)</label>
        <input
          value={form.link_url}
          onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))}
          placeholder="Ex: link do Google Drive/Docs — melhor pra arquivos grandes"
        />
      </div>
      <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.title.trim() || saving || uploadingFile} onClick={save}>
        {uploadingFile ? 'Enviando anexo...' : saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

export default function KnowledgeBasePage() {
  const { user } = useAuthStore()
  const [articles, setArticles] = useState(null)
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, artigo = editar
  const [copiedId, setCopiedId] = useState(null)

  const [machines, setMachines] = useState([])

  useLiveRefresh(['kb'], () => load())
  useLiveRefresh(['machine-standards'], () => loadMachines())
  const load = () => {
    api.get('/kb')
      .then(r => setArticles(r.data || []))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false))
  }
  const loadMachines = () => api.get('/machine-standards').then(r => setMachines(r.data || [])).catch(() => {})
  useEffect(() => { load(); loadMachines() }, [])

  const filtered = useMemo(() => {
    if (!articles) return []
    const q = search.trim().toLowerCase()
    return articles.filter(a => {
      if (categoryFilter && a.category !== categoryFilter) return false
      if (q && !a.title.toLowerCase().includes(q) && !(a.content || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [articles, categoryFilter, search])

  const countByCategory = useMemo(() => {
    const counts = {}
    for (const a of articles || []) counts[a.category] = (counts[a.category] || 0) + 1
    return counts
  }, [articles])

  const onSaved = article => {
    setArticles(prev => {
      const exists = (prev || []).some(a => a.id === article.id)
      const next = exists ? prev.map(a => a.id === article.id ? article : a) : [article, ...(prev || [])]
      return next
    })
    setEditing(null)
  }

  const copyContent = async a => {
    try {
      await navigator.clipboard.writeText(a.content || '')
      setCopiedId(a.id)
      setTimeout(() => setCopiedId(prev => (prev === a.id ? null : prev)), 1800)
    } catch { /* clipboard indisponível — ignora silenciosamente */ }
  }

  const deleteArticle = async a => {
    const ok = await confirmDialog(`Excluir o artigo "${a.title}"?`, { title: 'Excluir artigo' })
    if (!ok) return
    try {
      await api.delete(`/kb/${a.id}`)
      setArticles(prev => (prev || []).filter(x => x.id !== a.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir o artigo.', { title: 'Erro', danger: true })
    }
  }

  // Auditor também edita/exclui QUALQUER artigo (é a área liberada pra esse
  // perfil escrever — ver server/src/routes/kb.js).
  const writable = canEditModule(user, 'kb')
  const canEdit = a => writable && (a.created_by === user?.id || user?.system_role === 'super_admin' || user?.system_role === 'auditor')

  if (loading) return <div className={s.loading}>Carregando base de conhecimento...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Base de Conhecimento</h1>
          <p className={s.sub}>Textos prontos de chamado, políticas, padronização de máquinas e outros materiais de referência da equipe.</p>
        </div>
        {writable && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo artigo</button>}
      </div>

      <div className={s.toolbar}>
        <div className={s.tabs}>
          <button className={`${s.tab} ${!categoryFilter ? s.tabActive : ''}`} onClick={() => setCategoryFilter('')}>
            Todos <span className={s.tabCount}>{(articles || []).length}</span>
          </button>
          {CATEGORIES.map(c => (
            <button key={c.key} className={`${s.tab} ${categoryFilter === c.key ? s.tabActive : ''}`} onClick={() => setCategoryFilter(c.key)}>
              {c.icon} {c.label} <span className={s.tabCount}>{countByCategory[c.key] || 0}</span>
            </button>
          ))}
          <button className={`${s.tab} ${categoryFilter === MACHINES_TAB ? s.tabActive : ''}`} onClick={() => setCategoryFilter(MACHINES_TAB)}>
            🖥️ Padronização de máquinas <span className={s.tabCount}>{machines.length}</span>
          </button>
        </div>
        {categoryFilter !== MACHINES_TAB && (
          <input className={s.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por título ou conteúdo..." />
        )}
      </div>

      {categoryFilter === MACHINES_TAB ? (
        <MachineStandards items={machines} setItems={setMachines} writable={writable} />
      ) : filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhum artigo ainda</h3>
          <p>
            {(articles || []).length > 0
              ? 'Nenhum artigo bate com esse filtro.'
              : 'Comece adicionando um texto pronto de chamado, uma política ou outro material de referência.'}
          </p>
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((a, i) => {
            const cat = CATEGORY_MAP[a.category] || CATEGORY_MAP.outro
            return (
              <Reveal key={a.id} delay={Math.min(i, 10) * 50} className={s.card}>
                <div className={s.cardHeader}>
                  <span className={s.badge}>{cat.icon} {cat.label}</span>
                  {canEdit(a) && (
                    <div className={s.cardActions}>
                      <button className={s.iconBtn} title="Editar" onClick={() => setEditing(a)}>✏️</button>
                      <button className={s.iconBtn} title="Excluir" onClick={() => deleteArticle(a)}>🗑️</button>
                    </div>
                  )}
                </div>
                <h3 className={s.cardTitle}>{a.title}</h3>
                {a.content && <p className={s.cardContent}>{a.content}</p>}
                {!!a.has_attachment && ( /* vem 0/1 do banco — sem o !! o React desenha o "0" */
                  <button type="button" className={s.cardLink} onClick={() => downloadFile(`/kb/${a.id}/attachment`, a.attachment_name || 'anexo')}>
                    📎 Baixar {a.attachment_name}
                  </button>
                )}
                {a.link_url && (
                  <a className={s.cardLink} href={safeHref(a.link_url)} target="_blank" rel="noreferrer">🔗 Abrir documento</a>
                )}
                <div className={s.cardFooter}>
                  <span className={s.cardMeta}>{a.author_name || 'Alguém'} · {timeAgo(a.updated_at)}</span>
                  {a.content && (
                    <button className="btn btn-ghost btn-sm" onClick={() => copyContent(a)}>
                      {copiedId === a.id ? '✓ Copiado' : '📋 Copiar'}
                    </button>
                  )}
                </div>
              </Reveal>
            )
          })}
        </div>
      )}

      {editing && (
        <Editor
          article={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

import { useState, useEffect, useMemo } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { downloadFile } from '../utils/download'
import Modal from '../components/common/Modal'
import LineIcon from '../components/common/LineIcon'
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
  { key: 'texto_pronto', label: 'Textos prontos' },
  { key: 'politica', label: 'Políticas' },
  { key: 'documento', label: 'Documentos' },
  { key: 'outro', label: 'Outros' },
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
        <label htmlFor="knowledge-base-titulo" className="label">Título</label>
        <input id="knowledge-base-titulo" autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Resposta padrão — reset de senha" />
      </div>
      <div className="form-group">
        <label htmlFor="knowledge-base-categoria" className="label">Categoria</label>
        <select id="knowledge-base-categoria" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
          {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="knowledge-base-conteudo" className="label">Conteúdo</label>
        <textarea id="knowledge-base-conteudo"
          rows={8}
          value={form.content}
          onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          placeholder="Texto do artigo — pra textos prontos de chamado, escreva já do jeito que vai ser copiado e colado na resposta."
          className={s.contentArea}
        />
      </div>
      <div className="form-group">
        <label htmlFor="knowledge-base-anexo" className="label">Anexo (opcional, até 95 MB)</label>
        {newAttachmentFile ? (
          <div className={s.attachmentRow}>
            <span><LineIcon name="download" size={14} /> {newAttachmentFile.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewAttachmentFile(null)}>Cancelar</button>
          </div>
        ) : existingAttachment ? (
          <div className={s.attachmentRow}>
            <span><LineIcon name="download" size={14} /> {existingAttachment.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={removeExisting}>Remover anexo</button>
          </div>
        ) : (
          <input id="knowledge-base-anexo" type="file" onChange={onFileChange} />
        )}
        {fileError && <p role="alert" className={s.fileError}>{fileError}</p>}
      </div>
      <div className="form-group">
        <label htmlFor="knowledge-base-ou-link-do-documento-opc" className="label">Ou link do documento (opcional)</label>
        <input id="knowledge-base-ou-link-do-documento-opc"
          value={form.link_url}
          onChange={e => setForm(f => ({ ...f, link_url: e.target.value }))}
          placeholder="Ex: link do Google Drive/Docs — melhor pra arquivos grandes"
        />
      </div>
      <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />
      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!form.title.trim() || saving || uploadingFile} onClick={save}>
        {uploadingFile ? 'Enviando anexo...' : saving ? 'Salvando...' : article ? 'Salvar alterações' : 'Criar artigo'}
      </button>
    </Modal>
  )
}

// Destaca o termo buscado dentro de um texto (sem HTML: só divide e envolve em <mark>)
function Highlight({ text, query }) {
  const q = query.trim()
  if (!q || !text) return text || null
  const lower = text.toLowerCase(), needle = q.toLowerCase()
  const parts = []
  let i = 0
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, i)) {
    if (at > i) parts.push(text.slice(i, at))
    parts.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>)
    i = at + q.length
  }
  parts.push(text.slice(i))
  return parts
}

export default function KnowledgeBasePage() {
  const { user } = useAuthStore()
  const [articles, setArticles] = useState(null)
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, artigo = editar
  const [copiedId, setCopiedId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [reading, setReading] = useState(false) // celular: true = mostra o artigo no lugar da lista

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

  // artigo aberto: o escolhido, se ainda está no filtro; senão o primeiro da lista
  const selected = filtered.find(a => a.id === selectedId) || filtered[0] || null

  const onSaved = article => {
    setArticles(prev => {
      const exists = (prev || []).some(a => a.id === article.id)
      const next = exists ? prev.map(a => a.id === article.id ? article : a) : [article, ...(prev || [])]
      return next
    })
    // o artigo salvo abre na leitura — sai do filtro/busca que o esconderia
    if (categoryFilter && categoryFilter !== article.category) setCategoryFilter('')
    setSearch('')
    setSelectedId(article.id)
    setReading(true)
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
      setReading(false)
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir o artigo.', { title: 'Erro', danger: true })
    }
  }

  // Auditor também edita/exclui QUALQUER artigo (é a área liberada pra esse
  // perfil escrever — ver server/src/routes/kb.js).
  const writable = canEditModule(user, 'kb')
  const canEdit = a => writable && (a.created_by === user?.id || user?.system_role === 'super_admin' || user?.system_role === 'auditor')

  const open = a => { setSelectedId(a.id); setReading(true) }

  if (loading) return <div className={s.loading}>Carregando base de conhecimento...</div>

  const total = (articles || []).length
  const isReply = selected?.category === 'texto_pronto'

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Base de Conhecimento</h1>
          <p className={s.sub}>Textos prontos de chamado, políticas e materiais de referência da equipe.</p>
        </div>
        {writable && categoryFilter !== MACHINES_TAB && (
          <button className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Novo artigo</button>
        )}
      </div>

      <nav className={s.tabs} aria-label="Categorias">
        {[['', 'Todos', total], ...CATEGORIES.map(c => [c.key, c.label, countByCategory[c.key] || 0]), [MACHINES_TAB, 'Padronização de máquinas', machines.length]].map(([key, label, count]) => (
          <button key={key || 'todos'} type="button" aria-current={categoryFilter === key ? 'true' : undefined}
            className={`${s.tab} ${categoryFilter === key ? s.tabActive : ''}`} onClick={() => { setCategoryFilter(key); setReading(false) }}>
            {label}<span className={s.tabCount}>{count}</span>
          </button>
        ))}
      </nav>

      {categoryFilter === MACHINES_TAB ? (
        <MachineStandards items={machines} setItems={setMachines} writable={writable} />
      ) : total === 0 ? (
        <div className={s.empty}>
          <h2>A base está vazia</h2>
          <p>Comece por um texto pronto de chamado: escreva do jeito que ele vai ser colado na resposta.</p>
          {writable && <button className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Novo artigo</button>}
        </div>
      ) : (
        <div className={s.layout} data-reading={reading || undefined}>
          <div className={s.listPane}>
            <label className={s.search}>
              <LineIcon name="search" size={15} />
              <span className="sr-only">Buscar artigos</span>
              <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por título ou conteúdo" />
            </label>
            <p className={s.listCount} role="status">
              {search.trim() ? `${filtered.length} de ${categoryFilter ? countByCategory[categoryFilter] || 0 : total} ${filtered.length === 1 ? 'artigo' : 'artigos'}` : `${filtered.length} ${filtered.length === 1 ? 'artigo' : 'artigos'}`}
            </p>
            {filtered.length === 0 ? (
              <p className={s.noMatch}>Nada com "{search.trim()}" {categoryFilter ? 'nesta categoria' : 'na base'}. Tente outra palavra.</p>
            ) : (
              <ul className={s.list}>
                {filtered.map(a => (
                  <li key={a.id}>
                    <button type="button" className={`${s.item} ${selected?.id === a.id ? s.itemActive : ''}`}
                      aria-current={selected?.id === a.id ? 'true' : undefined} onClick={() => open(a)}>
                      <span className={s.itemTitle}><Highlight text={a.title} query={search} /></span>
                      {a.content && <span className={s.itemExcerpt}>{a.content.replace(/\s+/g, ' ')}</span>}
                      <span className={s.itemMeta}>
                        {!categoryFilter && <>{(CATEGORY_MAP[a.category] || CATEGORY_MAP.outro).label}, </>}
                        {timeAgo(a.updated_at)}
                        {!!a.has_attachment && <LineIcon name="download" size={12} title="Tem anexo" />}
                        {a.link_url && <LineIcon name="link" size={12} title="Tem link" />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            <article className={s.reader} aria-labelledby="kb-article-title">
              <button type="button" className={s.back} onClick={() => setReading(false)}>
                <LineIcon name="chevronLeft" size={15} /> Voltar para a lista
              </button>
              <header className={s.readerHead}>
                <div className={s.readerTitleBox}>
                  <span className={s.readerCategory}>{(CATEGORY_MAP[selected.category] || CATEGORY_MAP.outro).label}</span>
                  <h2 id="kb-article-title" className={s.readerTitle}>{selected.title}</h2>
                  <p className={s.readerMeta}>{selected.author_name || 'Alguém'}, atualizado {timeAgo(selected.updated_at)}</p>
                </div>
                {canEdit(selected) && (
                  <div className={s.readerActions}>
                    <button type="button" className={s.iconBtn} onClick={() => setEditing(selected)} aria-label="Editar artigo" title="Editar">
                      <LineIcon name="edit" size={16} />
                    </button>
                    <button type="button" className={`${s.iconBtn} ${s.iconDanger}`} onClick={() => deleteArticle(selected)} aria-label="Excluir artigo" title="Excluir">
                      <LineIcon name="trash" size={16} />
                    </button>
                  </div>
                )}
              </header>

              {selected.content ? (
                <div className={isReply ? s.reply : s.body}>
                  <p className={s.text}><Highlight text={selected.content} query={search} /></p>
                </div>
              ) : (
                <p className={s.noContent}>Este artigo não tem texto, só {selected.has_attachment ? 'o anexo' : 'o link'} abaixo.</p>
              )}

              <div className={s.readerFoot}>
                {selected.content && (
                  <button type="button" className={`btn ${isReply ? 'btn-primary' : 'btn-ghost'}`} onClick={() => copyContent(selected)}>
                    <LineIcon name={copiedId === selected.id ? 'check' : 'list'} size={15} />
                    {copiedId === selected.id ? 'Copiado' : isReply ? 'Copiar texto' : 'Copiar'}
                  </button>
                )}
                {!!selected.has_attachment && ( /* vem 0/1 do banco — sem o !! o React desenha o "0" */
                  <button type="button" className="btn btn-ghost" onClick={() => downloadFile(`/kb/${selected.id}/attachment`, selected.attachment_name || 'anexo')}>
                    <LineIcon name="download" size={15} /> Baixar {selected.attachment_name}
                  </button>
                )}
                {selected.link_url && (
                  <a className="btn btn-ghost" href={safeHref(selected.link_url)} target="_blank" rel="noreferrer">
                    <LineIcon name="link" size={15} /> Abrir documento
                  </a>
                )}
                <span className="sr-only" role="status">{copiedId === selected.id ? 'Texto copiado' : ''}</span>
              </div>
            </article>
          )}
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

import { useState, useEffect, useMemo } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { canEdit as canEditModule } from '../utils/permissions'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import { downloadFile } from '../utils/download'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
import s from './GestaoPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'
import { safeHref } from '../utils/safeHref'

// Mesma infra da Base de Conhecimento (kb_articles + upload no Google
// Drive) — só que numa categoria própria ("gestao"), que o servidor já
// deixa de fora da listagem geral da Base de Conhecimento (ver
// server/src/routes/kb.js). Por isso sempre manda/filtra category:'gestao'
// aqui, sem abas de categoria (é uma seção só).
const CATEGORY = 'gestao'
const MAX_FILE_BYTES = 95 * 1024 * 1024

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

function Editor({ doc, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: doc?.title || '',
    content: doc?.content || '',
    link_url: doc?.link_url || '',
    department_id: doc ? doc.department_id : defaultDepartment(),
  })
  const [existingAttachment, setExistingAttachment] = useState(
    doc?.has_attachment ? { name: doc.attachment_name, type: doc.attachment_type } : null
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
      const payload = { ...form, category: CATEGORY }
      let saved = doc
        ? (await api.put(`/kb/${doc.id}`, payload)).data
        : (await api.post('/kb', payload)).data

      if (newAttachmentFile) {
        setSaving(false)
        setUploadingFile(true)
        const fd = new FormData()
        fd.append('file', newAttachmentFile)
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
    <Modal title={doc ? 'Editar documento' : 'Novo documento'} onClose={onClose} width={560}>
      <div className="form-group">
        <label className="label">Título</label>
        <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex: Relatório mensal — como montar" />
      </div>
      <div className="form-group">
        <label className="label">Conteúdo</label>
        <textarea
          rows={8}
          value={form.content}
          onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          placeholder="Texto da documentação..."
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

export default function GestaoPage() {
  const { user } = useAuthStore()
  const [docs, setDocs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, doc = editar
  const [copiedId, setCopiedId] = useState(null)

  useLiveRefresh(['kb'], () => load())
  const load = () => {
    api.get('/kb', { params: { category: CATEGORY } })
      .then(r => setDocs(r.data || []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (!docs) return []
    const q = search.trim().toLowerCase()
    if (!q) return docs
    return docs.filter(d => d.title.toLowerCase().includes(q) || (d.content || '').toLowerCase().includes(q))
  }, [docs, search])

  const onSaved = doc => {
    setDocs(prev => {
      const exists = (prev || []).some(d => d.id === doc.id)
      return exists ? prev.map(d => d.id === doc.id ? doc : d) : [doc, ...(prev || [])]
    })
    setEditing(null)
  }

  const copyContent = async d => {
    try {
      await navigator.clipboard.writeText(d.content || '')
      setCopiedId(d.id)
      setTimeout(() => setCopiedId(prev => (prev === d.id ? null : prev)), 1800)
    } catch { /* clipboard indisponível — ignora silenciosamente */ }
  }

  const deleteDoc = async d => {
    const ok = await confirmDialog(`Excluir "${d.title}"?`, { title: 'Excluir documento' })
    if (!ok) return
    try {
      await api.delete(`/kb/${d.id}`)
      setDocs(prev => (prev || []).filter(x => x.id !== d.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir.', { title: 'Erro', danger: true })
    }
  }

  // Mesma regra da Base de Conhecimento: autor, super_admin ou auditor.
  const writable = canEditModule(user, 'gestao')
  const canEdit = d => writable && (d.created_by === user?.id || user?.system_role === 'super_admin' || user?.system_role === 'auditor')

  if (loading) return <div className={s.loading}>Carregando Gestão...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Gestão</h1>
          <p className={s.sub}>Documentações de gestão — relatórios e materiais de referência da equipe.</p>
        </div>
        {writable && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo documento</button>}
      </div>

      <div className={s.toolbar}>
        <input className={s.search} value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por título ou conteúdo..." />
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhum documento ainda</h3>
          <p>
            {(docs || []).length > 0
              ? 'Nenhum documento bate com esse filtro.'
              : 'Comece adicionando uma documentação sobre relatório ou outro material de gestão.'}
          </p>
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((d, i) => (
            <Reveal key={d.id} delay={Math.min(i, 10) * 50} className={s.card}>
              <div className={s.cardHeader}>
                <h3 className={s.cardTitle}>{d.title}</h3>
                {canEdit(d) && (
                  <div className={s.cardActions}>
                    <button className={s.iconBtn} title="Editar" onClick={() => setEditing(d)}>✏️</button>
                    <button className={s.iconBtn} title="Excluir" onClick={() => deleteDoc(d)}>🗑️</button>
                  </div>
                )}
              </div>
              {d.content && <p className={s.cardContent}>{d.content}</p>}
              {!!d.has_attachment && (
                <button type="button" className={s.cardLink} onClick={() => downloadFile(`/kb/${d.id}/attachment`, d.attachment_name || 'anexo')}>
                  📎 Baixar {d.attachment_name}
                </button>
              )}
              {d.link_url && (
                <a className={s.cardLink} href={safeHref(d.link_url)} target="_blank" rel="noreferrer">🔗 Abrir documento</a>
              )}
              <div className={s.cardFooter}>
                <span className={s.cardMeta}>{d.author_name || 'Alguém'} · {timeAgo(d.updated_at)}</span>
                {d.content && (
                  <button className="btn btn-ghost btn-sm" onClick={() => copyContent(d)}>
                    {copiedId === d.id ? '✓ Copiado' : '📋 Copiar'}
                  </button>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      )}

      {editing && (
        <Editor
          doc={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

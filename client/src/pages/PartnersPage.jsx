import { useState, useEffect } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
import s from './PartnersPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'

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

function Editor({ partner, onClose, onSaved }) {
  const [form, setForm] = useState({
    company_name: partner?.company_name || '',
    responsible_name: partner?.responsible_name || '',
    phone: partner?.phone || '',
    cnpj: partner?.cnpj || '',
    responsibility: partner?.responsibility || '',
    department_id: partner ? partner.department_id : defaultDepartment(),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!form.company_name.trim()) return
    setSaving(true)
    setError('')
    try {
      const saved = partner
        ? (await api.put(`/partners/${partner.id}`, form)).data
        : (await api.post('/partners', form)).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={partner ? 'Editar parceiro' : 'Novo parceiro'} onClose={onClose} width={520}>
      <div className="form-group">
        <label className="label">Nome da empresa parceira</label>
        <input autoFocus value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Ex: Nome da empresa" />
      </div>
      <div className="form-group">
        <label className="label">Responsável</label>
        <input value={form.responsible_name} onChange={e => setForm(f => ({ ...f, responsible_name: e.target.value }))} placeholder="Nome do contato responsável" />
      </div>
      <div className="form-group">
        <label className="label">Telefone</label>
        <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(00) 0000-0000" />
      </div>
      <div className="form-group">
        <label className="label">CNPJ registrado</label>
        <input value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" />
      </div>
      <div className="form-group">
        <label className="label">Do que eles são responsáveis</label>
        <textarea rows={3} value={form.responsibility} onChange={e => setForm(f => ({ ...f, responsibility: e.target.value }))} placeholder="Ex: Manutenção de impressoras, fornecimento de material..." />
      </div>
      {error && <p className={s.fileError}>{error}</p>}
      <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={!form.company_name.trim() || saving}
        onClick={save}
      >
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

export default function PartnersPage() {
  const { user } = useAuthStore()
  const [partners, setPartners] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, parceiro = editar

  useLiveRefresh(['partners'], () => load())
  const load = () => {
    api.get('/partners')
      .then(r => setPartners(r.data || []))
      .catch(() => setPartners([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const onSaved = partner => {
    setPartners(prev => {
      const exists = (prev || []).some(p => p.id === partner.id)
      return exists ? prev.map(p => p.id === partner.id ? partner : p) : [...(prev || []), partner]
    })
    setEditing(null)
  }

  const deletePartner = async p => {
    const ok = await confirmDialog(`Excluir o parceiro "${p.company_name}"?`, { title: 'Excluir parceiro' })
    if (!ok) return
    try {
      await api.delete(`/partners/${p.id}`)
      setPartners(prev => (prev || []).filter(x => x.id !== p.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Erro ao excluir o parceiro.', { title: 'Erro', danger: true })
    }
  }

  const canEdit = p => p.created_by === user?.id || user?.system_role === 'super_admin'

  if (loading) return <div className={s.loading}>Carregando parceiros...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Parceiros</h1>
          <p className={s.sub}>Empresas parceiras — responsável, telefone, CNPJ e do que elas cuidam.</p>
        </div>
        {user?.system_role === 'super_admin' && (
          <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo parceiro</button>
        )}
      </div>

      {(partners || []).length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhum parceiro cadastrado</h3>
          <p>{user?.system_role === 'super_admin' ? 'Cadastre a primeira empresa parceira.' : 'Peça pra um Super Admin cadastrar.'}</p>
        </div>
      ) : (
        <div className={s.grid}>
          {partners.map((p, i) => (
            <Reveal key={p.id} delay={Math.min(i, 10) * 50} className={s.card}>
              <div className={s.cardHeader}>
                <h3 className={s.cardTitle}>{p.company_name}</h3>
                {canEdit(p) && (
                  <div className={s.cardActions}>
                    <button className={s.iconBtn} title="Editar" onClick={() => setEditing(p)}>✏️</button>
                    <button className={s.iconBtn} title="Excluir" onClick={() => deletePartner(p)}>🗑️</button>
                  </div>
                )}
              </div>
              {p.responsible_name && <p className={s.cardLine}>👤 {p.responsible_name}</p>}
              {p.phone && <p className={s.cardLine}>📞 {p.phone}</p>}
              {p.cnpj && <p className={s.cardLine}>CNPJ: <span className={s.mono}>{p.cnpj}</span></p>}
              {p.responsibility && <p className={s.cardResponsibility}>{p.responsibility}</p>}
              <div className={s.cardFooter}>
                <span className={s.cardMeta}>{p.author_name || 'Alguém'} · {timeAgo(p.updated_at)}</span>
              </div>
            </Reveal>
          ))}
        </div>
      )}

      {editing && (
        <Editor
          partner={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

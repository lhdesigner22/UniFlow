import { useState, useEffect, useMemo } from 'react'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useCopy } from '../hooks/useCopy'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
import s from './PartnersPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'

// Parceiros: diretório "quem cuida do quê". A pergunta de quem abre é "quem eu
// chamo para resolver X?" — por isso a responsabilidade vem em destaque e há busca.

const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

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
      setError(e.response?.data?.error || 'Não deu para salvar o parceiro. Tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={partner ? 'Editar parceiro' : 'Novo parceiro'} onClose={onClose} width={520}>
      <div className="form-group">
        <label htmlFor="partners-nome-da-empresa-parceira" className="label">Empresa parceira</label>
        <input id="partners-nome-da-empresa-parceira" autoFocus value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Ex: PrintTech Soluções" />
      </div>
      <div className="form-group">
        <label htmlFor="partners-do-que-eles-sao-responsa" className="label">Do que eles cuidam</label>
        <textarea id="partners-do-que-eles-sao-responsa" rows={3} value={form.responsibility} onChange={e => setForm(f => ({ ...f, responsibility: e.target.value }))} placeholder="Ex: manutenção e toner das impressoras de todos os prédios" />
      </div>
      <div className="form-group">
        <label htmlFor="partners-responsavel" className="label">Responsável</label>
        <input id="partners-responsavel" value={form.responsible_name} onChange={e => setForm(f => ({ ...f, responsible_name: e.target.value }))} placeholder="Com quem falar na empresa" />
      </div>
      <div className="form-group">
        <label htmlFor="partners-telefone" className="label">Telefone</label>
        <input id="partners-telefone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(00) 0000-0000" />
      </div>
      <div className="form-group">
        <label htmlFor="partners-cnpj-registrado" className="label">CNPJ</label>
        <input id="partners-cnpj-registrado" value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" />
      </div>
      {error && <p role="alert" className={s.fileError}>{error}</p>}
      <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={!form.company_name.trim() || saving}
        onClick={save}
      >
        {saving ? 'Salvando…' : partner ? 'Salvar alterações' : 'Cadastrar parceiro'}
      </button>
    </Modal>
  )
}

export default function PartnersPage() {
  const { user } = useAuthStore()
  const [partners, setPartners] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, parceiro = editar
  const [q, setQ] = useState('')
  const { copied, copy } = useCopy()

  useLiveRefresh(['partners'], () => load())
  const load = () => {
    api.get('/partners')
      .then(r => setPartners(r.data || []))
      .catch(() => setPartners([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const list = useMemo(() => {
    const term = norm(q.trim())
    return (partners || [])
      .filter(p => !term || norm(`${p.company_name} ${p.responsibility} ${p.responsible_name}`).includes(term))
      .sort((a, b) => a.company_name.localeCompare(b.company_name, 'pt-BR'))
  }, [partners, q])

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
      await alertDialog(e.response?.data?.error || 'Não deu para excluir o parceiro.', { title: 'Erro', danger: true })
    }
  }

  const canEdit = p => p.created_by === user?.id || user?.system_role === 'super_admin'
  const isSuper = user?.system_role === 'super_admin'
  const copyBtn = (k, text, what) => (
    <button type="button" className={s.copyBtn} onClick={() => copy(k, text)} aria-label={copied === k ? `${what} copiado` : `Copiar ${what}`}>
      <LineIcon name={copied === k ? 'check' : 'copy'} size={13} />{copied === k ? 'Copiado' : 'Copiar'}
    </button>
  )

  if (loading) return <div className={s.loading}>Carregando parceiros…</div>
  const total = (partners || []).length

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>Parceiros</h1>
          <p className={s.sub}>Quem cuida do quê: as empresas parceiras, com quem falar e como ligar.</p>
        </div>
        {isSuper && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Novo parceiro</button>}
      </header>

      {total > 0 && (
        <label className={s.search}>
          <LineIcon name="search" size={16} />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Procurar por empresa, serviço ou pessoa (ex.: impressora)" aria-label="Procurar parceiro" />
        </label>
      )}

      {total === 0 ? (
        <div className={s.empty}>
          <h2>Nenhum parceiro cadastrado</h2>
          <p>{isSuper ? 'Use "Novo parceiro" para cadastrar quem presta serviço para a escola.' : 'Peça a um Super Admin para cadastrar os parceiros.'}</p>
        </div>
      ) : list.length === 0 ? (
        <p className={s.noMatch} role="status">Nenhum parceiro com "{q.trim()}". Tente outra palavra.</p>
      ) : (
        <ul className={s.list}>
          {list.map(p => (
            <li key={p.id} className={s.row}>
              <div className={s.what}>
                <h2 className={s.name}>{p.company_name}</h2>
                {p.responsibility
                  ? <p className={s.responsibility}>{p.responsibility}</p>
                  : <p className={s.missing}>Sem descrição do que cuidam.</p>}
              </div>
              <div className={s.contact}>
                {/[\p{L}\d]/u.test(p.responsible_name || '') && <span className={s.person}><LineIcon name="user" size={14} />{p.responsible_name}</span>}
                {p.phone && (
                  <span className={s.line}>
                    <a className={s.phone} href={`tel:${p.phone.replace(/[^\d+]/g, '')}`}><LineIcon name="phone" size={14} />{p.phone}</a>
                    {copyBtn(`${p.id}:tel`, p.phone, 'telefone')}
                  </span>
                )}
                {p.cnpj && <span className={s.line}><span className={s.cnpj}>CNPJ {p.cnpj}</span>{copyBtn(`${p.id}:cnpj`, p.cnpj, 'CNPJ')}</span>}
              </div>
              {canEdit(p) ? (
                <RowMenu name={`Ações do parceiro ${p.company_name}`} items={[
                  { label: 'Editar parceiro', icon: 'edit', onClick: () => setEditing(p) },
                  { label: 'Excluir parceiro', icon: 'trash', danger: true, onClick: () => deletePartner(p) },
                ]} />
              ) : <span className={s.menuSpace} />}
            </li>
          ))}
        </ul>
      )}

      {editing && <Editor partner={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  )
}

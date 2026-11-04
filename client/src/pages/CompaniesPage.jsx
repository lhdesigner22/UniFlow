import { useState, useEffect, useMemo } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import LineIcon from '../components/common/LineIcon'
import RowMenu from '../components/common/RowMenu'
import s from './CompaniesPage.module.css'
import DepartmentSelect from '../components/common/DepartmentSelect'
import { defaultDepartment } from '../store/departmentStore'

const COMPANIES = [
  { key: 'colegio-ser', label: 'Colégio SER' },
  { key: 'unifecaf', label: 'UniFECAF' },
]
const COMPANY_MAP = Object.fromEntries(COMPANIES.map(c => [c.key, c]))

// Paleta oficial de cada empresa (extraída das variáveis CSS reais do site
// institucional) — sobrescreve `--brand`/`--brand-dark` só dentro desta
// página (a cascata do CSS cuida do resto: botão primário, foco de input,
// links etc. já usam `var(--brand)` em algum lugar do app inteiro).
// Colégio SER: https://colegioser.com/ — verde institucional (--ser-verde-600/800).
// UniFECAF: https://www.unifecaf.com.br/ — azul institucional (--unifecaf-blue / --secondary-blue).
const COMPANY_THEME = {
  'colegio-ser': { brand: '#28944A', brandDark: '#1B693D' },
  'unifecaf': { brand: '#254AB9', brandDark: '#1A3666' },
}

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

// Só os dígitos, no máximo 8, formatado como 00000-000
function formatCep(value) {
  return value.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
}

function Editor({ branch, defaultCompany, onClose, onSaved }) {
  const [form, setForm] = useState({
    company: branch?.company || defaultCompany || 'colegio-ser',
    name: branch?.name || '',
    cnpj: branch?.cnpj || '',
    address: branch?.address || '',
    phone: branch?.phone || '',
    department_id: branch ? branch.department_id : defaultDepartment(),
  })
  const [cep, setCep] = useState('')
  const [cepLoading, setCepLoading] = useState(false)
  const [cepError, setCepError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ViaCEP — API pública e gratuita (sem chave, sem cadastro), busca o
  // endereço pelo CEP e preenche o campo automaticamente. O número/
  // complemento não vem da API — o campo continua editável pra completar.
  const onCepChange = e => {
    const formatted = formatCep(e.target.value)
    setCep(formatted)
    setCepError('')
    const digits = formatted.replace(/\D/g, '')
    if (digits.length === 8) lookupCep(digits)
  }

  const lookupCep = async digits => {
    setCepLoading(true)
    setCepError('')
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
      const data = await res.json()
      if (data.erro) {
        setCepError('CEP não encontrado.')
        return
      }
      const linha = [data.logradouro, data.bairro, [data.localidade, data.uf].filter(Boolean).join(' - ')]
        .filter(Boolean).join(', ')
      const full = `${linha}${linha ? ', ' : ''}CEP ${formatCep(digits)}`
      setForm(f => ({ ...f, address: full }))
    } catch {
      setCepError('Não deu para buscar o CEP. Tente de novo ou preencha o endereço à mão.')
    } finally {
      setCepLoading(false)
    }
  }

  const save = async () => {
    if (!form.name.trim() && !form.cnpj.trim()) return
    setSaving(true)
    setError('')
    try {
      const saved = branch
        ? (await api.put(`/companies/${branch.id}`, form)).data
        : (await api.post('/companies', form)).data
      onSaved(saved)
    } catch (e) {
      setError(e.response?.data?.error || 'Não deu para salvar a filial. Tente de novo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={branch ? 'Editar filial' : 'Nova filial'} onClose={onClose} width={520}>
      <div className="form-group">
        <label htmlFor="companies-empresa" className="label">Empresa</label>
        <select id="companies-empresa" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}>
          {COMPANIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="companies-nome-da-filial" className="label">Nome da filial</label>
        <input id="companies-nome-da-filial" autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Matriz, Filial Centro..." />
      </div>
      <div className="form-group">
        <label htmlFor="companies-cnpj" className="label">CNPJ</label>
        <input id="companies-cnpj" value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" />
      </div>
      <div className="form-group">
        <label htmlFor="companies-cep" className="label">CEP</label>
        <input id="companies-cep" value={cep} onChange={onCepChange} placeholder="00000-000" inputMode="numeric" />
        {cepLoading && <p className={s.cepHint}>Buscando endereço...</p>}
        {cepError && <p role="alert" className={s.fileError}>{cepError}</p>}
      </div>
      <div className="form-group">
        <label htmlFor="companies-endereco" className="label">Endereço</label>
        <textarea id="companies-endereco" rows={2} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Preenche sozinho a partir do CEP acima — complete com número e complemento" />
      </div>
      <div className="form-group">
        <label htmlFor="companies-telefone" className="label">Telefone</label>
        <input id="companies-telefone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(00) 0000-0000" />
      </div>
      {error && <p role="alert" className={s.fileError}>{error}</p>}
      <DepartmentSelect value={form.department_id} onChange={v => setForm(f => ({ ...f, department_id: v }))} label="Visível para" />
      <button
        className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}
        disabled={(!form.name.trim() && !form.cnpj.trim()) || saving}
        onClick={save}
      >
        {saving ? 'Salvando…' : branch ? 'Salvar alterações' : 'Cadastrar filial'}
      </button>
    </Modal>
  )
}

export default function CompaniesPage() {
  const { user } = useAuthStore()
  const { company: companyParam } = useParams()
  // A empresa vem da rota (/empresas/colegio-ser|unifecaf); as abas no topo trocam.
  const companyTab = COMPANY_MAP[companyParam] ? companyParam : COMPANIES[0].key
  const [branches, setBranches] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, filial = editar
  const [copied, setCopied] = useState(null)   // `${id}:${campo}` copiado agora há pouco

  useLiveRefresh(['companies'], () => load())
  const load = () => {
    api.get('/companies')
      .then(r => setBranches(r.data || []))
      .catch(() => setBranches([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => (branches || [])
    .filter(b => b.company === companyTab)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')), [branches, companyTab])
  const counts = useMemo(() => Object.fromEntries(COMPANIES.map(c => [c.key, (branches || []).filter(b => b.company === c.key).length])), [branches])

  const onSaved = branch => {
    setBranches(prev => {
      const exists = (prev || []).some(b => b.id === branch.id)
      return exists ? prev.map(b => b.id === branch.id ? branch : b) : [...(prev || []), branch]
    })
    setEditing(null)
  }

  const deleteBranch = async b => {
    const ok = await confirmDialog(`Excluir a filial "${b.name || b.cnpj}"?`, { title: 'Excluir filial' })
    if (!ok) return
    try {
      await api.delete(`/companies/${b.id}`)
      setBranches(prev => (prev || []).filter(x => x.id !== b.id))
    } catch (e) {
      await alertDialog(e.response?.data?.error || 'Não deu para excluir a filial.', { title: 'Erro', danger: true })
    }
  }

  const copy = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1800)
    } catch { /* área de transferência indisponível */ }
  }

  const canEdit = b => b.created_by === user?.id || user?.system_role === 'super_admin'
  const isSuper = user?.system_role === 'super_admin'
  const theme = COMPANY_THEME[companyTab]
  const label = COMPANY_MAP[companyTab].label

  if (loading) return <div className={s.loading}>Carregando filiais…</div>

  const copyBtn = (k, text, what) => (
    <button type="button" className={s.copyBtn} onClick={() => copy(k, text)} aria-label={copied === k ? `${what} copiado` : `Copiar ${what}`}>
      <LineIcon name={copied === k ? 'check' : 'copy'} size={14} />{copied === k ? 'Copiado' : 'Copiar'}
    </button>
  )

  return (
    <div className={s.page} style={theme ? { '--brand': theme.brand, '--brand-dark': theme.brandDark } : undefined}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>{label}</h1>
          <p className={s.sub}>Dados cadastrais das filiais: CNPJ, endereço e telefone, prontos para copiar.</p>
        </div>
        {isSuper && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}><LineIcon name="plus" size={15} /> Nova filial</button>
        )}
      </header>

      <nav className={s.tabs} aria-label="Empresa">
        {COMPANIES.map(c => (
          <NavLink key={c.key} to={`/empresas/${c.key}`} className={({ isActive }) => `${s.tab} ${isActive ? s.tabOn : ''}`}
            style={{ '--tab': COMPANY_THEME[c.key]?.brand }}>
            {c.label} <span className={s.tabCount}>{counts[c.key] || 0}</span>
          </NavLink>
        ))}
      </nav>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h2>Nenhuma filial do {label} cadastrada</h2>
          <p>{isSuper ? 'Use "Nova filial" para cadastrar a primeira: o endereço é preenchido sozinho pelo CEP.' : 'Peça a um Super Admin para cadastrar as filiais.'}</p>
        </div>
      ) : (
        <ul className={s.list}>
          {filtered.map(b => (
            <li key={b.id} className={s.branch}>
              <div className={s.info}>
                <div className={s.branchHead}>
                  <h2 className={s.branchName}>{b.name || 'Filial sem nome'}</h2>
                  {canEdit(b) && (
                    <RowMenu name={`Ações da filial ${b.name || b.cnpj}`} items={[
                      { label: 'Editar filial', icon: 'edit', onClick: () => setEditing(b) },
                      { label: 'Excluir filial', icon: 'trash', danger: true, onClick: () => deleteBranch(b) },
                    ]} />
                  )}
                </div>
                <dl className={s.facts}>
                  {b.cnpj && (<>
                    <dt>CNPJ</dt>
                    <dd><span className={s.cnpj}>{b.cnpj}</span>{copyBtn(`${b.id}:cnpj`, b.cnpj, 'CNPJ')}</dd>
                  </>)}
                  {b.address && (<>
                    <dt>Endereço</dt>
                    <dd className={s.addressRow}>
                      <span className={s.address}>{b.address}</span>
                      <span className={s.addressBtns}>
                        {copyBtn(`${b.id}:addr`, b.address, 'endereço')}
                        <a className={s.copyBtn} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}`} target="_blank" rel="noreferrer">
                          <LineIcon name="pin" size={14} />Abrir no mapa
                        </a>
                      </span>
                    </dd>
                  </>)}
                  {b.phone && (<>
                    <dt>Telefone</dt>
                    <dd><a className={s.phone} href={`tel:${b.phone.replace(/[^\d+]/g, '')}`}><LineIcon name="phone" size={14} />{b.phone}</a>{copyBtn(`${b.id}:tel`, b.phone, 'telefone')}</dd>
                  </>)}
                </dl>
                <p className={s.meta}>Atualizado por {b.author_name || 'alguém'}, {timeAgo(b.updated_at)}</p>
              </div>
              {b.address && (
                <iframe
                  className={s.map}
                  title={`Mapa de ${b.name || b.address}`}
                  src={`https://www.google.com/maps?q=${encodeURIComponent(b.address)}&output=embed`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Editor
          branch={editing.id ? editing : null}
          defaultCompany={companyTab}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

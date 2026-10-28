import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import { useLiveRefresh } from '../hooks/useLiveRefresh'
import { useAuthStore } from '../store/authStore'
import { confirmDialog, alertDialog } from '../store/dialogStore'
import Modal from '../components/common/Modal'
import Reveal from '../components/common/Reveal'
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
      setCepError('Erro ao buscar o CEP. Tenta de novo?')
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
      setError(e.response?.data?.error || 'Erro ao salvar. Tenta de novo?')
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
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
    </Modal>
  )
}

export default function CompaniesPage() {
  const { user } = useAuthStore()
  const { company: companyParam } = useParams()
  // A empresa vem da rota (/empresas/colegio-ser|unifecaf — controlada pelo
  // dropdown da sidebar, igual "Impressoras"); se vier algo inválido, cai
  // na primeira.
  const companyTab = COMPANY_MAP[companyParam] ? companyParam : COMPANIES[0].key
  const [branches, setBranches] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null = fechado, {} = novo, filial = editar

  useLiveRefresh(['companies'], () => load())
  const load = () => {
    api.get('/companies')
      .then(r => setBranches(r.data || []))
      .catch(() => setBranches([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => (branches || []).filter(b => b.company === companyTab), [branches, companyTab])

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
      await alertDialog(e.response?.data?.error || 'Erro ao excluir a filial.', { title: 'Erro', danger: true })
    }
  }

  const canEdit = b => b.created_by === user?.id || user?.system_role === 'super_admin'

  if (loading) return <div className={s.loading}>Carregando empresas...</div>

  const theme = COMPANY_THEME[companyTab]

  return (
    <div className={s.page} style={theme ? { '--brand': theme.brand, '--brand-dark': theme.brandDark } : undefined}>
      {theme && <div className={s.accentBar} />}
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Empresas — {COMPANY_MAP[companyTab].label}</h1>
          <p className={s.sub}>CNPJ, endereço e telefone das filiais. Troque a empresa pelo menu "Empresas" na barra lateral.</p>
        </div>
        {user?.system_role === 'super_admin' && (
          <button className="btn btn-primary" onClick={() => setEditing({})}>+ Nova filial</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className={s.empty}>
          <h3>Nenhuma filial em {COMPANY_MAP[companyTab].label}</h3>
          <p>{user?.system_role === 'super_admin' ? 'Cadastre a primeira filial dessa empresa.' : 'Peça pra um Super Admin cadastrar.'}</p>
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((b, i) => (
            <Reveal key={b.id} delay={Math.min(i, 10) * 50} className={s.card}>
              <div className={s.cardHeader}>
                <h3 className={s.cardTitle}>{b.name || 'Filial sem nome'}</h3>
                {canEdit(b) && (
                  <div className={s.cardActions}>
                    <button className={s.iconBtn} title="Editar" onClick={() => setEditing(b)}>✏️</button>
                    <button className={s.iconBtn} title="Excluir" onClick={() => deleteBranch(b)}>🗑️</button>
                  </div>
                )}
              </div>
              {b.cnpj && <p className={s.cardLine}>CNPJ: <span className={s.mono}>{b.cnpj}</span></p>}
              {b.address && (
                <>
                  <p className={s.cardLine}>📍 {b.address}</p>
                  <iframe
                    className={s.mapEmbed}
                    title={`Mapa — ${b.name || b.address}`}
                    src={`https://www.google.com/maps?q=${encodeURIComponent(b.address)}&output=embed`}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  <a
                    className={s.cardLink}
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}`}
                    target="_blank" rel="noreferrer"
                  >
                    🗺️ Abrir no Google Maps
                  </a>
                </>
              )}
              {b.phone && <p className={s.cardLine}>📞 {b.phone}</p>}
              <div className={s.cardFooter}>
                <span className={s.cardMeta}>{b.author_name || 'Alguém'} · {timeAgo(b.updated_at)}</span>
              </div>
            </Reveal>
          ))}
        </div>
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

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import s from './Auth.module.css'

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2L16 6V14L10 18L4 14V6L10 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M10 6V10L13 12" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <polyline points="2,6 5,9 10,3" stroke="#3b7eff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

const FEATURES = [
  'Configure em minutos, sem treinamento',
  'Regras de aprovação por função e departamento',
  'Notificações em tempo real',
  'Histórico completo de atividades e auditoria',
]

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuthStore()
  const navigate = useNavigate()

  const submit = async e => {
    e.preventDefault()
    setError(''); setLoading(true)
    try { await register(form.name, form.email, form.password); navigate('/') }
    catch (err) { setError(err.response?.data?.error || 'Erro ao criar conta') }
    finally { setLoading(false) }
  }

  return (
    <div className={s.page}>
      {/* ── Brand panel ── */}
      <aside className={s.brand}>
        <div className={s.brandLogo}>
          <div className={s.brandLogoMark}><LogoMark /></div>
          <span className={s.brandLogoText}>Uni<em>FLOW</em></span>
        </div>

        <div className={s.brandHero}>
          <h2 className={s.brandTagline}>Comece agora.<br /><strong>Gratuitamente.</strong></h2>
          <p className={s.brandDesc}>
            Crie sua conta e tenha sua primeira aprovação funcionando em menos de 5 minutos.
          </p>
        </div>

        <ul className={s.brandFeatures}>
          {FEATURES.map(f => (
            <li key={f} className={s.brandFeature}>
              <span className={s.featureDot}><CheckIcon /></span>
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <p className={s.brandFooter}>© {new Date().getFullYear()} UniFlow · Todos os direitos reservados</p>
      </aside>

      {/* ── Form panel ── */}
      <main className={s.formSide}>
        <div className={s.formBox}>
          <div className={s.formHeader}>
            <h1 className={s.formTitle}>Criar conta</h1>
            <p className={s.formSub}>Configure seu acesso em segundos</p>
          </div>

          <form onSubmit={submit} className={s.form}>
            {error && <div className={s.error}>{error}</div>}

            <div className="form-group">
              <label className="label">Nome completo</label>
              <input
                value={form.name} autoFocus
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Seu nome"
                required
              />
            </div>

            <div className="form-group">
              <label className="label">E-mail corporativo</label>
              <input
                type="email" autoComplete="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="voce@empresa.com"
                required
              />
            </div>

            <div className="form-group">
              <label className="label">Senha</label>
              <input
                type="password" autoComplete="new-password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                required
              />
            </div>

            <button className={`btn btn-primary ${s.submitBtn}`} disabled={loading}>
              {loading ? 'Criando conta...' : 'Criar conta gratuita'}
            </button>
          </form>

          <p className={s.foot}>
            Já tem uma conta? <Link to="/login">Entrar</Link>
          </p>
        </div>
      </main>
    </div>
  )
}

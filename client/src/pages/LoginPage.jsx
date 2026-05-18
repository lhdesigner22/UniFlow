import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import s from './Auth.module.css'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const googleEnabled = GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('SEU_')

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <polyline points="2,6 5,9 10,3" stroke="#3b7eff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2L16 6V14L10 18L4 14V6L10 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M10 6V10L13 12" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

const FEATURES = [
  'Fluxos de aprovação customizáveis',
  'Automações e regras de encaminhamento',
  'Relatórios e dashboards em tempo real',
  'Colaboração com controle de acesso',
]

export default function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const { login, loginWithGoogle } = useAuthStore()
  const navigate = useNavigate()
  const googleBtnRef = useRef(null)
  const googleCallbackRef = useRef(null)

  googleCallbackRef.current = useCallback(async ({ credential }) => {
    setGoogleLoading(true)
    setError('')
    try {
      await loginWithGoogle(credential)
      navigate('/')
    } catch (err) {
      setError(err?.response?.data?.error || 'Erro ao entrar com Google')
    } finally { setGoogleLoading(false) }
  }, [loginWithGoogle, navigate])

  useEffect(() => {
    if (!googleEnabled) return
    const init = () => {
      if (!window.google?.accounts?.id) return
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => googleCallbackRef.current(response),
        context: 'signin',
      })
      if (googleBtnRef.current) {
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'filled_blue', size: 'large',
          width: googleBtnRef.current.offsetWidth || 380,
          text: 'signin_with', locale: 'pt_BR', shape: 'rectangular',
        })
      }
    }
    if (window.google?.accounts?.id) { init() }
    else {
      const t = setInterval(() => { if (window.google?.accounts?.id) { init(); clearInterval(t) } }, 150)
      return () => clearInterval(t)
    }
  }, [])

  const submit = async e => {
    e.preventDefault()
    setError(''); setLoading(true)
    try { await login(form.email, form.password); navigate('/') }
    catch (err) { setError(err.response?.data?.error || 'E-mail ou senha incorretos') }
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
          <h2 className={s.brandTagline}>Aprovações<br /><strong>sem atrito.</strong></h2>
          <p className={s.brandDesc}>
            Gerencie fluxos de trabalho, aprovações e equipes em uma plataforma unificada.
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
            <h1 className={s.formTitle}>Bem-vindo de volta</h1>
            <p className={s.formSub}>Entre na sua conta para continuar</p>
          </div>

          {googleEnabled && (
            <div className={s.googleSection}>
              <div ref={googleBtnRef} className={s.googleBtn}>
                {googleLoading && <div className={s.googleLoading}>Autenticando...</div>}
              </div>
              <div className={s.divider}><span>ou continue com e-mail</span></div>
            </div>
          )}

          <form onSubmit={submit} className={s.form}>
            {error && <div className={s.error}>{error}</div>}

            <div className="form-group">
              <label className="label">E-mail corporativo</label>
              <input
                type="email" autoComplete="email" autoFocus
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="voce@empresa.com"
                required
              />
            </div>

            <div className="form-group">
              <label className="label">Senha</label>
              <input
                type="password" autoComplete="current-password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                required
              />
            </div>

            <button className={`btn btn-primary ${s.submitBtn}`} disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar na plataforma'}
            </button>
          </form>

          <p className={s.foot}>
            Não tem uma conta? <Link to="/register">Criar conta</Link>
          </p>

          <div className={s.demoBox}>
            <span className={s.demoLabel}>Conta demo</span>
            <div className={s.demoCredential}>
              <span>admin@uniflow.app</span>
              <span style={{ color:'var(--muted)' }}>/ admin123</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

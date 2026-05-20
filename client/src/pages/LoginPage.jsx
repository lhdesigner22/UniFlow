import { useState, useEffect, useRef } from 'react'
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
  const actionRef = useRef(null)
  actionRef.current = { loginWithGoogle, navigate }

  useEffect(() => {
    if (!googleEnabled) return
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'google-oauth') return
      const { idToken, error: oauthError } = event.data
      if (oauthError || !idToken) { setError('Autenticação cancelada.'); return }
      setGoogleLoading(true)
      setError('')
      actionRef.current.loginWithGoogle(idToken)
        .then(() => actionRef.current.navigate('/'))
        .catch(err => setError(err?.response?.data?.error || 'Erro ao entrar com Google'))
        .finally(() => setGoogleLoading(false))
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleGoogleClick = () => {
    const nonce = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2))
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/google/callback`,
      response_type: 'id_token',
      scope: 'openid email profile',
      prompt: 'select_account',
      nonce,
    })
    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'google-signin',
      'width=500,height=620,left=200,top=100',
    )
    if (!popup) setError('Popup bloqueado pelo navegador. Permita popups para este site e tente novamente.')
  }

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
              <button
                type="button"
                className={s.googleButton}
                onClick={handleGoogleClick}
                disabled={googleLoading}
              >
                {googleLoading ? (
                  <span className={s.googleSpinner} />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                    <path fill="#4285F4" d="M46.145 24.503c0-1.636-.146-3.21-.418-4.724H24v8.937h12.434c-.536 2.886-2.165 5.33-4.613 6.973v5.797h7.474c4.374-4.027 6.85-9.959 6.85-16.983z"/>
                    <path fill="#34A853" d="M24 47c6.24 0 11.47-2.069 15.294-5.614l-7.474-5.797c-2.07 1.386-4.716 2.203-7.82 2.203-6.015 0-11.107-4.062-12.928-9.525H3.338v5.985C7.142 41.862 14.978 47 24 47z"/>
                    <path fill="#FBBC05" d="M11.072 28.267A13.984 13.984 0 0 1 10.5 24c0-1.493.256-2.944.572-4.267V13.748H3.338A23.01 23.01 0 0 0 1 24c0 3.715.887 7.228 2.338 10.252l7.734-5.985z"/>
                    <path fill="#EA4335" d="M24 10.208c3.39 0 6.43 1.165 8.822 3.455l6.614-6.614C35.465 3.41 30.235 1 24 1 14.978 1 7.142 6.138 3.338 13.748l7.734 5.985C12.893 14.27 17.985 10.208 24 10.208z"/>
                  </svg>
                )}
                {googleLoading ? 'Autenticando...' : 'Continuar com Google'}
              </button>
              <div className={s.divider}><span>ou</span></div>
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

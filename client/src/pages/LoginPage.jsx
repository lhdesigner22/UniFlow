import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import s from './Auth.module.css'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const googleEnabled = GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('SEU_')

export default function LoginPage() {
  const [form, setForm] = useState({ email: 'admin@uniflow.app', password: 'admin123' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const { login, loginWithGoogle } = useAuthStore()
  const navigate = useNavigate()
  const googleBtnRef = useRef(null)

  // Ref garante que o GIS sempre chame a versão mais recente do callback
  // sem precisar re-inicializar o botão a cada render
  const googleCallbackRef = useRef(null)
  googleCallbackRef.current = useCallback(async ({ credential }) => {
    setGoogleLoading(true)
    setError('')
    try {
      await loginWithGoogle(credential)
      navigate('/')
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Erro ao entrar com Google'
      setError(msg)
    } finally {
      setGoogleLoading(false)
    }
  }, [loginWithGoogle, navigate])

  // Inicializa o botão Google assim que o script GIS carregar
  useEffect(() => {
    if (!googleEnabled) return

    const init = () => {
      if (!window.google?.accounts?.id) return
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        // Wrapper estável — delega para o ref que sempre aponta ao callback atual
        callback: (response) => googleCallbackRef.current(response),
        context: 'signin',
      })
      if (googleBtnRef.current) {
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'filled_blue',
          size: 'large',
          width: googleBtnRef.current.offsetWidth || 328,
          text: 'signin_with',
          locale: 'pt_BR',
          shape: 'rectangular',
        })
      }
    }

    if (window.google?.accounts?.id) {
      init()
    } else {
      const t = setInterval(() => {
        if (window.google?.accounts?.id) { init(); clearInterval(t) }
      }, 150)
      return () => clearInterval(t)
    }
  }, [])

  const submit = async e => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await login(form.email, form.password)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao entrar')
    } finally { setLoading(false) }
  }

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.logo}>
          <div className={s.logoIcon}>⚡</div>
          <span>Uni<em>FLOW</em></span>
        </div>
        <h2 className={s.title}>Bem-vindo de volta</h2>
        <p className={s.sub}>Entre na sua conta para continuar</p>

        {error && <div className={s.error}>{error}</div>}

        {/* Botão Google */}
        {googleEnabled && (
          <>
            <div ref={googleBtnRef} className={s.googleBtn} style={{ minHeight: 44 }}>
              {googleLoading && <div className={s.googleLoading}>Autenticando com Google...</div>}
            </div>
            <div className={s.divider}><span>ou entre com e-mail</span></div>
          </>
        )}

        <form onSubmit={submit} className={s.form}>
          <div className="form-group">
            <label className="label">E-mail</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="label">Senha</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          </div>
          <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', padding:'10px' }} disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className={s.foot}>
          Não tem conta? <Link to="/register" style={{ color:'var(--blue)' }}>Criar conta</Link>
        </p>
        <div className={s.demo}>
          <span>Demo: admin@uniflow.app / admin123</span>
        </div>
      </div>
    </div>
  )
}

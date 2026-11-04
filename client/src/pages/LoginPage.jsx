import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import s from './Auth.module.css'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const googleEnabled = GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('SEU_')
// Mesmos domínios aceitos pelo servidor (ALLOWED_LOGIN_DOMAINS em server/src/routes/auth.js).
const DOMAINS = ['colegioser.com', 'fecaf.com.br', 'pro.fecaf.com.br']

// A tela de entrada usa a letra do telão (Início): Bricolage Grotesque, carregada
// só aqui. O <link> entra uma vez no <head> (a CSP já libera fonts.googleapis.com).
function useTelaoFont() {
  useEffect(() => {
    const id = 'font-bricolage'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap'
    document.head.appendChild(link)
  }, [])
}

function LogoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2L16 6V14L10 18L4 14V6L10 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 6V10L13 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path fill="#4285F4" d="M46.145 24.503c0-1.636-.146-3.21-.418-4.724H24v8.937h12.434c-.536 2.886-2.165 5.33-4.613 6.973v5.797h7.474c4.374-4.027 6.85-9.959 6.85-16.983z"/>
      <path fill="#34A853" d="M24 47c6.24 0 11.47-2.069 15.294-5.614l-7.474-5.797c-2.07 1.386-4.716 2.203-7.82 2.203-6.015 0-11.107-4.062-12.928-9.525H3.338v5.985C7.142 41.862 14.978 47 24 47z"/>
      <path fill="#FBBC05" d="M11.072 28.267A13.984 13.984 0 0 1 10.5 24c0-1.493.256-2.944.572-4.267V13.748H3.338A23.01 23.01 0 0 0 1 24c0 3.715.887 7.228 2.338 10.252l7.734-5.985z"/>
      <path fill="#EA4335" d="M24 10.208c3.39 0 6.43 1.165 8.822 3.455l6.614-6.614C35.465 3.41 30.235 1 24 1 14.978 1 7.142 6.138 3.338 13.748l7.734 5.985C12.893 14.27 17.985 10.208 24 10.208z"/>
    </svg>
  )
}

// Login exclusivamente via Google — sem cadastro/senha própria (decisão do
// time: entrar só com a conta Google da instituição, sem outra porta de entrada).
export default function LoginPage() {
  useTelaoFont()
  const [error, setError] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)
  const { loginWithGoogle } = useAuthStore()
  const navigate = useNavigate()
  const actionRef = useRef(null)
  actionRef.current = { loginWithGoogle, navigate }

  useEffect(() => {
    if (!googleEnabled) return
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'google-oauth') return
      const { idToken, error: oauthError } = event.data
      if (oauthError || !idToken) { setError('A entrada com o Google foi cancelada. Tente de novo.'); return }
      setGoogleLoading(true)
      setError('')
      actionRef.current.loginWithGoogle(idToken)
        .then(() => actionRef.current.navigate('/'))
        .catch(err => setError(err?.response?.data?.error || 'Não deu para entrar com o Google. Tente de novo.'))
        .finally(() => setGoogleLoading(false))
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const handleGoogleClick = () => {
    setError('')
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
    if (!popup) setError('O navegador bloqueou a janela do Google. Permita pop-ups para este site e clique de novo.')
  }

  return (
    <div className={s.page}>
      {/* ── O que é (na identidade do telão) ── */}
      <aside className={s.brand}>
        <div className={s.logo}>
          <span className={s.logoMark}><LogoMark /></span>
          <span className={s.logoText}>Uni<em>FLOW</em></span>
        </div>

        <div className={s.statement}>
          <p className={s.big}>O dia a dia da TI do Colégio SER e da UniFECAF, num lugar só.</p>
          <ul className={s.who}>
            <li><strong>Equipe de TI</strong><span>quadros, chamados do GLPI, empréstimos, impressoras e o Cofre de Senhas.</span></li>
            <li><strong>Professores</strong><span>reservar Chromebooks para a aula e abrir chamados.</span></li>
          </ul>
        </div>

        <p className={s.help}>Dúvidas ou problema para entrar? <a href="mailto:helpdesk.ti@fecaf.com.br">helpdesk.ti@fecaf.com.br</a></p>
      </aside>

      {/* ── Entrar ── */}
      <main className={s.formSide}>
        <div className={s.formBox}>
          <h1 className={s.formTitle}>Entrar</h1>
          <p className={s.formSub}>Use a sua conta Google da instituição.</p>

          {error && <div role="alert" className={s.error}>{error}</div>}

          {googleEnabled ? (
            <button type="button" className={s.googleButton} onClick={handleGoogleClick} disabled={googleLoading}>
              {googleLoading ? <span className={s.googleSpinner} aria-hidden="true" /> : <GoogleLogo />}
              {googleLoading ? 'Entrando…' : 'Entrar com Google'}
            </button>
          ) : (
            <p role="alert" className={s.error}>A entrada com o Google não está configurada. Avise a TI.</p>
          )}

          <div className={s.domains}>
            <p>Contas aceitas</p>
            <ul>{DOMAINS.map(d => <li key={d}>@{d}</li>)}</ul>
          </div>
        </div>
      </main>
    </div>
  )
}

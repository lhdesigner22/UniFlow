import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import s from './Auth.module.css'

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuthStore()
  const navigate = useNavigate()

  const submit = async e => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await register(form.name, form.email, form.password)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao criar conta')
    } finally { setLoading(false) }
  }

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.logo}>
          <div className={s.logoIcon}>⚡</div>
          <span>Uni<em>FLOW</em></span>
        </div>
        <h2 className={s.title}>Criar conta</h2>
        <p className={s.sub}>Comece grátis, sem cartão de crédito</p>

        <form onSubmit={submit} className={s.form}>
          {error && <div className={s.error}>{error}</div>}
          <div className="form-group">
            <label className="label">Nome</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="label">E-mail</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="label">Senha</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} minLength={6} required />
          </div>
          <button className="btn btn-green" style={{ width:'100%', justifyContent:'center', padding:'10px' }} disabled={loading}>
            {loading ? 'Criando...' : 'Criar conta'}
          </button>
        </form>

        <p className={s.foot}>
          Já tem conta? <Link to="/login" style={{ color:'var(--blue)' }}>Entrar</Link>
        </p>
      </div>
    </div>
  )
}

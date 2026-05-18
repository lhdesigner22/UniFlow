import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import s from './PublicFormPage.module.css'

export default function PublicFormPage() {
  const { token } = useParams()
  const [formData, setFormData] = useState(null)
  const [values, setValues] = useState({})
  const [title, setTitle] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get(`/forms/public/${token}`)
      .then(r => { setFormData(r.data); setLoading(false) })
      .catch(() => { setError('Formulário não encontrado ou inativo.'); setLoading(false) })
  }, [token])

  const submit = async e => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const fields = Object.entries(values).map(([field_id, value]) => ({ field_id, value }))
      await api.post(`/forms/public/${token}/submit`, { title, fields })
      setSubmitted(true)
    } catch (err) {
      setError(err.response?.data?.error || 'Erro ao enviar')
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className={s.page}><div className={s.card}><p>Carregando...</p></div></div>
  if (error) return <div className={s.page}><div className={s.card}><h3>❌ {error}</h3></div></div>

  const { form, pipe, fields } = formData

  if (submitted) return (
    <div className={s.page}>
      <div className={s.card} style={{ textAlign:'center' }}>
        <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
        <h2>Solicitação enviada!</h2>
        <p style={{ color:'var(--muted)', marginTop:8 }}>Sua solicitação foi recebida e será analisada em breve.</p>
        <button className="btn btn-primary" style={{ marginTop:24 }} onClick={() => { setSubmitted(false); setValues({}); setTitle('') }}>
          Enviar outra solicitação
        </button>
      </div>
    </div>
  )

  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.formHeader}>
          <div className={s.pipeIcon} style={{ background: pipe.color + '25', color: pipe.color }}>{pipe.icon}</div>
          <div>
            <h1>{form.name}</h1>
            {form.description && <p>{form.description}</p>}
          </div>
        </div>

        <form onSubmit={submit} className={s.form}>
          <div className="form-group">
            <label className="label">Título da solicitação *</label>
            <input placeholder="Descreva brevemente sua solicitação..." value={title} onChange={e => setTitle(e.target.value)} required />
          </div>

          {fields.map(field => (
            <div key={field.id} className="form-group">
              <label className="label">{field.name}{field.required ? ' *' : ''}</label>
              {field.type === 'textarea' ? (
                <textarea rows={3} value={values[field.id] || ''} onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))} required={!!field.required} />
              ) : field.type === 'select' ? (
                <select value={values[field.id] || ''} onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))} required={!!field.required}>
                  <option value="">Selecionar...</option>
                  {JSON.parse(field.options || '[]').map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : field.type === 'checkbox' ? (
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={values[field.id] === 'true'} onChange={e => setValues(v => ({ ...v, [field.id]: e.target.checked.toString() }))} style={{ width:16, height:16 }} />
                  <span>Sim</span>
                </label>
              ) : (
                <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
                  value={values[field.id] || ''} onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))} required={!!field.required} />
              )}
            </div>
          ))}

          {error && <div style={{ color:'var(--red)', fontSize:13, background:'rgba(239,68,68,.1)', padding:'10px 12px', borderRadius:8 }}>{error}</div>}

          <button type="submit" className="btn btn-green" style={{ width:'100%', justifyContent:'center', padding:12 }} disabled={submitting}>
            {submitting ? 'Enviando...' : '✓ Enviar Solicitação'}
          </button>
        </form>

        <div className={s.footer}>
          <span>⚡</span> Powered by <strong>UniFlow</strong>
        </div>
      </div>
    </div>
  )
}

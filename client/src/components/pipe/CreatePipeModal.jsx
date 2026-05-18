import { useState, useRef, useEffect } from 'react'
import api from '../../services/api'
import Modal from '../common/Modal'

const ICONS = ['📋','🛒','💼','🔖','📊','🚀','🏗️','📝','💰','🎯','⚙️','🔔','✅','🔍','📦','🤝']
const COLORS = ['#4a7cf7','#22c55e','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#ec4899','#f97316']

export default function CreatePipeModal({ onClose, onCreate }) {
  const [form, setForm] = useState({ name: '', description: '', icon: '📋', color: '#4a7cf7' })
  const [emails, setEmails] = useState([])
  const [emailInput, setEmailInput] = useState('')
  const [emailError, setEmailError] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  // Autocomplete
  const [suggestions, setSuggestions] = useState([])
  const [showDrop, setShowDrop] = useState(false)
  const [dropIdx, setDropIdx] = useState(-1)   // índice selecionado via teclado

  const inputRef  = useRef(null)
  const dropRef   = useRef(null)
  const searchRef = useRef(null)

  /* ── Busca sugestões enquanto digita ─────────────────────────────── */
  useEffect(() => {
    const val = emailInput.trim()
    clearTimeout(searchRef.current)

    if (val.length < 2) {
      setSuggestions([])
      setShowDrop(false)
      setDropIdx(-1)
      return
    }

    searchRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get(`/users/search?q=${encodeURIComponent(val)}`)
        // Remove quem já foi adicionado
        const filtered = data.filter(u => !emails.includes(u.email))
        setSuggestions(filtered)
        setShowDrop(filtered.length > 0)
        setDropIdx(-1)
      } catch {
        setSuggestions([])
        setShowDrop(false)
      }
    }, 220)

    return () => clearTimeout(searchRef.current)
  }, [emailInput, emails])

  /* ── Fecha dropdown ao clicar fora ───────────────────────────────── */
  useEffect(() => {
    const handler = e => {
      if (
        !dropRef.current?.contains(e.target) &&
        !inputRef.current?.contains(e.target)
      ) {
        setShowDrop(false)
        setDropIdx(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /* ── helpers de chips ─────────────────────────────────────────────── */
  const isValidEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

  const addEmail = (val) => {
    const email = (val ?? emailInput).trim().toLowerCase()
    setEmailError('')
    if (!email) return
    if (!isValidEmail(email)) { setEmailError('E-mail inválido'); return }
    if (emails.includes(email)) { setEmailError('E-mail já adicionado'); return }
    setEmails(prev => [...prev, email])
    setEmailInput('')
    setSuggestions([])
    setShowDrop(false)
    setDropIdx(-1)
  }

  const selectSuggestion = user => {
    setEmails(prev => [...prev, user.email])
    setEmailInput('')
    setSuggestions([])
    setShowDrop(false)
    setDropIdx(-1)
    inputRef.current?.focus()
  }

  const removeEmail = email => setEmails(prev => prev.filter(e => e !== email))

  const handleKey = e => {
    if (showDrop && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setDropIdx(i => Math.min(i + 1, suggestions.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setDropIdx(i => Math.max(i - 1, -1))
        return
      }
      if (e.key === 'Enter' && dropIdx >= 0) {
        e.preventDefault()
        selectSuggestion(suggestions[dropIdx])
        return
      }
      if (e.key === 'Escape') {
        setShowDrop(false)
        setDropIdx(-1)
        return
      }
    }

    if (e.key === 'Enter') { e.preventDefault(); addEmail() }
    if (e.key === 'Backspace' && !emailInput && emails.length) {
      setEmails(prev => prev.slice(0, -1))
    }
  }

  /* ── submit ─────────────────────────────────────────────────────── */
  const submit = async e => {
    e.preventDefault()
    if (emailInput.trim()) addEmail()

    setLoading(true)
    try {
      const { data } = await api.post('/pipes', { ...form, members: emails })

      if (data.membersNotFound?.length > 0 || data.membersBlocked?.length > 0) {
        setResult(data)
        setLoading(false)
        return
      }

      onCreate(data)
      onClose()
    } catch (err) {
      setEmailError(err.response?.data?.error || 'Erro ao criar pipe')
      setLoading(false)
    }
  }

  const confirmAndClose = () => { onCreate(result); onClose() }

  /* ── tela de resultado ──────────────────────────────────────────── */
  if (result) {
    return (
      <Modal title="Pipe criado!" onClose={confirmAndClose} width={420}>
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {result.membersAdded?.length > 0 && (
            <div style={{ background:'rgba(34,197,94,.08)', border:'1px solid rgba(34,197,94,.2)', borderRadius:10, padding:'12px 14px' }}>
              <strong style={{ color:'var(--green)', fontSize:13 }}>✅ Colaboradores adicionados:</strong>
              <ul style={{ margin:'6px 0 0', paddingLeft:16, fontSize:13, color:'var(--muted)' }}>
                {result.membersAdded.map(n => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}
          {result.membersBlocked?.length > 0 && (
            <div style={{ background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', borderRadius:10, padding:'12px 14px' }}>
              <strong style={{ color:'var(--red)', fontSize:13 }}>🔒 Não foi possível adicionar (sem permissão):</strong>
              <ul style={{ margin:'6px 0 0', paddingLeft:16, fontSize:13, color:'var(--muted)' }}>
                {result.membersBlocked.map(e => <li key={e}>{e}</li>)}
              </ul>
              <p style={{ fontSize:12, color:'var(--muted)', marginTop:8 }}>
                Sua conta não tem permissão para encaminhar para esses usuários.
                Contate o administrador do sistema para ajustar as regras de encaminhamento.
              </p>
            </div>
          )}
          {result.membersNotFound?.length > 0 && (
            <div style={{ background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:10, padding:'12px 14px' }}>
              <strong style={{ color:'#f59e0b', fontSize:13 }}>⚠️ E-mails não encontrados no sistema:</strong>
              <ul style={{ margin:'6px 0 0', paddingLeft:16, fontSize:13, color:'var(--muted)' }}>
                {result.membersNotFound.map(e => <li key={e}>{e}</li>)}
              </ul>
              <p style={{ fontSize:12, color:'var(--muted)', marginTop:8 }}>
                Esses usuários precisam criar uma conta antes de serem adicionados.
                Você pode adicioná-los depois em <strong>Configurações → Membros</strong>.
              </p>
            </div>
          )}
          <button className="btn btn-primary" style={{ alignSelf:'flex-end' }} onClick={confirmAndClose}>
            Entendido, ir para o pipe →
          </button>
        </div>
      </Modal>
    )
  }

  /* ── formulário principal ───────────────────────────────────────── */
  return (
    <Modal title="Criar novo Pipe" onClose={onClose} width={480}>
      <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:16 }}>

        <div className="form-group">
          <label className="label">Nome do Pipe *</label>
          <input placeholder="Ex: Aprovação de Compras" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
        </div>

        <div className="form-group">
          <label className="label">Descrição</label>
          <textarea placeholder="Descreva o objetivo deste pipe..." rows={2}
            value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>

        <div>
          <label className="label">Ícone</label>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:4 }}>
            {ICONS.map(icon => (
              <button type="button" key={icon} onClick={() => setForm(f => ({ ...f, icon }))}
                style={{ width:36, height:36, border: form.icon === icon ? '2px solid var(--blue)' : '1px solid var(--border2)', borderRadius:8, background: form.icon === icon ? 'rgba(74,124,247,.15)' : 'var(--navy3)', cursor:'pointer', fontSize:18 }}>
                {icon}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Cor</label>
          <div style={{ display:'flex', gap:8, marginTop:4 }}>
            {COLORS.map(color => (
              <button type="button" key={color} onClick={() => setForm(f => ({ ...f, color }))}
                style={{ width:28, height:28, borderRadius:'50%', background:color, border: form.color === color ? '3px solid #fff' : '2px solid transparent', cursor:'pointer' }} />
            ))}
          </div>
        </div>

        {/* ── Colaboradores ── */}
        <div>
          <label className="label">
            👥 Colaboradores
            <span style={{ fontWeight:400, color:'var(--muted)', marginLeft:6 }}>(opcional)</span>
          </label>

          {/* Box de chips + input */}
          <div style={{ position:'relative' }}>
            <div
              onClick={() => inputRef.current?.focus()}
              style={{
                display:'flex', flexWrap:'wrap', gap:6, alignItems:'center',
                minHeight:44, padding:'6px 10px',
                background:'var(--navy3)', border:'1px solid var(--border2)',
                borderRadius:8, cursor:'text',
              }}
            >
              {emails.map(email => (
                <span key={email} style={{
                  display:'inline-flex', alignItems:'center', gap:4,
                  background:'rgba(74,124,247,.15)', border:'1px solid rgba(74,124,247,.35)',
                  color:'#7da6ff', borderRadius:20, padding:'2px 10px', fontSize:12, fontWeight:600,
                }}>
                  {email}
                  <button type="button" onClick={() => removeEmail(email)}
                    style={{ background:'none', border:'none', color:'#7da6ff', cursor:'pointer', padding:0, fontSize:14, lineHeight:1, opacity:.7 }}>
                    ×
                  </button>
                </span>
              ))}
              <input
                ref={inputRef}
                type="text"
                placeholder={emails.length === 0 ? 'Nome ou e-mail do colaborador...' : 'Adicionar mais...'}
                value={emailInput}
                onChange={e => { setEmailInput(e.target.value); setEmailError('') }}
                onKeyDown={handleKey}
                onFocus={() => suggestions.length > 0 && setShowDrop(true)}
                autoComplete="off"
                style={{
                  flex:1, minWidth:160, background:'transparent', border:'none',
                  outline:'none', color:'var(--white)', fontSize:13, padding:'2px 0',
                }}
              />
            </div>

            {/* Dropdown de sugestões */}
            {showDrop && (
              <div
                ref={dropRef}
                style={{
                  position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:200,
                  background:'var(--navy2)', border:'1px solid var(--border)',
                  borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,.35)',
                  overflow:'hidden', maxHeight:220, overflowY:'auto',
                }}
              >
                {suggestions.map((u, i) => (
                  <button
                    key={u.id}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); selectSuggestion(u) }}
                    onMouseEnter={() => setDropIdx(i)}
                    style={{
                      width:'100%', display:'flex', alignItems:'center', gap:10,
                      padding:'9px 14px', background: i === dropIdx ? 'var(--navy3)' : 'none',
                      border:'none', borderBottom:'1px solid var(--border2)',
                      color:'var(--white)', cursor:'pointer', textAlign:'left',
                      transition:'background .1s',
                    }}
                  >
                    <div className="avatar" style={{ width:30, height:30, fontSize:12, background:'#4a7cf7', flexShrink:0 }}>
                      {u.name?.charAt(0)}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, lineHeight:1.3 }}>{u.name}</div>
                      <div style={{ fontSize:11, color:'var(--muted)', lineHeight:1.3 }}>{u.email}</div>
                    </div>
                    {u.department_name && (
                      <span style={{
                        fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:20, flexShrink:0,
                        background:'rgba(74,124,247,.15)', color:'var(--blue)',
                      }}>
                        🏢 {u.department_name}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {emailError && (
            <p style={{ fontSize:12, color:'var(--red)', marginTop:4 }}>{emailError}</p>
          )}
          <p style={{ fontSize:11, color:'var(--muted)', marginTop:5, lineHeight:1.5 }}>
            Digite o nome ou e-mail e selecione na lista, ou pressione{' '}
            <kbd style={{ background:'var(--navy3)', border:'1px solid var(--border)', borderRadius:4, padding:'1px 5px', fontSize:10 }}>Enter</kbd>{' '}
            para confirmar o e-mail manualmente.
          </p>
        </div>

        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Criando...' : `✓ Criar Pipe${emails.length > 0 ? ` + ${emails.length} colaborador${emails.length > 1 ? 'es' : ''}` : ''}`}
          </button>
        </div>
      </form>
    </Modal>
  )
}

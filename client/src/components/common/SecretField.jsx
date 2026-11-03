import { useState, useEffect, useRef } from 'react'
import LineIcon from './LineIcon'
import s from './SecretField.module.css'

const SHOW_MS = 30000

// Senha mascarada com "Mostrar" e "Copiar" (Cofre de Senhas e VLANs). A senha
// não fica guardada na tela: cada clique pede de novo ao servidor (que grava no
// log de auditoria se foi "show" ou "copy"). Mostrada, uma barra esvazia nos
// 30 s até ela se esconder sozinha.
// fetchSecret(purpose: 'show' | 'copy') → Promise<string | null>
export default function SecretField({ fetchSecret, label = 'senha' }) {
  const [value, setValue] = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)
  const copiedTimer = useRef(null)

  useEffect(() => {
    if (value === null) return
    const t = setTimeout(() => setValue(null), SHOW_MS)
    return () => clearTimeout(t)
  }, [value])
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const get = async purpose => {
    setLoading(true); setError(null)
    try {
      const v = await fetchSecret(purpose)
      if (v == null) setError(`Não deu para buscar a ${label}. Tente de novo.`)
      return v
    } catch (e) {
      // o motivo do servidor (ex.: 429 "espere um minuto") vale mais que o genérico
      setError(e?.response?.data?.error || `Não deu para buscar a ${label}. Tente de novo.`)
      return null
    } finally { setLoading(false) }
  }

  const toggle = async () => {
    if (value !== null) { setValue(null); return }
    const v = await get('show')
    if (v != null) setValue(v)
  }

  const copy = async () => {
    const v = await get('copy')
    if (v == null) return
    try {
      await navigator.clipboard.writeText(v)
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      // Safari/iOS recusa a cópia quando a resposta do servidor demora (o clique "expira")
      setError('O navegador não deixou copiar. Use "Mostrar" e copie à mão.')
    }
  }

  const shown = value !== null
  return (
    <span className={s.wrap}>
      <span className={`${s.value} ${shown ? s.shown : ''}`}>
        {loading ? <span className={s.dots}>…</span> : shown ? value : <span className={s.dots} aria-label={`${label} escondida`}>••••••••</span>}
        {shown && <span className={s.timer} aria-hidden="true" style={{ animationDuration: `${SHOW_MS}ms` }} />}
      </span>
      <button type="button" className={s.btn} onClick={toggle} disabled={loading}
        aria-label={shown ? `Esconder ${label}` : `Mostrar ${label}`} title={shown ? 'Esconder' : 'Mostrar (some sozinha em 30 s)'}>
        <LineIcon name={shown ? 'eyeOff' : 'eye'} size={15} />
      </button>
      <button type="button" className={s.btn} onClick={copy} disabled={loading}
        aria-label={copied ? `${label} copiada` : `Copiar ${label}`} title="Copiar">
        <LineIcon name={copied ? 'check' : 'copy'} size={15} />
      </button>
      {error && <span role="alert" className={s.error}>{error}</span>}
    </span>
  )
}

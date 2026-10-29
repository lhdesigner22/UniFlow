import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import s from './DashboardPage.module.css'

// Início = o telão PARISFE (pedido do Luiz, out/2026). O telão é uma página
// própria (parisfe.html + Three.js, fora do app e do pré-cache do PWA), então
// entra aqui num iframe do mesmo site; `?embed=1` avisa que está dentro do app.
// No dev o Vite só serve o arquivo com .html; em produção o caminho é /parisfe.
const TELAO_SRC = `${import.meta.env.DEV ? '/parisfe.html' : '/parisfe'}?embed=1`

export default function DashboardPage() {
  const navigate = useNavigate()
  const [running, setRunning] = useState(null)

  useEffect(() => {
    let alive = true
    api.get('/time/running').then(r => { if (alive) setRunning(r.data || null) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const stopTimer = async () => {
    if (!running) return
    try {
      await api.post(`/cards/${running.card_id}/time/stop`)
      setRunning(null)
    } catch {}
  }

  return (
    <div className={s.page}>
      <iframe
        className={s.screen}
        src={TELAO_SRC}
        title="PARISFE — os sete valores da UniFECAF"
        allow="fullscreen"
      />

      {running && (
        <div className={s.runningBar} role="status">
          <span className={s.runningDot} />
          <span className={s.runningText}>Cronômetro rodando em <strong>"{running.card_title}"</strong></span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/boards/${running.board_id}`)}>Ver quadro</button>
          <button className="btn btn-danger btn-sm" onClick={stopTimer}>Parar</button>
        </div>
      )}
    </div>
  )
}

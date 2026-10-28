import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/authStore'
import Reveal from '../components/common/Reveal'
import { avatarColor } from '../utils/avatarColor'
import { parseDateOnly } from '../utils/formatDuration'
import s from './DashboardPage.module.css'

function formatDue(due) {
  if (!due) return null
  return parseDateOnly(due).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

// Ícone da placa "Princípios" (svg simples, mesmo padrão inline usado em
// Topbar.jsx/TeamPerformancePage.jsx — sem lib de ícones).
function PrincipleIcon({ path }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  )
}

// Os 7 princípios da placa física da UniFECAF — pedido explícito pra deixar
// visível na aba Início. Reorganizados em grade (cada princípio na sua
// própria caixa) pra aproveitar o espaço largo que sobrou com "Meus
// quadros" saindo desta página (os quadros agora só vivem na sidebar).
const PRINCIPLES = [
  {
    label: 'Proatividade',
    desc: 'Antecipar problemas e agir antes de alguém precisar pedir. Perceber o que está errado e já se mexer.',
    text: 'Aproveitando que pediu o boleto: por que faltou às últimas 5 aulas? Você está bem?',
    icon: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /></>,
  },
  {
    label: 'Agilidade',
    desc: 'Responder rápido e sem enrolação. O tempo de quem está esperando importa.',
    text: 'Não basta fazer, tem que ser AGORA!',
    icon: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  },
  {
    label: 'Resolutividade',
    desc: 'Ir até o fim: não empurrar o problema adiante nem resolver pela metade.',
    text: 'Não basta ser rápido, tem que RESOLVER!',
    icon: <><path d="M22 11.5V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  },
  {
    label: 'Informalidade',
    desc: 'Tratar as pessoas com leveza e proximidade, sem perder o profissionalismo no meio do caminho.',
    text: ';) arrasoooooooooooooou miga!!!',
    icon: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  },
  {
    label: 'Segurança da informação passada',
    desc: 'Confirmar antes de afirmar. Informação errada passada adiante custa caro pra outra pessoa.',
    text: 'Você tem certeza?',
    icon: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  },
  {
    label: 'Flexibilidade',
    desc: 'Adaptar a regra ao caso real, sem perder o bom senso nem travar no "não pode".',
    text: 'Olha, já que a regra não te atende, isso aqui não funcionaria para você?',
    icon: <><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>,
  },
  {
    label: 'Empatia',
    desc: 'Se colocar no lugar de quem está pedindo ajuda antes de responder.',
    text: 'Eu te entendo! Vou te ajudar...',
    icon: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  },
]

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const [myCards, setMyCards] = useState([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [running, setRunning] = useState(null)

  useEffect(() => {
    let alive = true
    setLoadingCards(true)
    api.get('/boards')
      .then(async r => {
        if (!alive) return
        const list = r.data || []

        // "Meus cartões": não existe endpoint dedicado no contrato da API —
        // busca os cards de cada quadro e filtra client-side. Só é razoável
        // porque cada usuário tende a ter poucos quadros; se isso mudar,
        // o ideal é criar um endpoint agregado no servidor.
        if (list.length > 0 && list.length <= 12) {
          try {
            const results = await Promise.all(
              list.map(b => api.get(`/boards/${b.id}/cards`).then(res => ({ board: b, cards: res.data || [] })).catch(() => ({ board: b, cards: [] })))
            )
            const mine = []
            for (const { board, cards } of results) {
              for (const c of cards) {
                if (c.members?.some(m => m.id === user?.id)) {
                  mine.push({ ...c, boardName: board.name, boardColor: board.color, boardId: board.id })
                }
              }
            }
            mine.sort((a, b) => {
              if (!a.due_date && !b.due_date) return 0
              if (!a.due_date) return 1
              if (!b.due_date) return -1
              return new Date(a.due_date) - new Date(b.due_date)
            })
            if (alive) setMyCards(mine.slice(0, 6))
          } catch { /* deviation-tolerant: skip silently */ }
        }
        if (alive) setLoadingCards(false)
      })
      .catch(() => { if (alive) setLoadingCards(false) })

    api.get('/time/running').then(r => { if (alive) setRunning(r.data || null) }).catch(() => {})

    return () => { alive = false }
  }, [user?.id])

  const stopTimer = async () => {
    if (!running) return
    try {
      await api.post(`/cards/${running.card_id}/time/stop`)
      setRunning(null)
    } catch {}
  }

  const firstName = user?.name?.split(' ')[0] || ''

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Olá, {firstName}</h1>
          <p className={s.sub}>Aqui está o que está em andamento agora — seus quadros ficam na barra lateral.</p>
        </div>
      </div>

      {running && (
        <div className={s.runningBar}>
          <span className={s.runningDot} />
          <span>Você está com o cronômetro rodando em <strong>"{running.card_title}"</strong></span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/boards/${running.board_id}`)}>Ver quadro</button>
          <button className="btn btn-danger btn-sm" onClick={stopTimer}>Parar</button>
        </div>
      )}

      {/* ── PARISFE (princípios UniFECAF) ── */}
      <div className={s.principlesSection}>
        <div className={s.principlesHeader}>
          <img src="/unifecaf-logo.png" alt="UniFECAF" className={s.principlesLogo} />
          <div>
            <span className={s.principlesBrand}>UniFECAF</span>
            <span className={s.principlesTagline}>Seu sonho, nossa meta!</span>
          </div>
          <span className={s.principlesTitle}>PARISFE</span>
          {/* Página própria (public/parisfe.html), sem login, pra deixar aberta na TV */}
          <a className={`btn btn-ghost btn-sm ${s.principlesScreen}`} href="/parisfe" target="_blank" rel="noopener">
            Abrir no telão
          </a>
        </div>
        <div className={s.principlesGrid}>
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.label} delay={i * 60} className={s.principleBox}>
              <span className={s.principleIcon}><PrincipleIcon path={p.icon} /></span>
              <span className={s.principlePill}>{p.label}</span>
              <p className={s.principleDesc}>{p.desc}</p>
              <p className={s.principleText}>"{p.text}"</p>
            </Reveal>
          ))}
        </div>
      </div>

      {/* ── Meus cartões ── */}
      {!loadingCards && myCards.length > 0 && (
        <div className={s.section}>
          <h2 className={s.sectionTitle}>Meus cartões</h2>
          <div className={s.cardsList}>
            {myCards.map((c, i) => (
              <Reveal key={c.id} delay={i * 50} className={s.cardRow} onClick={() => navigate(`/boards/${c.boardId}`)}>
                <span className={s.cardDot} style={{ background: c.boardColor || avatarColor(c.boardId) }} />
                <span className={s.cardTitle}>{c.title}</span>
                <span className={s.cardBoard}>{c.boardName}</span>
                {c.due_date && <span className={s.cardDue}>{formatDue(c.due_date)}</span>}
              </Reveal>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

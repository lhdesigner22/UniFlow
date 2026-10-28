import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import Reveal from '../components/common/Reveal'
import s from './VlansPage.module.css'

const SITES = {
  matriz: { label: 'Matriz', desc: 'Prédios G5 e SEDE' },
  administrativo: { label: 'Administrativo', desc: 'Prédio Administrativo' },
}

const SEGMENTS = [
  { key: 'docente', label: 'Rede Docente' },
  { key: 'discente', label: 'Rede Discente' },
]

function NetworkTable({ title, rows }) {
  return (
    <Reveal as="div" className={s.card}>
      <h2 className={s.cardTitle}>{title}<span className={s.cardCount}>{rows.length} VLAN(s)</span></h2>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>VLAN</th><th>ID</th><th>Rede</th><th>Máscara</th><th>Gateway</th><th>Broadcast</th><th>Range DHCP</th><th className={s.num}>IPs utilizáveis</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className={s.name}>{r.name}</td>
                <td className={s.vlanId}>{r.vlan_id}</td>
                <td className={s.mono}>{r.network}</td>
                <td className={s.mono}>{r.mask}</td>
                <td className={s.mono}>{r.gateway}</td>
                <td className={s.mono}>{r.broadcast}</td>
                <td className={s.mono}>{r.dhcp_range}</td>
                <td className={`${s.mono} ${s.num}`}>{r.usable_ips?.toLocaleString('pt-BR')}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className={s.empty}>Nenhuma VLAN bate com a busca.</td></tr>}
          </tbody>
        </table>
      </div>
    </Reveal>
  )
}

// Senha do Wi-Fi: só é buscada no servidor quando a pessoa clica em
// "Mostrar" ou "Copiar" (igual ao Cofre de Senhas).
function SsidRow({ ssid }) {
  const [password, setPassword] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Como no Cofre: sem guardar a senha na tela — cada "Mostrar"/"Copiar" passa
  // pelo servidor (log de auditoria) e a senha mostrada some sozinha em 30 s.
  useEffect(() => {
    if (!revealed) return
    const t = setTimeout(() => { setRevealed(false); setPassword(null) }, 30000)
    return () => clearTimeout(t)
  }, [revealed])

  const fetchPassword = async (purpose) => {
    setLoading(true)
    try {
      const { data } = await api.get(`/vlans/ssids/${ssid.id}/reveal`, { params: { purpose } })
      return data.password
    } catch {
      return null
    } finally {
      setLoading(false)
    }
  }

  const toggle = async () => {
    if (revealed) { setRevealed(false); setPassword(null); return }
    const pwd = await fetchPassword('show')
    if (pwd !== null) { setPassword(pwd); setRevealed(true) }
  }

  const copy = async () => {
    const pwd = await fetchPassword('copy')
    if (!pwd) return
    try {
      await navigator.clipboard.writeText(pwd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard indisponível — ignora */ }
  }

  return (
    <tr>
      <td className={s.name}>{ssid.ssid}</td>
      <td>
        {ssid.has_password ? (
          <div className={s.passwordRow}>
            <span className={s.passwordValue}>{loading ? '...' : revealed ? password : '••••••••'}</span>
            <button className={s.smallBtn} title={revealed ? 'Esconder' : 'Mostrar'} onClick={toggle}>{revealed ? '🙈' : '👁'}</button>
            <button className={s.smallBtn} title="Copiar senha" onClick={copy}>{copied ? '✓' : '📋'}</button>
          </div>
        ) : <span className={s.note}>—</span>}
      </td>
      <td className={s.vlanId}>{ssid.vlan_id}</td>
      <td>{ssid.note && <span className={s.noteTag}>{ssid.note}</span>}</td>
    </tr>
  )
}

export default function VlansPage() {
  const { site } = useParams()
  const info = SITES[site]
  const [data, setData] = useState(null) // { networks, ssids }
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!info) return
    setData(null)
    setError('')
    setSearch('')
    api.get('/vlans', { params: { site } })
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || 'Erro ao carregar as VLANs.'))
  }, [site])

  const term = search.trim().toLowerCase()
  const networks = useMemo(() => (data?.networks || []).filter(n =>
    !term || `${n.name} ${n.vlan_id} ${n.network} ${n.gateway} ${n.dhcp_range}`.toLowerCase().includes(term)), [data, term])
  const ssids = useMemo(() => (data?.ssids || []).filter(w =>
    !term || `${w.ssid} ${w.vlan_id}`.toLowerCase().includes(term)), [data, term])

  if (!info) return <div role="alert" className={s.errorBox}>Local não encontrado.</div>
  if (error) return <div role="alert" className={s.errorBox}>{error}</div>
  if (!data) return <div className={s.loading}>Carregando VLANs...</div>

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Segmentação de VLANs — {info.label}</h1>
          <p className={s.sub}>{info.desc} · redes, gateways, faixas de DHCP e SSIDs do Wi-Fi</p>
        </div>
        <input
          className={s.searchInput}
          placeholder="Buscar VLAN, ID, rede, SSID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {SEGMENTS.map(seg => {
        const rows = networks.filter(n => n.segment === seg.key)
        // Esconde o bloco inteiro quando o local não tem esse segmento (ex: Administrativo não tem Rede Discente)
        if (!(data.networks || []).some(n => n.segment === seg.key)) return null
        return <NetworkTable key={seg.key} title={seg.label} rows={rows} />
      })}

      <Reveal as="div" className={s.card}>
        <h2 className={s.cardTitle}>Rede WLAN<span className={s.cardCount}>{ssids.length} SSID(s)</span></h2>
        <div className={s.tableWrap}>
          <table className={`${s.table} ${s.wlanTable}`}>
            <thead><tr><th>SSID</th><th>Senha</th><th>VLAN ID</th><th></th></tr></thead>
            <tbody>
              {ssids.map(w => <SsidRow key={w.id} ssid={w} />)}
              {ssids.length === 0 && <tr><td colSpan={4} className={s.empty}>Nenhum SSID bate com a busca.</td></tr>}
            </tbody>
          </table>
        </div>
      </Reveal>
    </div>
  )
}

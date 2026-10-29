import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import api from '../services/api'
import LineIcon from '../components/common/LineIcon'
import SecretField from '../components/common/SecretField'
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
    <section className={s.card} aria-label={title}>
      <h2 className={s.cardTitle}>{title}<span className={s.cardCount}>{rows.length}</span></h2>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>VLAN</th><th>ID</th><th>Rede</th><th>Máscara</th><th>Gateway</th><th>Broadcast</th><th>Faixa do DHCP</th><th className={s.num}>IPs utilizáveis</th>
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
            {rows.length === 0 && <tr><td colSpan={8} className={s.empty}>Nenhuma VLAN com essa busca.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Senha do Wi-Fi: o mesmo campo do Cofre — só é buscada no servidor ao clicar
// em "Mostrar" ou "Copiar" (log de auditoria) e some sozinha em 30 s.
function SsidRow({ ssid }) {
  const fetchSecret = async purpose => (await api.get(`/vlans/ssids/${ssid.id}/reveal`, { params: { purpose } })).data.password
  return (
    <tr>
      <td className={s.name}>{ssid.ssid}</td>
      <td>{ssid.has_password ? <SecretField fetchSecret={fetchSecret} /> : <span className={s.note}>Sem senha</span>}</td>
      <td className={s.vlanId}>{ssid.vlan_id && ssid.vlan_id !== '-' ? ssid.vlan_id : <span className={s.note}>—</span>}</td>
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
          <h1 className={s.title}>VLANs: {info.label}</h1>
          <p className={s.sub}>{info.desc}. Redes, gateways, faixas de DHCP e as redes Wi-Fi.</p>
        </div>
        <label className={s.search}>
          <LineIcon name="search" size={15} />
          <span className="sr-only">Buscar VLAN</span>
          <input type="search" placeholder="Buscar VLAN, ID, rede, SSID" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
      </div>

      {SEGMENTS.map(seg => {
        const rows = networks.filter(n => n.segment === seg.key)
        // Esconde o bloco inteiro quando o local não tem esse segmento (ex: Administrativo não tem Rede Discente)
        if (!(data.networks || []).some(n => n.segment === seg.key)) return null
        return <NetworkTable key={seg.key} title={seg.label} rows={rows} />
      })}

      <section className={s.card} aria-label="Redes Wi-Fi">
        <h2 className={s.cardTitle}>Redes Wi-Fi<span className={s.cardCount}>{ssids.length}</span></h2>
        <p className={s.cardNote}><LineIcon name="shield" size={14} /> Cada senha mostrada ou copiada fica no histórico de acesso e some sozinha em 30 segundos.</p>
        <div className={s.tableWrap}>
          <table className={`${s.table} ${s.wlanTable}`}>
            <thead><tr><th>Nome da rede (SSID)</th><th>Senha</th><th>VLAN</th><th>Observação</th></tr></thead>
            <tbody>
              {ssids.map(w => <SsidRow key={w.id} ssid={w} />)}
              {ssids.length === 0 && <tr><td colSpan={4} className={s.empty}>Nenhuma rede Wi-Fi com essa busca.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

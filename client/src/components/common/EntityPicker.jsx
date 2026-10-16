import { useAuthStore } from '../../store/authStore'

// Escolha da entidade do GLPI nas telas de Chamados — só aparece pra quem enxerga
// todos os departamentos E há mais de uma entidade configurada. Os demais veem a
// entidade do próprio departamento, sem escolher.
export default function EntityPicker({ entity, entities, onChange }) {
  const { user } = useAuthStore()
  if (user?.scope !== 'all' || !entities || entities.length < 2) return null
  return (
    <select
      value={entity || ''}
      onChange={e => onChange(e.target.value)}
      title="Entidade do GLPI"
      style={{ width: 'auto', maxWidth: 240, fontSize: 12.5, height: 32 }}
    >
      {entities.map(name => <option key={name} value={name}>🏷️ {name}</option>)}
    </select>
  )
}

// Aviso quando o departamento da pessoa não tem entidade do GLPI configurada.
export function NoEntityNotice() {
  return (
    <div style={{ textAlign: 'center', padding: '72px 24px', color: 'var(--text-muted)', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ fontSize: 34, marginBottom: 10 }}>🏷️</div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', color: 'var(--text)', marginBottom: 8 }}>Seu departamento ainda não tem entidade do GLPI</h3>
      <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        Peça a um Super Admin para escolher a entidade do GLPI do seu departamento em Administração → Departamentos. Depois disso, os chamados dela aparecem aqui.
      </p>
    </div>
  )
}

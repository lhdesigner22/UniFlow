import { useAuthStore } from '../../store/authStore'
import { canView } from '../../utils/permissions'

// Barra a tela inteira quando o cargo da pessoa não tem acesso ao módulo (ex: ela
// digitou o endereço direto, já que o menu nem mostra). O servidor também recusa
// os dados — isto só dá uma mensagem clara em vez de uma tela vazia/com erro.
export default function RequireModule({ module, children }) {
  const { user } = useAuthStore()
  if (!user) return null
  if (canView(user, module)) return children
  return (
    <div style={{ textAlign: 'center', padding: '96px 24px', color: 'var(--text-muted)', maxWidth: 460, margin: '0 auto' }}>
      <div style={{ fontSize: 38, marginBottom: 12 }}>🔒</div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', color: 'var(--text)', marginBottom: 8 }}>Sem acesso a esta área</h2>
      <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        O seu cargo ({user.role_name || 'atual'}) não tem permissão para ver esta página. Se precisa dela, peça a um Super Admin para ajustar o cargo.
      </p>
    </div>
  )
}

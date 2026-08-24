import { avatarColor } from '../../utils/avatarColor'

/**
 * Overlapping avatar circles — the "mais coletivo" pattern reused across
 * DashboardPage, BoardPage header, CardItem and CardModal.
 * `members`: array of { id, name, avatar? }
 */
export default function AvatarStack({ members = [], max = 5, size = 28 }) {
  const shown = members.slice(0, max)
  const overflow = members.length - shown.length

  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) }

  return (
    <div className="avatarStack">
      {shown.map(m => (
        <div
          key={m.id}
          className="avatar"
          title={m.name}
          style={{ ...style, background: avatarColor(m.id) }}
        >
          {m.avatar
            ? <img src={m.avatar} alt={m.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
            : (m.name?.charAt(0).toUpperCase() || '?')}
        </div>
      ))}
      {overflow > 0 && (
        <div className="avatarMore" style={style} title={`+${overflow}`}>
          +{overflow}
        </div>
      )}
    </div>
  )
}

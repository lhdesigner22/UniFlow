import Avatar from './Avatar'

/**
 * Overlapping avatar circles — the "mais coletivo" pattern reused across
 * DashboardPage, BoardPage header, CardItem and CardModal.
 * `members`: array of { id, name, avatar? }
 */
export default function AvatarStack({ members = [], max = 5, size = 28 }) {
  const shown = members.slice(0, max)
  const overflow = members.length - shown.length

  return (
    <div className="avatarStack">
      {shown.map(m => (
        <Avatar key={m.id} id={m.id} name={m.name} photo={m.avatar} size={size} />
      ))}
      {overflow > 0 && (
        <div className="avatarMore" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} title={`+${overflow}`}>
          +{overflow}
        </div>
      )}
    </div>
  )
}

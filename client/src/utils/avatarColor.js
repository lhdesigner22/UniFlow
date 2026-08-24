const PALETTE = ['#FF6B4A', '#0EA5A5', '#845EF7', '#FFB020', '#22C55E', '#FF5C93', '#3B82F6', '#F97316']

export function avatarColor(userId) {
  if (!userId) return PALETTE[0]
  let hash = 0
  const id = String(userId)
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export default PALETTE

const PALETTE = ['#3B82F6', '#22C55E', '#8B5CF6', '#FFB020', '#FF5C93', '#06B6D4', '#F97316', '#EF4444']

export function avatarColor(userId) {
  if (!userId) return PALETTE[0]
  let hash = 0
  const id = String(userId)
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export default PALETTE

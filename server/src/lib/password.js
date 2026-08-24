// Hash de senha via Web Crypto (PBKDF2-SHA256) — substitui bcryptjs.
// Motivo: bcrypt é deliberadamente lento (bom para segurança, ruim para o limite
// de CPU do plano Free do Workers, 10ms/requisição). PBKDF2 via crypto.subtle é
// nativo (BoringSSL), então roda muito mais rápido que bcrypt em JS puro para o
// mesmo nível de custo computacional.
//
// Formato armazenado: "pbkdf2$<iterações>$<salt base64>$<hash base64>"
// (auto-descritivo — permite subir as iterações no futuro sem invalidar hashes antigos)

const ITERATIONS = 100_000
const HASH_BITS = 256
const enc = new TextEncoder()

function toBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}
function fromBase64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0))
}

async function deriveBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    HASH_BITS
  )
}

// Comparação em tempo constante (evita timing attack na verificação do hash)
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const bits = await deriveBits(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(bits)}`
}

export async function verifyPassword(password, stored) {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const [, iterStr, saltB64, hashB64] = parts
  const iterations = parseInt(iterStr, 10)
  const salt = fromBase64(saltB64)
  const expected = fromBase64(hashB64)
  const actual = new Uint8Array(await deriveBits(password, salt, iterations))
  return timingSafeEqual(actual, expected)
}

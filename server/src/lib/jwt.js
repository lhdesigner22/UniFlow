// Assinatura/verificação de JWT via `jose` — substitui `jsonwebtoken`.
// Motivo: `jose` é a lib padrão para runtimes de Workers/edge (Web Crypto puro,
// sem dependência de APIs de Node); `jsonwebtoken` funciona com nodejs_compat mas
// jose é a escolha nativa recomendada pela Cloudflare para JWT em Workers.
import { SignJWT, jwtVerify } from 'jose'

function key(secret) {
  return new TextEncoder().encode(secret)
}

// 48h (não mais 7 dias) — sessão mais curta força reautenticação com mais
// frequência, o que também mantém nome/foto sincronizados com o Google
// sem precisar de "forçar novo login" manual (ver admin.js).
export async function signJwt(payload, secret, expiresIn = '48h') {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key(secret))
}

export async function verifyJwt(token, secret) {
  const { payload } = await jwtVerify(token, key(secret))
  return payload
}

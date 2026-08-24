// Assinatura/verificação de JWT via `jose` — substitui `jsonwebtoken`.
// Motivo: `jose` é a lib padrão para runtimes de Workers/edge (Web Crypto puro,
// sem dependência de APIs de Node); `jsonwebtoken` funciona com nodejs_compat mas
// jose é a escolha nativa recomendada pela Cloudflare para JWT em Workers.
import { SignJWT, jwtVerify } from 'jose'

function key(secret) {
  return new TextEncoder().encode(secret)
}

export async function signJwt(payload, secret, expiresIn = '7d') {
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

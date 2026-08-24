// Verificação do ID token do Google via JWKS remoto (jose) — substitui `google-auth-library`.
// Motivo: google-auth-library depende pesadamente de APIs de Node (https, crypto);
// a verificação de um ID token é só "validar assinatura RS256 + aud/iss/exp", o que
// jose faz nativamente em Workers sem nenhuma dependência de Node.
import { createRemoteJWKSet, jwtVerify } from 'jose'

// Cacheado no escopo do módulo — sobrevive entre requisições no mesmo isolate
// e a própria jose já lida com rotação/refresh das chaves.
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

/**
 * @param {string} idToken
 * @param {string} clientId  GOOGLE_CLIENT_ID esperado (audience)
 * @returns {Promise<{email: string, name: string, picture?: string, sub: string}>}
 */
export async function verifyGoogleIdToken(idToken, clientId) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: clientId,
  })
  return payload
}

// Decodifica sem verificar — usado só para diagnóstico (comparar aud antes de
// verificar de fato), mesma ideia que já existia em routes/auth.js.
export function decodeJwtPayload(token) {
  const [, payloadB64] = token.split('.')
  return JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
}

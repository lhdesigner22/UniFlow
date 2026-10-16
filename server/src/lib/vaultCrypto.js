// Criptografia das senhas do Cofre — AES-256-GCM via Web Crypto (nativo do
// runtime dos Workers, sem dependência externa). A chave só existe como
// secret do Worker (VAULT_ENCRYPTION_KEY, 32 bytes em base64) — nunca no
// banco, nunca no código. Sem ela, o D1 sozinho não tem como decifrar nada.

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}
function bytesToB64(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function importKey(env) {
  if (!env.VAULT_ENCRYPTION_KEY) {
    throw new Error('VAULT_ENCRYPTION_KEY não configurada nos secrets do Worker.')
  }
  const raw = b64ToBytes(env.VAULT_ENCRYPTION_KEY)
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(env, plaintext) {
  const key = await importKey(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(plaintext)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return { ciphertext: bytesToB64(new Uint8Array(cipher)), iv: bytesToB64(iv) }
}

export async function decryptSecret(env, ciphertextB64, ivB64) {
  const key = await importKey(env)
  const iv = b64ToBytes(ivB64)
  const data = b64ToBytes(ciphertextB64)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(plain)
}

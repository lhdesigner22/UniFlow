// Cliente mínimo pra Google Drive (armazenamento de arquivo externo) — usado
// pelos anexos da Base de Conhecimento, que passam bem do limite prático de
// um valor de coluna do D1 (2 MB). Reaproveita a infraestrutura Google já
// existente no projeto (Workspace da organização) em vez de criar conta em
// mais um serviço externo — só precisa habilitar a API do Drive no mesmo
// projeto do Google Cloud já usado pro login/OAuth.
//
// Autenticação via Service Account (JWT assinado com a chave privada,
// trocado por um access token — fluxo padrão OAuth2 "server-to-server",
// RFC 7523). Usa `jose` (já dependência do projeto, mesma lib do
// server/src/lib/jwt.js) pra assinar o JWT com RS256.
//
// Credenciais em env.GOOGLE_SA_EMAIL / env.GOOGLE_SA_PRIVATE_KEY (secrets,
// via `wrangler secret put` — nunca aqui) + env.GOOGLE_IMPERSONATE_EMAIL
// (secret — a conta real sendo impersonada, ver abaixo) + env.GOOGLE_DRIVE_
// FOLDER_ID (var — não é sensível, só identifica a pasta do Drive).
//
// Autenticação usa DELEGAÇÃO EM TODO O DOMÍNIO (domain-wide delegation), não
// a própria identidade da service account — descoberto na prática:
// contas de serviço contam como identidade EXTERNA ao Workspace, e esse
// Workspace bloqueia externos de acessar Drives Compartilhados mesmo depois
// de "adicionados" manualmente como membro (a API confirmava
// `visibleSharedDrives: []` pra service account sozinha, mesmo autenticada
// com sucesso). Com delegação em todo o domínio (autorizada no Admin Console
// do Workspace, pelo Client ID numérico da service account), o JWT usa `sub`
// = uma conta real da organização (env.GOOGLE_IMPERSONATE_EMAIL) — a API
// então age como se fosse essa pessoa, sem nenhuma fronteira "externo".
//
// GOOGLE_DRIVE_FOLDER_ID aqui é, na prática, um Drive Compartilhado (o ID
// começa com "0A", padrão reconhecido de Shared Drive) — por isso todo
// request abaixo passa `supportsAllDrives=true`, exigido pela API do Drive
// pra qualquer operação (criar/ler/apagar arquivo) que toque um Drive
// Compartilhado. Sem esse parâmetro as chamadas falham/ignoram o conteúdo
// do Drive Compartilhado mesmo com a service account tendo acesso.
import { SignJWT, importPKCS8 } from 'jose'

const SCOPE = 'https://www.googleapis.com/auth/drive'

function normalizePrivateKey(key) {
  // Se a chave foi colada com "\n" literal (em vez de quebra de linha de
  // verdade — comum quando vem de um .env ou de um JSON copiado como texto
  // corrido), desfaz isso antes de importar.
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key
}

async function getAccessToken(env) {
  const privateKey = await importPKCS8(normalizePrivateKey(env.GOOGLE_SA_PRIVATE_KEY), 'RS256')
  const now = Math.floor(Date.now() / 1000)

  // `sub` = a conta de verdade sendo impersonada (delegação em todo o
  // domínio) — não a própria service account. Descoberto na prática: sem
  // impersonar ninguém, a service account é tratada como identidade externa
  // ao Workspace e não enxerga NENHUM Drive Compartilhado, mesmo sendo
  // adicionada como membro manualmente (visibleSharedDrives vinha vazio).
  // Com a delegação, ela age como se fosse essa conta real — que já é
  // membro normal do Drive Compartilhado, sem essa restrição.
  const jwt = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(env.GOOGLE_SA_EMAIL)
    .setSubject(env.GOOGLE_IMPERSONATE_EMAIL)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google token respondeu ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  return data.access_token
}

// Sobe um arquivo pro Drive via upload resumível — obrigatório pra qualquer
// coisa acima de 5 MB (o upload "simples" só aceita até 5 MB). Como o Worker
// já segura o arquivo inteiro em memória de qualquer forma (limite de 50 MB),
// manda tudo de uma vez num único PUT — sem precisar picotar em pedaços.
export async function driveUploadFile(env, { fileName, contentType, data }) {
  const token = await getAccessToken(env)

  const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id&supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': contentType || 'application/octet-stream',
      'X-Upload-Content-Length': String(data.byteLength),
    },
    body: JSON.stringify({ name: fileName, parents: [env.GOOGLE_DRIVE_FOLDER_ID] }),
  })
  if (!initRes.ok) {
    const body = await initRes.text().catch(() => '')
    throw new Error(`Drive (iniciar upload) respondeu ${initRes.status}: ${body.slice(0, 300)}`)
  }
  const uploadUrl = initRes.headers.get('Location')
  if (!uploadUrl) throw new Error('Drive (iniciar upload): resposta sem header Location')

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': String(data.byteLength),
    },
    body: data,
  })
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '')
    throw new Error(`Drive upload respondeu ${uploadRes.status}: ${body.slice(0, 300)}`)
  }
  const result = await uploadRes.json()
  return { fileId: result.id }
}

// Baixa um arquivo do Drive — devolve a Response inteira (com `.body` como
// stream), pra quem chamar repassar direto sem bufferizar tudo em memória.
export async function driveDownloadFile(env, { fileId }) {
  const token = await getAccessToken(env)
  return fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Apaga um arquivo do Drive — best-effort (chamado ao trocar/remover um
// anexo ou excluir o artigo; quem chama deve tratar falha aqui como não-fatal).
export async function driveDeleteFile(env, { fileId }) {
  if (!fileId) return
  const token = await getAccessToken(env)
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '')
    throw new Error(`Drive delete respondeu ${res.status}: ${body.slice(0, 300)}`)
  }
}

export function driveConfigured(env) {
  return !!(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY && env.GOOGLE_DRIVE_FOLDER_ID && env.GOOGLE_IMPERSONATE_EMAIL)
}

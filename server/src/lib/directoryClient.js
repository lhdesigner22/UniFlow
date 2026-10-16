// Cliente mínimo pra buscar gente no diretório do Google Workspace pelo
// nome (mesma busca que aparece no Gmail/Contatos ao digitar um nome) —
// usado pra preencher o e-mail do professor sozinho em Empréstimo de
// Equipamentos, a partir do nome que já veio da grade de horários.
//
// Mesmo padrão de autenticação do driveClient.js (Service Account + Domain-
// Wide Delegation, JWT assinado, ver comentário lá pra detalhes) — só que
// com outro escopo, que precisou ser autorizado à parte no Admin Console
// (Segurança → Controles de API → Delegação em todo o domínio) pro mesmo
// Client ID já usado pelo Drive.
import { SignJWT, importPKCS8 } from 'jose'
import { isAllowedLoanEmail } from './loanEmailDomains.js'

const SCOPE = 'https://www.googleapis.com/auth/directory.readonly'

function normalizePrivateKey(key) {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key
}

async function getAccessToken(env) {
  const privateKey = await importPKCS8(normalizePrivateKey(env.GOOGLE_SA_PRIVATE_KEY), 'RS256')
  const now = Math.floor(Date.now() / 1000)

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

const stripAccents = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

async function searchPeople(token, query) {
  const url = new URL('https://people.googleapis.com/v1/people:searchDirectoryPeople')
  url.searchParams.set('query', query)
  url.searchParams.set('readMask', 'names,emailAddresses')
  // As duas fontes juntas: perfil de diretório (org inteira) E contato de
  // domínio (gente que só aparece como "contato compartilhado", conforme
  // a configuração de visibilidade de cada usuário) — com só a primeira,
  // gente que existe mas não tem o perfil totalmente público ficava de fora.
  url.searchParams.append('sources', 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE')
  url.searchParams.append('sources', 'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT')
  url.searchParams.set('pageSize', '5')

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`People API respondeu ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  return data.people || []
}

// A grade de horários vem com o nome completo "oficial" (às vezes com dois
// ou três nomes do meio), mas o Workspace costuma cadastrar só
// Primeiro + Último ("ALESSANDRA SPURI FACHIM SALVIONI" na grade vira
// "Alessandra Salvioni" no diretório) — a busca com o nome completo não
// acha ninguém porque "SPURI"/"FACHIM" não batem com nenhum campo do
// perfil. Tenta o nome como veio primeiro e, se não achar, cai pra
// Primeiro nome + Último sobrenome.
function nameQueryVariants(fullName) {
  const words = fullName.trim().split(/\s+/)
  const variants = [fullName]
  if (words.length > 2) variants.push(`${words[0]} ${words[words.length - 1]}`)
  return [...new Set(variants)]
}

// Busca no diretório da organização (People API — searchDirectoryPeople) e
// devolve { name, email } do resultado mais parecido, ou null se não achar
// ninguém com e-mail cadastrado.
export async function directorySearchByName(env, name) {
  const token = await getAccessToken(env)
  const target = stripAccents(name)
  const targetWords = target.split(/\s+/)
  const targetFirst = targetWords[0]
  const targetLast = targetWords[targetWords.length - 1]

  // Só e-mails permitidos no empréstimo (colaborador/professor) — conta de
  // aluno (@a.fecaf.com.br) é ignorada, mesmo que o nome bata.
  const allowedEmailOf = p => {
    const emails = p.emailAddresses || []
    return (emails.find(e => e.metadata?.primary && isAllowedLoanEmail(e.value)) || emails.find(e => isAllowedLoanEmail(e.value)))?.value
  }

  for (const query of nameQueryVariants(name)) {
    const people = (await searchPeople(token, query)).filter(allowedEmailOf)
    if (people.length === 0) continue

    // Prioriza um match exato; sem isso, aceita quem tem o primeiro E o
    // último nome batendo (cobre o caso do nome do meio cortado); só no
    // fim usa o primeiro resultado da busca como último recurso.
    const best =
      people.find(p => stripAccents(p.names?.[0]?.displayName) === target) ||
      people.find(p => {
        const dn = stripAccents(p.names?.[0]?.displayName)
        return dn && dn.includes(targetFirst) && dn.includes(targetLast)
      }) ||
      people[0]

    const email = allowedEmailOf(best)
    if (email) return { name: best.names?.[0]?.displayName || name, email }
  }
  return null
}

export function directoryConfigured(env) {
  return !!(env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY && env.GOOGLE_IMPERSONATE_EMAIL)
}

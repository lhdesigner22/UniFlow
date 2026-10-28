import api from '../services/api'
import { alertDialog } from '../store/dialogStore'

// Download nativo do navegador (via <a href download>) em vez de buscar o
// arquivo inteiro num blob pelo JS antes de salvar — o navegador começa a
// mostrar progresso na hora (barra de download dele), sem esperar o
// download inteiro terminar só pra então abrir o diálogo de salvar. Isso é
// o que causava a demora percebida em arquivos maiores (driver de
// impressora, anexo da Base de Conhecimento).
//
// Um <a> nativo não manda o header Authorization, então antes pedimos ao
// servidor um ticket de 60s que só vale para ESTE arquivo e vai como
// `?ticket=` (ver server/src/lib/requestToken.js). Antes ia o token de login
// inteiro na URL — ficava no histórico e valia para o sistema todo.
export async function downloadFile(url, filename) {
  const path = `${api.defaults.baseURL}${url}`
  let data
  try {
    ({ data } = await api.post('/auth/download-ticket', { path }))
  } catch (e) {
    alertDialog(e.response?.data?.error || 'Não foi possível baixar o arquivo. Tente de novo.', { danger: true })
    return
  }

  const a = document.createElement('a')
  a.href = `${path}?ticket=${encodeURIComponent(data.ticket)}`
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

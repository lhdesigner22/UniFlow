import api from '../services/api'

// Download nativo do navegador (via <a href download>) em vez de buscar o
// arquivo inteiro num blob pelo JS antes de salvar — o navegador começa a
// mostrar progresso na hora (barra de download dele), sem esperar o
// download inteiro terminar só pra então abrir o diálogo de salvar. Isso é
// o que causava a demora percebida em arquivos maiores (driver de
// impressora, anexo da Base de Conhecimento).
//
// O token vai como `?token=` na URL porque um <a> nativo não manda o header
// Authorization — o middleware de auth do servidor aceita os dois (ver
// server/src/middleware/auth.js).
export function downloadFile(url, filename) {
  const token = localStorage.getItem('token')
  const sep = url.includes('?') ? '&' : '?'
  const fullUrl = `${api.defaults.baseURL}${url}${sep}token=${encodeURIComponent(token || '')}`

  const a = document.createElement('a')
  a.href = fullUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

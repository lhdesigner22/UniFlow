import { lazy } from 'react'

// Tela carregada só quando alguém abre (cada página vira um arquivo próprio no
// build — o app inicial fica bem menor). Depois de uma publicação, uma aba que
// ficou aberta pode pedir o arquivo de uma versão que não existe mais: aí
// recarrega a página UMA vez para pegar a versão nova, em vez de quebrar.
const KEY = 'uniflow-chunk-reload'

export function lazyPage(load) {
  return lazy(() => load().then(
    mod => { try { sessionStorage.removeItem(KEY) } catch { /* sem storage */ } return mod },
    err => {
      let tried = false
      try { tried = sessionStorage.getItem(KEY) === '1'; sessionStorage.setItem(KEY, '1') } catch { /* sem storage */ }
      if (!tried) { window.location.reload(); return new Promise(() => {}) }
      throw err
    },
  ))
}

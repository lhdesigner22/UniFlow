import { useEffect, useRef } from 'react'

// setInterval que só dispara enquanto a aba está visível (Page Visibility
// API) — evita gastar requisições com abas em segundo plano, o que importa
// bastante contra o limite de requests/dia do plano Free do Cloudflare
// Workers. Chama `fn` uma vez de imediato (no mount, e de novo sempre que a
// aba volta a ficar visível depois de ter passado tempo em background —
// senão o usuário voltaria pra aba e veria dado desatualizado até o próximo
// tick) e depois a cada `intervalMs` enquanto visível.
export function useVisiblePolling(fn, intervalMs) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let timer = null
    const tick = () => fnRef.current()
    const start = () => {
      if (timer) return
      tick()
      timer = setInterval(tick, intervalMs)
    }
    const stop = () => {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])
}

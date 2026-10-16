import { useEffect, useRef } from 'react'
import { subscribeLive } from '../services/live'

// Chama `fn` quando OUTRO aparelho alterar algum dos `resources` (ex:
// ['equipment-loans']) — e também quando a conexão em tempo real volta de uma
// queda. `fn` recebe o aviso ({ r, b }) e deve recarregar os dados SEM piscar
// a tela de "carregando" (recarga silenciosa). Sem `resources` (null), reage a
// qualquer alteração.
export function useLiveRefresh(resources, fn) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const key = resources ? resources.join(',') : '*'

  useEffect(() => subscribeLive(resources, msg => fnRef.current(msg)), [key])
}

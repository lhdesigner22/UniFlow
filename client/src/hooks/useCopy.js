import { useState, useRef, useEffect, useCallback } from 'react'

// "Copiar" com aviso: copy(chave, texto) copia e deixa `copied === chave` por 1,8 s
// (o botão troca o ícone para ✓). Uma chave por campo, ex.: `${id}:cnpj`.
export function useCopy() {
  const [copied, setCopied] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = useCallback(async (key, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(null), 1800)
      return true
    } catch {
      return false // área de transferência indisponível (navegador sem permissão)
    }
  }, [])
  return { copied, copy }
}

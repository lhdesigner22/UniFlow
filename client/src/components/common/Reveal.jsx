import { forwardRef, useEffect, useRef, useState } from 'react'

// Anima um bloco de conteúdo aparecendo (fade + leve subida) quando ele
// entra na tela ao rolar a página — mesmo estilo de scroll reveal usado em
// sites tipo inter.co. A cor de nada aqui muda, só o movimento: usa a
// classe global `.reveal`/`.reveal.is-visible` (ver index.css).
//
// `delay` (ms) escalona itens de uma lista/grid um pouco depois do
// anterior — ex: `<Reveal delay={i * 60}>` num `.map`. `once` (padrão true)
// para de observar depois do primeiro reveal, pra não re-animar toda vez
// que a pessoa rola pra cima e desce de novo.
//
// Encaminha `ref` (forwardRef) pro elemento real — precisa disso porque
// algumas telas (ex: BacklogPage) já usam um ref próprio no card pra fazer
// `scrollIntoView` quando um filtro é clicado; sem encaminhar, esse uso
// quebraria ao trocar o `<div>` por `<Reveal>`.
const Reveal = forwardRef(function Reveal(
  { children, as: Tag = 'div', delay = 0, once = true, className = '', style, ...rest },
  forwardedRef
) {
  const ownRef = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ownRef.current
    if (!el) return

    // Sem suporte a IntersectionObserver (ambiente raríssimo hoje em dia):
    // mostra direto, sem quebrar a página.
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            if (once) observer.unobserve(entry.target)
          } else if (!once) {
            setVisible(false)
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [once])

  // Um único nó de DOM, dois donos do ref: o nosso (pro IntersectionObserver)
  // e o que quem usa <Reveal> passou (ex: pra scrollIntoView).
  const setRefs = node => {
    ownRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }

  return (
    <Tag
      ref={setRefs}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={{ ...style, '--reveal-delay': `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  )
})

export default Reveal

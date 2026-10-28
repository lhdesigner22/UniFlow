// Props para um elemento que não é <button> mas age como um (linha clicável,
// texto que vira campo): entra no Tab, é anunciado como botão e responde a
// Enter/Espaço igual ao clique. Uso: <div {...pressable(() => abrir(x))}>
export function pressable(onActivate) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: e => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(e) }
    },
  }
}

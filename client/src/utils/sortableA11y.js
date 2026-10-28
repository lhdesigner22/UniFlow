// Arrastar-e-soltar acessível (dnd-kit): além do mouse, o puxador ⠿ aceita o
// teclado (Espaço pega, setas movem, Espaço solta, Esc cancela), e o leitor de
// tela anuncia em português o que está acontecendo.
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'

export function useSortableSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

// `items` = lista na ordem da tela; `nameOf(item)` = como chamar cada um.
export function sortableAccessibility(items, nameOf) {
  const name = id => { const it = items.find(i => i.id === id); return it ? nameOf(it) : 'item' }
  const pos = id => `posição ${items.findIndex(i => i.id === id) + 1} de ${items.length}`
  return {
    screenReaderInstructions: {
      draggable: 'Para reordenar, aperte Espaço para pegar, use as setas para mover, Espaço para soltar ou Esc para cancelar.',
    },
    announcements: {
      onDragStart: ({ active }) => `Pegou ${name(active.id)}, ${pos(active.id)}.`,
      onDragOver: ({ active, over }) => over ? `${name(active.id)} sobre a ${pos(over.id)}.` : `${name(active.id)} fora da lista.`,
      onDragEnd: ({ active, over }) => over ? `${name(active.id)} solto na ${pos(over.id)}.` : `${name(active.id)} solto.`,
      onDragCancel: ({ active }) => `Movimento cancelado. ${name(active.id)} voltou ao lugar.`,
    },
  }
}

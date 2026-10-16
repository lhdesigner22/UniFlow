// Identifica ESTA aba/aparelho. Vai em todo pedido (header X-Client-Id) e
// volta no aviso de tempo real, pra a própria aba ignorar o aviso da
// alteração que ela mesma fez (já está atualizada). Outra aba da mesma pessoa
// tem outro id, então recebe normalmente.
export const clientId =
  (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)

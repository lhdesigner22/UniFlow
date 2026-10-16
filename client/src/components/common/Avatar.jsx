import { useState } from 'react'
import { avatarColor } from '../../utils/avatarColor'

// Círculo com foto (Google) ou inicial do nome. Se a foto falhar ao
// carregar por qualquer motivo (bloqueio de extensão/ad-block, link
// expirado, rede) cai pra inicial em vez de mostrar um ícone de imagem
// quebrada — sem isso, um erro silencioso de carregamento deixava o
// avatar "vazio" mesmo com a URL certa salva no perfil.
export default function Avatar({ id, name, photo, size = 32, style }) {
  const [failed, setFailed] = useState(false)
  const showPhoto = photo && !failed

  return (
    <span
      className="avatar"
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.4, background: avatarColor(id), overflow: 'hidden', flexShrink: 0, ...style }}
    >
      {showPhoto
        ? (
          <img
            src={photo}
            alt={name}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )
        : (name?.charAt(0).toUpperCase() || '?')}
    </span>
  )
}

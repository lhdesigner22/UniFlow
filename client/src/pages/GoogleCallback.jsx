import { useEffect } from 'react'

export default function GoogleCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const idToken = params.get('id_token')
    const error = params.get('error')
    if (window.opener) {
      window.opener.postMessage(
        { type: 'google-oauth', idToken, error },
        window.location.origin,
      )
    }
    window.close()
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#555' }}>
      Autenticando...
    </div>
  )
}

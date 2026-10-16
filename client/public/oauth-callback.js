// OAuth callback: fecha o popup imediatamente sem esperar o bundle React.
// Em arquivo próprio (não inline) por causa da Content-Security-Policy.
if (window.location.pathname === '/auth/google/callback') {
  var p = new URLSearchParams(window.location.hash.slice(1))
  if (window.opener) {
    window.opener.postMessage(
      { type: 'google-oauth', idToken: p.get('id_token'), error: p.get('error') },
      window.location.origin
    )
  }
  window.close()
}

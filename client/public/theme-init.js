// Aplica o tema antes do React renderizar (evita flash). Fica em arquivo
// próprio, e não inline no index.html, para a Content-Security-Policy poder
// proibir scripts inline (ver public/_headers).
(function () {
  var t = 'dark'
  try { t = localStorage.getItem('uniflow-theme') || 'dark' } catch (e) { /* storage bloqueado */ }
  document.documentElement.setAttribute('data-theme', t)
})()

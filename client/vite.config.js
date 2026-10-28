import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' troca o service worker sozinho assim que uma nova
      // versão publicada é detectada — sem isso, alguém com o site aberto
      // continuaria vendo o JS/CSS antigo em cache até fechar a aba, o que
      // pegaria mal com a cadência de deploys frequentes deste projeto.
      registerType: 'autoUpdate',
      manifest: {
        name: 'UniFlow',
        short_name: 'UniFlow',
        description: 'Quadros, chamados, base de conhecimento e gestão de equipe do TI — Colégio SER / UniFECAF.',
        theme_color: '#3B82F6',
        background_color: '#0B1120',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Nunca deixa o service worker guardar em cache respostas de /api —
      // dados de quadros, chamados, notificações... precisam sempre vir da
      // rede fresquinhos. O precache abaixo cobre só os arquivos estáticos
      // do build (JS/CSS/HTML/ícones); nada em runtimeCaching aponta pra /api.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // As bibliotecas das planilhas (ExcelJS, ~900 KB) e da apresentação
        // (pptxgenjs, pdf-lib) só são baixadas quando
        // alguém exporta — não entram no pacote que todo aparelho pré-baixa.
        globIgnores: ['**/exceljs*', '**/pptxgen*', '**/pdf-lib*', '**/casesDeck*'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  // O pdf-lib (e o pako que vem com ele) sairia num pedaço chamado "index-*.js"
  // e entraria no pré-cache; com nome próprio o globIgnores acima o deixa de fora.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/](pdf-lib|@pdf-lib|pako)[\\/]/.test(id)) return 'pdf-lib'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // ws: o tempo real (/api/live/ws) também passa por aqui
      '/api': { target: 'http://localhost:3001', changeOrigin: true, ws: true }
    }
  }
})

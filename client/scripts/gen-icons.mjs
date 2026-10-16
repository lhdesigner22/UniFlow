// Gera os ícones do PWA (client/public/icon-*.png) a partir dos SVGs em
// icon-sources/. Rodar de novo só se o logo mudar: `npm i -D sharp` (não é
// dependência do projeto, só dessa ferramenta pontual) e `node scripts/gen-icons.mjs`.
import sharp from 'sharp'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const badge = readFileSync(path.join(dir, 'icon-sources/badge.svg'))
const fullbleed = readFileSync(path.join(dir, 'icon-sources/fullbleed.svg'))
const outDir = path.join(dir, '..', 'public')

const jobs = [
  { src: badge, size: 192, file: 'icon-192.png' },
  { src: badge, size: 512, file: 'icon-512.png' },
  { src: fullbleed, size: 512, file: 'icon-512-maskable.png' },
  { src: fullbleed, size: 180, file: 'apple-touch-icon.png' },
  { src: badge, size: 32, file: 'favicon-32.png' },
]

for (const { src, size, file } of jobs) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(path.join(outDir, file))
  console.log('wrote', file)
}

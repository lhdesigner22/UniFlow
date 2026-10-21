// Reduz uma foto no navegador antes de enviar (foto de celular tem 3–8 MB):
// devolve data URL JPEG com o lado maior em `max` px. Usado nas fotos dos
// Incidentes Laboratórios (grande ≈1600 px + miniatura ≈360 px).
export function resizeImage(file, { max = 1600, quality = 0.82, type = 'image/jpeg' } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('Escolha um arquivo de imagem.'))
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff' // PNG com transparência não fica preto no JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL(type, quality))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Não deu pra abrir a imagem "${file.name}" (formato HEIC do iPhone? tire a foto em JPG).`)) }
    img.src = url
  })
}

// Foto grande + miniatura, prontas pro POST /lab-incidents/:id/photos
export async function photoPair(file) {
  const [data, thumb] = await Promise.all([
    resizeImage(file, { max: 1600, quality: 0.82 }),
    resizeImage(file, { max: 360, quality: 0.7 }),
  ])
  return { data, thumb }
}

// Logo da UniFECAF em 3D (Three.js): as duas peças em "L" azuis extrudadas com
// chanfro e acabamento envernizado, o núcleo verde saltado à frente, um anel de
// luz e uma poeira fina no ar. O desenho vem do mesmo caminho SVG da versão 2D
// (viewBox 160 × 126, centro em 79,62). `createLogoScene` devolve `update(pose)`
// para o main.js chamar a cada quadro com a pose calculada da rolagem.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

const NAVY = 0x0b4f82
const GREEN = 0x1bb266
const CX = 79, CY = 62, UNIT = 1 / 40 // 160 px do logo ≈ 4 unidades da cena

// Peça em "L" (canto de cima/esquerda), no mesmo traçado do SVG, com y para cima.
function lShape() {
  const p = (x, y) => new THREE.Vector2((x - CX) * UNIT, (CY - y) * UNIT)
  const s = new THREE.Shape()
  s.moveTo(...p(24, 0).toArray())
  s.lineTo(...p(128, 0).toArray())
  s.lineTo(...p(108, 20).toArray())
  s.lineTo(...p(38, 20).toArray())
  s.lineTo(...p(38, 88).toArray())
  s.lineTo(...p(14, 112).toArray())
  s.lineTo(...p(14, 10).toArray())
  s.quadraticCurveTo(...p(14, 0).toArray(), ...p(24, 0).toArray())
  return s
}
function squareShape(size, r) {
  const h = size / 2, s = new THREE.Shape()
  s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r)
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h); s.lineTo(-h + r, h)
  s.quadraticCurveTo(-h, h, -h, h - r); s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h)
  return s
}

// Ruído de ±½ tom no fim da imagem: some com as "faixas" do degradê escuro
// (brilho do bloom e da névoa) que, em 8 bits, pareciam tela granulada.
const DitherShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() { vec4 c = texture2D(tDiffuse, vUv); c.rgb += (rnd(gl_FragCoord.xy) - 0.5) / 255.0; gl_FragColor = c; }`,
}

// Ponto de poeira redondo e com borda suave (o ponto padrão é um quadrado
// duro de 1–2 px, que cintilava como chiado ao girar)
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function createLogoScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.85
  renderer.setClearColor(0x01070d, 1) // azul fundo da marca, um tom abaixo do --night: o tone mapping clareia

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x01070d, 0.045)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.09 // só reflexo discreto; mais que isso estoura no bloom

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  camera.position.set(0, 0, 11)

  // luz: chave branca de cima, contraluz azul atrás, verde rente ao núcleo
  const key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(6, 5, 2.5) // de lado: de frente, a luz batia de chapa e desbotava a cor; scene.add(key)
  const rim = new THREE.DirectionalLight(0x4aa8ff, 2.2); rim.position.set(-4, 2, -6); scene.add(rim)
  const glow = new THREE.PointLight(GREEN, 1.4, 6, 1.6); glow.position.set(0, 0, 1.6); scene.add(glow)
  scene.add(new THREE.AmbientLight(0x1b3550, 0.6))

  const logo = new THREE.Group()
  scene.add(logo)
  const bevel = { bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 5, curveSegments: 18 }
  const navyMat = new THREE.MeshPhysicalMaterial({ color: NAVY, metalness: 0.35, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.22, dithering: true })
  const lGeo = new THREE.ExtrudeGeometry(lShape(), { depth: 0.42, ...bevel })
  lGeo.translate(0, 0, -0.21)
  const l1 = new THREE.Mesh(lGeo, navyMat)
  const l2 = new THREE.Mesh(lGeo, navyMat); l2.rotation.z = Math.PI
  logo.add(l1, l2)

  const greenMat = new THREE.MeshPhysicalMaterial({ color: GREEN, emissive: 0x0c6a3b, emissiveIntensity: 0.18, metalness: 0.1, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, dithering: true })
  const coreGeo = new THREE.ExtrudeGeometry(squareShape(44 * UNIT, 0.06), { depth: 0.62, ...bevel })
  coreGeo.translate(0, 0, -0.31)
  const core = new THREE.Mesh(coreGeo, greenMat)
  logo.add(core)

  // anel de luz (o brilho vem do bloom: material sem tone mapping, branco puro)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.55, 0.016, 12, 360),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  )
  const ringTrack = new THREE.Mesh(
    new THREE.TorusGeometry(2.55, 0.009, 8, 360),
    new THREE.MeshBasicMaterial({ color: 0x6c8cab, transparent: true, opacity: 0.28 }),
  )
  const ringGroup = new THREE.Group()
  ringGroup.add(ringTrack, ring)
  scene.add(ringGroup)

  // poeira no ar: pontos finos que dão profundidade quando a câmera passa
  const dustCount = 260
  const dustPos = new Float32Array(dustCount * 3)
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 22
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 14
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 12 - 2
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x9cc4ea, map: dotTexture(), size: 0.06, transparent: true, opacity: 0.5, depthWrite: false }))
  scene.add(dust)

  // O EffectComposer desenha num alvo próprio, sem o antialias do canvas: era
  // isso que deixava as bordas da logo e o anel serrilhados. samples: 4 = MSAA.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.35, 0.96)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  composer.addPass(new ShaderPass(DitherShader))

  function resize() {
    const w = window.innerWidth, h = window.innerHeight
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  // Quanto da tela a câmera enxerga na profundidade do logo (z = 0): o main.js
  // usa pra posicionar o logo de lado sem sair da tela em qualquer proporção.
  function viewSize() {
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z
    return { w: h * camera.aspect, h }
  }

  let lastFill = -1
  // pose = { x, y, scale, rotY, rotX, ringTilt, ringFill (0..1), coreOut (0..1), time, scroll }
  function update(pose) {
    logo.position.set(pose.x, pose.y, 0)
    logo.scale.setScalar(pose.scale)
    logo.rotation.set(pose.rotX, pose.rotY, 0)
    core.position.z = 0.12 + pose.coreOut * 0.55
    glow.position.set(pose.x, pose.y, 1.4 + pose.coreOut * 0.6)
    glow.intensity = 1.2 + pose.coreOut * 2.5

    ringGroup.position.set(pose.x, pose.y, -0.3)
    ringGroup.scale.setScalar(pose.scale)
    ringGroup.rotation.set(pose.ringTilt, pose.ringTilt * -0.6, 0)
    // o anel aceso "enche" com o progresso; o trilho fino fica sempre.
    // Recria a geometria só quando o arco muda de forma visível.
    const fill = Math.round(Math.max(0.002, pose.ringFill) * 400) / 400
    if (fill !== lastFill) {
      lastFill = fill
      ring.geometry.dispose()
      ring.geometry = new THREE.TorusGeometry(2.55, 0.016, 12, Math.max(8, Math.round(360 * fill)), fill * Math.PI * 2)
    }
    ring.rotation.z = Math.PI / 2

    dust.rotation.y = pose.time * 0.012 + pose.rotY * 0.05
    dust.position.y = pose.scroll * 0.35
    camera.position.x = pose.x * -0.08
    camera.lookAt(0, 0, 0)
    composer.render()
  }
  return { update, viewSize }
}

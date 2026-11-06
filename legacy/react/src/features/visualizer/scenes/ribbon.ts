import * as THREE from 'three'
import { NW, type Analysis } from '../analysis'
import { disposeObject, palSample, type SceneCtx, type VizScene } from './types'

const H = 52
const P = 160
const SP = 0.78

export function createRibbon(): VizScene {
  let root: THREE.Group
  let ctx: SceneCtx
  const ys = new Float32Array(H * P)
  const pos = new Float32Array(H * P * 3)
  const colors = new Float32Array(H * P * 3)
  let posA: THREE.BufferAttribute
  let colA: THREE.BufferAttribute
  const c = new THREE.Color()
  let acc = 0
  let t = 0
  let cam = 0

  return {
    init(cx) {
      ctx = cx
      root = new THREE.Group()
      const idx: number[] = []
      for (let r = 0; r < H; r++) for (let j = 0; j < P - 1; j++) idx.push(r * P + j, r * P + j + 1)
      const g = new THREE.BufferGeometry()
      posA = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)
      colA = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage)
      g.setAttribute('position', posA)
      g.setAttribute('color', colA)
      g.setIndex(idx)
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      const lines = new THREE.LineSegments(g, mat)
      lines.frustumCulled = false
      const mirror = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }))
      mirror.scale.y = -0.6
      mirror.position.y = -0.15
      mirror.frustumCulled = false
      root.add(lines, mirror)
      ctx.scene.add(root)
      ctx.rig.fov = 55
    },
    update(dt, a: Analysis, cx) {
      t += dt
      acc += dt
      const step = 1 / 32
      while (acc >= step) {
        acc -= step
        ys.copyWithin(P, 0, P * (H - 1))
        for (let j = 0; j < P; j++) {
          const x = j / (P - 1)
          const w = Math.pow(Math.sin(Math.PI * x), 0.8)
          const s = a.wave[Math.min(NW - 1, Math.floor(x * (NW - 1)))]
          ys[j] = s * 3.4 * w * (0.7 + a.energy * 0.8) + a.kick * 0.6 * w
        }
      }
      const hueShift = a.hue
      for (let r = 0; r < H; r++) {
        const rf = r / (H - 1)
        const z = 4 - r * SP
        const fade = Math.pow(1 - rf, 1.3) * (r === 0 ? 1.7 : 0.9)
        const sway = Math.sin(t * 0.6 + r * 0.12) * 0.6 * rf
        for (let j = 0; j < P; j++) {
          const i = (r * P + j) * 3
          const x01 = j / (P - 1)
          pos[i] = (x01 - 0.5) * 26 + sway
          pos[i + 1] = ys[r * P + j] + Math.sin(rf * 5 - t) * 0.25 * rf
          pos[i + 2] = z
          palSample(cx.pal, (x01 + hueShift * 2 + rf * 0.4) % 1, c)
          const br = fade * (0.55 + Math.min(1, Math.abs(ys[r * P + j]) / 3) * 0.9)
          colors[i] = c.r * br
          colors[i + 1] = c.g * br
          colors[i + 2] = c.b * br
        }
      }
      posA.needsUpdate = true
      colA.needsUpdate = true
      cam += dt * 0.12
      cx.rig.pos.set(Math.sin(cam) * 7, 6.2 + Math.sin(cam * 1.3) * 1.2 + a.bass * 1.2, 17)
      cx.rig.look.set(0, 0.5, -8)
    },
    dispose() {
      ctx.scene.remove(root)
      disposeObject(root)
    },
  }
}

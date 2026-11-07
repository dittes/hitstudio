import * as THREE from 'three'

import { disposeObject, palSample,                              } from './types.js'

const G = 25
const HALF = (G - 1) / 2
const MAXD = Math.hypot(HALF, HALF)

export function createBars()           {
  let root
  let ctx
  let mesh
  let key
  let fill
  const cur = new Float32Array(G * G)
  const dummy = new THREE.Object3D()
  const col = new THREE.Color()
  let t = 0
  let ang = 0

  return {
    init(c) {
      ctx = c
      root = new THREE.Group()
      mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.25 }),
        G * G,
      )
      mesh.frustumCulled = false
      for (let i = 0; i < G * G; i++) mesh.setColorAt(i, col.setRGB(1, 1, 1))
      const hemi = new THREE.HemisphereLight(0xffffff, 0x222244, 1.1)
      key = new THREE.DirectionalLight(0xffffff, 2.4)
      key.position.set(8, 20, 10)
      fill = new THREE.PointLight(0xffffff, 600, 60, 2)
      fill.position.set(0, 9, 0)
      root.add(mesh, hemi, key, fill)
      ctx.scene.add(root)
      ctx.rig.fov = 52
    },
    update(dt, a          , c) {
      t += dt
      for (let iz = 0; iz < G; iz++) {
        for (let ix = 0; ix < G; ix++) {
          const i = iz * G + ix
          const d = Math.hypot(ix - HALF, iz - HALF) / MAXD
          const b = a.bands[Math.min(63, Math.floor(Math.pow(d, 0.8) * 52))]
          let target = 0.25 + Math.pow(b, 1.25) * 10 * (0.55 + 0.45 * (1 - d))
          target += Math.max(0, Math.sin(d * 12 - t * 3.2)) * a.mid * 0.9 + a.kick * 2 * (1 - d)
          const k = 1 - Math.exp(-dt * (target > cur[i] ? 28 : 7))
          cur[i] += (target - cur[i]) * k
          const h = cur[i]
          dummy.position.set((ix - HALF) * 1.25, h / 2, (iz - HALF) * 1.25)
          dummy.scale.set(0.9, h, 0.9)
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)
          palSample(c.pal, Math.min(1, h / 9) * 0.9 + d * 0.1, col)
          col.multiplyScalar(0.6 + Math.min(1, h / 7) * 0.9)
          mesh.setColorAt(i, col)
        }
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      key.color.copy(c.pal.b)
      fill.color.copy(c.pal.a)
      fill.intensity = 500 + a.kick * 900
      ang += dt * (0.1 + a.energy * 0.12)
      const r = 27 - a.energy * 3
      c.rig.pos.set(Math.sin(ang) * r, 13 + Math.sin(ang * 0.7) * 3, Math.cos(ang) * r)
      c.rig.look.set(0, 2.2, 0)
    },
    dispose() {
      ctx.scene.remove(root)
      disposeObject(root)
    },
  }
}

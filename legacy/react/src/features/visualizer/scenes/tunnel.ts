import * as THREE from 'three'
import type { Analysis } from '../analysis'
import { disposeObject, ease, palCyc, type SceneCtx, type VizScene } from './types'

const N = 56
const LEN = 70
const STARS = 520

export function createTunnel(): VizScene {
  let root: THREE.Group
  let ctx: SceneCtx
  let mesh: THREE.InstancedMesh
  let stars: THREE.Points
  const zs = new Float32Array(N)
  const rs = new Float32Array(N)
  const hs = new Float32Array(N)
  const starPos = new Float32Array(STARS * 3)
  const starPolar = new Float32Array(STARS * 2)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const v = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const col = new THREE.Color()
  let t = 0
  let speed = 8
  let travel = 0
  let flash = 0

  return {
    init(c) {
      ctx = c
      root = new THREE.Group()
      mesh = new THREE.InstancedMesh(
        new THREE.TorusGeometry(1, 0.025, 6, 8),
        new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
        N,
      )
      mesh.frustumCulled = false
      for (let i = 0; i < N; i++) {
        zs[i] = -(i / N) * LEN
        rs[i] = 0.2
        hs[i] = i / N
        mesh.setColorAt(i, col.setRGB(1, 1, 1))
      }
      const g = new THREE.BufferGeometry()
      for (let i = 0; i < STARS; i++) {
        starPolar[i * 2] = Math.random() * Math.PI * 2
        starPolar[i * 2 + 1] = 2.5 + Math.random() * 9
        starPos[i * 3 + 2] = -Math.random() * LEN
      }
      g.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
      stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }))
      stars.frustumCulled = false
      root.add(mesh, stars)
      ctx.scene.add(root)
      ctx.rig.fov = 74
    },
    update(dt, a: Analysis, c) {
      t += dt
      speed = ease(speed, 6 + a.energy * 34 + a.kick * 16, 4, dt)
      travel += speed * dt
      flash = ease(flash, a.kick, 18, dt)
      for (let i = 0; i < N; i++) {
        zs[i] += speed * dt
        if (zs[i] > 1) {
          zs[i] -= LEN
          rs[i] = 0.1 + a.bass * 0.9
          hs[i] = a.hue + travel * 0.004
        }
        const z = zs[i]
        const near = 1 - Math.min(1, -z / LEN)
        const fade = Math.pow(near, 1.4) * (z > -2 ? Math.max(0, -z / 2 + 0.0) + 0.0 : 1)
        const rad = 3.4 * (1 + rs[i] * 0.55 + Math.sin(t * 0.6 + i * 0.3) * 0.04)
        e.set(0, 0, i * 0.21 + t * 0.15 + travel * 0.02)
        q.setFromEuler(e)
        v.set(Math.sin(t * 0.4 + i * 0.05) * 0.3 * (1 - near), Math.cos(t * 0.33 + i * 0.05) * 0.3 * (1 - near), z)
        sc.set(rad, rad, 1)
        m.compose(v, q, sc)
        mesh.setMatrixAt(i, m)
        palCyc(c.pal, hs[i] + i * 0.012, col)
        col.multiplyScalar(fade * (0.55 + rs[i] * 1.6 + flash * 1.6 + a.energy * 0.6))
        mesh.setColorAt(i, col)
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      for (let i = 0; i < STARS; i++) {
        let z = starPos[i * 3 + 2] + speed * dt * 1.6
        if (z > 1) z -= LEN
        starPos[i * 3 + 2] = z
        const ang = starPolar[i * 2] + t * 0.05
        starPos[i * 3] = Math.cos(ang) * starPolar[i * 2 + 1]
        starPos[i * 3 + 1] = Math.sin(ang) * starPolar[i * 2 + 1]
      }
      stars.geometry.attributes.position.needsUpdate = true
      palCyc(c.pal, a.hue + 0.5, (stars.material as THREE.PointsMaterial).color)
      ;(stars.material as THREE.PointsMaterial).size = 0.06 + flash * 0.08 + speed * 0.002
      c.rig.pos.set(Math.sin(t * 0.3) * 0.5, Math.cos(t * 0.23) * 0.4, 3)
      c.rig.look.set(Math.sin(t * 0.2) * 1.2, Math.cos(t * 0.17) * 0.8, -20)
      c.rig.fov = ease(c.rig.fov, 72 + flash * 10 + speed * 0.2, 6, dt)
    },
    dispose() {
      ctx.scene.remove(root)
      disposeObject(root)
    },
  }
}

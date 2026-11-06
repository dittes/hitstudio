import * as THREE from 'three'
import { NB, type Analysis } from '../analysis'
import { disposeObject, ease, type SceneCtx, type VizScene } from './types'

const W = 80
const D = 56
const VERT = /* glsl */ `
attribute float aH; uniform float uScale; varying float vH; varying float vFade;
void main(){
  vec3 p = position; p.y = aH * uScale; vH = aH;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vFade = 1.0 - smoothstep(14.0, 56.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const FRAG = /* glsl */ `
uniform vec3 ca; uniform vec3 cb; uniform vec3 cc; uniform vec3 cd; uniform float uMul; uniform float uBase;
varying float vH; varying float vFade;
void main(){
  float h = clamp(vH, 0.0, 1.2) / 1.2;
  vec3 c = h < .33 ? mix(ca, cb, h*3.) : h < .66 ? mix(cb, cc, (h-.33)*3.) : mix(cc, cd, (h-.66)*3.);
  gl_FragColor = vec4(c * (uBase + h * uMul) * vFade, 1.0);
}`

export function createTerrain(): VizScene {
  let root: THREE.Group
  let ctx: SceneCtx
  let heights: Float32Array
  let attr: THREE.BufferAttribute
  let acc = 0
  let smooth = new Float32Array(W)
  const uniforms = {
    uScale: { value: 8 }, uMul: { value: 1.6 }, uBase: { value: 0.1 },
    ca: { value: new THREE.Color() }, cb: { value: new THREE.Color() }, cc: { value: new THREE.Color() }, cd: { value: new THREE.Color() },
  }
  const wireU = { ...uniforms, uMul: { value: 2.2 }, uBase: { value: 0.35 } }
  let cx = 0

  return {
    init(c) {
      ctx = c
      root = new THREE.Group()
      const geo = new THREE.PlaneGeometry(46, 60, W - 1, D - 1)
      geo.rotateX(-Math.PI / 2)
      heights = new Float32Array(W * D)
      attr = new THREE.BufferAttribute(heights, 1)
      attr.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute('aH', attr)
      const solid = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...uniforms, uMul: { value: 0.35 }, uBase: { value: 0.03 } },
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }))
      const wire = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: wireU, wireframe: true,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      solid.frustumCulled = wire.frustumCulled = false
      wire.renderOrder = 1
      root.add(solid, wire)
      ctx.scene.add(root)
      ctx.rig.fov = 62
    },
    update(dt, a: Analysis, c) {
      const { pal, rig } = c
      for (const u of [uniforms, wireU]) {
        u.ca.value.copy(pal.a); u.cb.value.copy(pal.b); u.cc.value.copy(pal.c); u.cd.value.copy(pal.d)
      }
      acc += dt
      const step = 1 / 36
      while (acc >= step) {
        acc -= step
        heights.copyWithin(W, 0, W * (D - 1))
        for (let col = 0; col < W; col++) {
          const u = Math.abs(col - (W - 1) / 2) / ((W - 1) / 2)
          const f = Math.pow(u, 0.85) * (NB * 0.82)
          const i0 = Math.floor(f)
          const v = a.bands[i0] * (1 - (f - i0)) + a.bands[Math.min(NB - 1, i0 + 1)] * (f - i0)
          const target = Math.pow(v, 1.15) * (1 - 0.45 * u * u) + a.kick * 0.18 * (1 - u)
          smooth[col] += (target - smooth[col]) * 0.7
          heights[col] = smooth[col]
        }
        attr.needsUpdate = true
      }
      uniforms.uScale.value = ease(uniforms.uScale.value, 7 + a.bass * 3, 6, dt)
      wireU.uScale.value = uniforms.uScale.value
      cx += dt * 0.18
      rig.pos.set(Math.sin(cx) * 5, 5.2 + a.energy * 1.4 + Math.sin(cx * 0.7) * 0.8, 19)
      rig.look.set(Math.sin(cx * 0.8) * 2, 1.2, -12)
    },
    dispose() {
      ctx.scene.remove(root)
      disposeObject(root)
    },
  }
}

import * as THREE from 'three'
import type { Analysis } from '../analysis'
import { disposeObject, ease, type SceneCtx, type VizScene } from './types'

const N = 50000
const VERT = /* glsl */ `
attribute vec4 aSeed; uniform float uTime; uniform float uSwirl; uniform float uBass; uniform float uMid; uniform float uTreble; uniform float uKick; uniform float uPx;
varying float vR; varying float vSpark;
void main(){
  float r0 = pow(aSeed.x, 1.35);
  float arm = floor(aSeed.w * 3.0);
  float R = 9.0;
  float r = r0 * R;
  float ang = arm * 2.0944 + r0 * 6.5 + uSwirl / (0.35 + r0 * 1.4) + (aSeed.y - 0.5) * 0.55 * (1.0 - r0 * 0.5);
  r += sin(r * 1.6 - uTime * 2.2) * uMid * 0.55 + uBass * 0.5 * (1.0 - r0);
  r *= 1.0 + uKick * (0.25 + aSeed.w * 0.4) * (0.4 + r0);
  float y = (aSeed.z - 0.5) * (2.6 * (1.0 - r0 * 0.7) + 0.2) + sin(ang * 3.0 + uTime) * uMid * 0.3;
  vec3 p = vec3(cos(ang) * r, y, sin(ang) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sp = step(0.93, fract(aSeed.y * 91.7 + uTime * 0.7 * (0.5 + aSeed.z)));
  vSpark = sp * uTreble;
  gl_PointSize = (0.9 + aSeed.z * 1.6 + sp * uTreble * 3.0 + uKick * 1.2) * uPx * (12.0 / -mv.z);
  vR = r0;
}`
const FRAG = /* glsl */ `
uniform vec3 ca; uniform vec3 cb; uniform vec3 cc; uniform vec3 cd; varying float vR; varying float vSpark;
void main(){
  float d = length(gl_PointCoord - .5);
  float a = smoothstep(.5, .0, d);
  vec3 c = vR < .5 ? mix(cd, ca, vR * 2.) : vR < .8 ? mix(ca, cb, (vR - .5) / .3) : mix(cb, cc, (vR - .8) / .2);
  gl_FragColor = vec4((c * (0.45 + (1. - vR) * 0.8) + vSpark) * a * 0.9, 1.);
}`

export function createParticles(): VizScene {
  let root: THREE.Group
  let ctx: SceneCtx
  let t = 0
  let swirl = 0
  let ang = 0
  const U = {
    uTime: { value: 0 }, uSwirl: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 }, uKick: { value: 0 }, uPx: { value: 1 },
    ca: { value: new THREE.Color() }, cb: { value: new THREE.Color() }, cc: { value: new THREE.Color() }, cd: { value: new THREE.Color() },
  }
  return {
    init(c) {
      ctx = c
      root = new THREE.Group()
      const seed = new Float32Array(N * 4)
      for (let i = 0; i < N * 4; i++) seed[i] = Math.random()
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3))
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
      const pts = new THREE.Points(g, new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: U, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      pts.frustumCulled = false
      root.add(pts)
      ctx.scene.add(root)
      ctx.rig.fov = 55
    },
    update(dt, a: Analysis, c) {
      t += dt
      swirl += dt * (0.25 + a.mid * 2.4 + a.energy * 0.8)
      U.uTime.value = t
      U.uSwirl.value = swirl
      U.uBass.value = ease(U.uBass.value, a.bass, 16, dt)
      U.uMid.value = a.mid
      U.uTreble.value = a.treble
      U.uKick.value = a.kick
      U.uPx.value = c.px
      U.ca.value.copy(c.pal.a); U.cb.value.copy(c.pal.b); U.cc.value.copy(c.pal.c); U.cd.value.copy(c.pal.d)
      ang += dt * 0.07
      const dist = 16 - a.energy * 2.5 - a.kick * 1.2
      c.rig.pos.set(Math.sin(ang) * dist, 6.5 + Math.sin(ang * 1.7) * 2.5, Math.cos(ang) * dist)
      c.rig.look.set(0, 0, 0)
    },
    dispose() {
      ctx.scene.remove(root)
      disposeObject(root)
    },
  }
}

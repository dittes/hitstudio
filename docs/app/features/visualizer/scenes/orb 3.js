import * as THREE from 'three'
import { NOISE_GLSL, disposeObject, ease,                              } from './types.js'

const VERT = /* glsl */ `
uniform float uTime; uniform float uBass; uniform float uMid; uniform float uTreble; uniform float uKick; uniform float uBands[16];
varying vec3 vN; varying vec3 vV; varying float vD;
${NOISE_GLSL}
void main(){
  vec3 n = normalize(position);
  float m = abs(acos(clamp(n.y,-1.,1.)) / 3.14159265 - 0.5) * 2.0;
  float band = uBands[int(clamp(m, 0., .999) * 16.)];
  float d = snoise(n * 1.4 + vec3(0., uTime * .25, 0.)) * (0.12 + uMid * .32);
  d += snoise(n * 3.4 - vec3(uTime * .6, 0., 0.)) * (0.03 + uTreble * .14);
  d += uBass * .22 + uKick * .16 + band * .26 * (.55 + .45 * snoise(n * 2. + uTime * .2));
  vD = d;
  vec3 p = n * 1.6 * (1.0 + d);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vN = normalize(normalMatrix * n); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`
const FRAG = /* glsl */ `
uniform vec3 ca; uniform vec3 cb; uniform vec3 cc; uniform vec3 cd; uniform float uTime; uniform float uKick; uniform float uEnergy;
varying vec3 vN; varying vec3 vV; varying float vD;
void main(){
  float f = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.), 2.4);
  float k = .5 + .5 * sin(vD * 7. + uTime * .35);
  vec3 base = mix(ca, cb, k) * (0.12 + max(vD, 0.) * 1.8 + uEnergy * .5);
  vec3 rim = mix(cd, cc, k) * f * (1.5 + uKick * 1.4 + uEnergy);
  gl_FragColor = vec4(base + rim, 1.);
}`
const PVERT = /* glsl */ `
attribute vec4 aOrb; attribute vec2 aRnd; uniform float uTime; uniform float uBass; uniform float uKick; uniform float uTreble; uniform float uPx;
varying float vA; varying float vT;
void main(){
  float ang = aOrb.z + uTime * aOrb.y;
  float r = aOrb.x * (1.0 + uBass * .18 + uKick * .3);
  vec3 p = vec3(cos(ang) * r, 0., sin(ang) * r);
  float ct = cos(aOrb.w), st = sin(aOrb.w);
  p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
  float cy = cos(aRnd.x), sy = sin(aRnd.x);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aRnd.y * uPx * (1. + uTreble * 1.6 + uKick) * (7. / -mv.z);
  vA = .5 + .5 * sin(uTime * 2. + aOrb.z * 5.); vT = aOrb.x / 4.5;
}`
const PFRAG = /* glsl */ `
uniform vec3 ca; uniform vec3 cb; varying float vA; varying float vT;
void main(){
  float d = length(gl_PointCoord - .5);
  float a = smoothstep(.5, 0., d);
  gl_FragColor = vec4(mix(ca, cb, vT) * a * (.5 + vA), 1.);
}`

export function createOrb()           {
  let root
  let ctx
  let t = 0
  let rot = 0
  let scl = 1
  const bands = new Float32Array(16)
  const U = {
    uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 }, uKick: { value: 0 }, uEnergy: { value: 0 },
    uBands: { value: bands },
    ca: { value: new THREE.Color() }, cb: { value: new THREE.Color() }, cc: { value: new THREE.Color() }, cd: { value: new THREE.Color() },
  }
  const PU = { uTime: U.uTime, uBass: U.uBass, uKick: U.uKick, uTreble: U.uTreble, uPx: { value: 1 }, ca: { value: new THREE.Color() }, cb: { value: new THREE.Color() } }
  let particles

  return {
    init(c) {
      ctx = c
      root = new THREE.Group()
      const sphere = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 28),
        new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: U }),
      )
      sphere.frustumCulled = false
      const N = 7000
      const pos = new Float32Array(N * 3)
      const orb = new Float32Array(N * 4)
      const rnd = new Float32Array(N * 2)
      for (let i = 0; i < N; i++) {
        orb[i * 4] = 2.4 + Math.pow(Math.random(), 1.6) * 2.4
        orb[i * 4 + 1] = (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.45) / Math.sqrt(orb[i * 4])
        orb[i * 4 + 2] = Math.random() * Math.PI * 2
        orb[i * 4 + 3] = (Math.random() - 0.5) * 1.6
        rnd[i * 2] = Math.random() * Math.PI * 2
        rnd[i * 2 + 1] = 2 + Math.random() * 5
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      g.setAttribute('aOrb', new THREE.BufferAttribute(orb, 4))
      g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 2))
      particles = new THREE.Points(g, new THREE.ShaderMaterial({
        vertexShader: PVERT, fragmentShader: PFRAG, uniforms: PU,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      particles.frustumCulled = false
      root.add(sphere, particles)
      ctx.scene.add(root)
      ctx.rig.fov = 50
    },
    update(dt, a          , c) {
      t += dt * (0.6 + a.energy * 1.2)
      U.uTime.value = t
      U.uBass.value = ease(U.uBass.value, a.bass, 20, dt)
      U.uMid.value = a.mid
      U.uTreble.value = a.treble
      U.uKick.value = a.kick
      U.uEnergy.value = a.energy
      for (let i = 0; i < 16; i++) {
        let s = 0
        for (let k = 0; k < 4; k++) s += a.bands[i * 4 + k]
        bands[i] = s / 4
      }
      for (const u of [U, PU]) {
        u.ca.value.copy(c.pal.a); u.cb.value.copy(c.pal.b)
      }
      U.cc.value.copy(c.pal.c); U.cd.value.copy(c.pal.d)
      PU.uPx.value = c.px
      rot += dt * (0.12 + a.mid * 0.5)
      root.rotation.y = rot
      root.rotation.x = Math.sin(t * 0.2) * 0.2
      scl = ease(scl, 1 + a.kick * 0.08, 14, dt)
      root.scale.setScalar(scl)
      c.rig.pos.set(Math.sin(t * 0.15) * 1.2, 0.8 + Math.sin(t * 0.1), 7.2 - a.energy * 0.6)
      c.rig.look.set(0, 0, 0)
    },
    dispose() {
      ctx.scene.remove(root)
      disposeObject(root)
    },
  }
}

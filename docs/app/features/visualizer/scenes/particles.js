import * as THREE from 'three'

import { disposeObject, ease } from './types.js'

// "Galaxy": a face-on-ish grand-design spiral, built like the real thing.
//   bulge  – dense, warm, flattened core of old stars
//   disk   – exponential disk of old stars, brighter along the arms
//   arms   – two logarithmic spiral arms (≈14° pitch) plus fainter spurs
//   young  – blue-white stars hugging the arms
//   knots  – pink star-forming regions (HII) in small clumps along the arms
//   halo   – a sparse sphere of faint old stars
//   dust   – dark lanes on the inner edge of each arm (normal blending, drawn on top)
// The arm pattern rotates rigidly (a density wave), so it never winds itself into rings.
// Audio: bass lights the core, mids send a brightness wave out along the arms,
// treble makes young stars twinkle, kicks pulse star size.

const R = 10 // disk radius in scene units
const PITCH = 1 / Math.tan((20 * Math.PI) / 180) // log-spiral winding (≈1 turn from bulge to rim)
const R0 = 0.9 // radius where the arms start
const COUNTS = { bulge: 20000, disk: 34000, arm: 30000, young: 9000, knot: 7000, halo: 3500 }
const DUST = 24000
const TYPE = { bulge: 0, disk: 1, arm: 2, young: 3, knot: 4, halo: 5 }

function gauss() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
/** exponential falloff, resampled (not clamped) so no stars pile up into a ring at the rim */
function expRadius(scale, max) {
  for (;;) { const r = -Math.log(1 - Math.random() * 0.999) * scale; if (r < max) return r }
}
/** angle of arm k (0 or 1) at radius r */
const armAngle = (k, r) => k * Math.PI + PITCH * Math.log(Math.max(r, R0) / R0)

function buildStars() {
  const total = Object.values(COUNTS).reduce((a, b) => a + b, 0)
  const pos = new Float32Array(total * 3), info = new Float32Array(total * 4) // type, radius/R, random, arm-closeness
  let n = 0
  const put = (x, y, z, type, close = 0) => {
    pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z
    info[n * 4] = type; info[n * 4 + 1] = Math.hypot(x, z) / R; info[n * 4 + 2] = Math.random(); info[n * 4 + 3] = close
    n++
  }
  // bulge: flattened ellipsoid, steep falloff
  for (let i = 0; i < COUNTS.bulge; i++) {
    const r = expRadius(0.55, 3.2), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1)
    put(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.55, r * Math.sin(ph) * Math.sin(th), TYPE.bulge)
  }
  // disk: exponential, a third of it concentrated toward the arms
  for (let i = 0; i < COUNTS.disk; i++) {
    const r = 0.6 + expRadius(2.6, R - 0.6)
    let th = Math.random() * Math.PI * 2, close = 0
    if (Math.random() < 0.45) { const k = Math.random() < 0.5 ? 0 : 1, d = gauss() * 0.6; th = armAngle(k, r) + d; close = Math.exp(-d * d * 3) }
    put(r * Math.cos(th), gauss() * (0.12 + r * 0.012), r * Math.sin(th), TYPE.disk, close)
  }
  // arms: tight around the spiral, with a few spurs branching off
  for (let i = 0; i < COUNTS.arm; i++) {
    const r = R0 + expRadius(4.5, R - R0), k = Math.random() < 0.5 ? 0 : 1
    const spread = 0.24 + r * 0.035, d = gauss() * spread
    let th = armAngle(k, r) + d
    if (Math.random() < 0.12) th += 0.55 + (r / R) * 0.5 // spur
    put(r * Math.cos(th), gauss() * 0.07, r * Math.sin(th), TYPE.arm, Math.exp(-((d / spread) ** 2) * 0.5))
  }
  // young blue stars on the leading edge of the arms
  for (let i = 0; i < COUNTS.young; i++) {
    const r = 1.6 + expRadius(3.2, R - 1.6), k = Math.random() < 0.5 ? 0 : 1
    const th = armAngle(k, r) + 0.06 + gauss() * (0.09 + r * 0.01)
    put(r * Math.cos(th), gauss() * 0.05, r * Math.sin(th), TYPE.young, 1)
  }
  // pink star-forming knots: small clumps strung along the arms
  const clumps = 140
  for (let c = 0, made = 0; c < clumps; c++) {
    const r = 2 + Math.random() * (R - 3), k = c % 2, th0 = armAngle(k, r) + 0.08 + gauss() * 0.06
    const size = 0.08 + Math.random() * 0.22, members = c === clumps - 1 ? COUNTS.knot - made : Math.round(COUNTS.knot / clumps)
    for (let j = 0; j < members; j++, made++) {
      const x = r * Math.cos(th0) + gauss() * size, z = r * Math.sin(th0) + gauss() * size
      put(x, gauss() * 0.04, z, TYPE.knot, 1)
    }
  }
  // halo
  for (let i = 0; i < COUNTS.halo; i++) {
    const r = 2 + expRadius(4, 15), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1)
    put(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.7, r * Math.sin(ph) * Math.sin(th), TYPE.halo)
  }
  return { pos, info }
}

function buildDust() {
  const pos = new Float32Array(DUST * 3), info = new Float32Array(DUST * 2)
  for (let i = 0; i < DUST; i++) {
    const r = 1.7 + expRadius(3.6, R - 2.1), k = Math.random() < 0.5 ? 0 : 1
    const th = armAngle(k, r) - 0.22 - Math.abs(gauss()) * 0.08 + gauss() * 0.04 // trailing (inner) edge
    pos[i * 3] = r * Math.cos(th); pos[i * 3 + 1] = gauss() * 0.04; pos[i * 3 + 2] = r * Math.sin(th)
    info[i * 2] = r / R; info[i * 2 + 1] = Math.random()
  }
  return { pos, info }
}

const STAR_VERT = /* glsl */ `
attribute vec4 aInfo;
uniform float uTime; uniform float uBass; uniform float uMid; uniform float uTreble; uniform float uKick; uniform float uPx;
uniform vec3 ca; uniform vec3 cb; uniform vec3 cc; uniform vec3 cd;
varying vec3 vCol; varying float vA;
void main(){
  float type = aInfo.x, r = aInfo.y, rnd = aInfo.z, close = aInfo.w;
  vec3 warm = vec3(1.0, 0.86, 0.66), white = vec3(1.0, 0.95, 0.9), blue = vec3(0.62, 0.76, 1.0), pink = vec3(1.0, 0.42, 0.62);
  vec3 col; float a; float size;
  // a brightness wave that travels outward along the arms on mids
  float wave = uMid * smoothstep(0.75, 1.0, sin((r * 9.0 - uTime * 2.4) ) * 0.5 + 0.5);
  if (type < 0.5) {            // bulge
    col = mix(warm, mix(warm, cd, 0.25), rnd); a = 0.10 + uBass * 0.10; size = 1.0 + rnd * 0.8;
  } else if (type < 1.5) {     // disk
    col = mix(mix(white, warm, 0.5), mix(white, ca, 0.35), close); a = (0.16 + close * 0.14) * (1.0 - r * 0.5) + wave * close * 0.15; size = 1.6 + rnd * 1.4;
  } else if (type < 2.5) {     // arm
    col = mix(mix(white, blue, 0.4), ca, 0.35); a = ((0.22 + close * 0.26) * (1.05 - r * 0.4) + wave * 0.35) * smoothstep(0.06, 0.3, r); size = 1.7 + rnd * 1.6;
  } else if (type < 3.5) {     // young blue
    float tw = step(0.86, fract(rnd * 53.0 + uTime * (0.4 + rnd)));
    col = mix(blue, cc, 0.3); a = 0.45 + tw * uTreble * 1.4 + wave * 0.4; size = 1.8 + rnd * 1.8 + tw * uTreble * 3.0;
  } else if (type < 4.5) {     // HII knots
    col = mix(pink, cb, 0.45); a = 0.34 + wave * 0.5 + uTreble * 0.15; size = 2.0 + rnd * 1.8;
  } else {                     // halo
    col = warm; a = 0.10 + rnd * 0.08; size = 0.8 + rnd * 0.6;
  }
  size *= 1.0 + uKick * 0.35;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPx * (12.0 / -mv.z);
  vCol = col; vA = a;
}`
const STAR_FRAG = /* glsl */ `
varying vec3 vCol; varying float vA;
void main(){
  vec2 q = gl_PointCoord - 0.5; float d2 = dot(q, q);
  float a = exp(-d2 * 18.0);
  gl_FragColor = vec4(vCol * vA * a, 1.0);
}`
const DUST_VERT = /* glsl */ `
attribute vec2 aInfo; uniform float uPx; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (4.0 + aInfo.y * 4.0) * uPx * (12.0 / -mv.z);
  vA = 0.28 * (1.0 - aInfo.x * 0.6) * smoothstep(0.17, 0.32, aInfo.x);
}`
const DUST_FRAG = /* glsl */ `
varying float vA;
void main(){
  vec2 q = gl_PointCoord - 0.5; float a = exp(-dot(q, q) * 10.0) * vA;
  gl_FragColor = vec4(0.05, 0.025, 0.03, a);
}`

export function createParticles() {
  let root, galaxy, ctx, core, coreMaterial, coreTexture
  let t = 0, spin = 0, orbit = 0
  const U = {
    uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 }, uKick: { value: 0 }, uPx: { value: 1 },
    ca: { value: new THREE.Color() }, cb: { value: new THREE.Color() }, cc: { value: new THREE.Color() }, cd: { value: new THREE.Color() },
  }
  return {
    init(c) {
      ctx = c
      root = new THREE.Group()
      galaxy = new THREE.Group()
      galaxy.rotation.x = 0.32 // a gentle tilt so the disk reads as a disk
      galaxy.rotation.z = -0.18

      const s = buildStars(), sg = new THREE.BufferGeometry()
      sg.setAttribute('position', new THREE.BufferAttribute(s.pos, 3))
      sg.setAttribute('aInfo', new THREE.BufferAttribute(s.info, 4))
      const stars = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: U, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      stars.frustumCulled = false
      galaxy.add(stars)

      const d = buildDust(), dg = new THREE.BufferGeometry()
      dg.setAttribute('position', new THREE.BufferAttribute(d.pos, 3))
      dg.setAttribute('aInfo', new THREE.BufferAttribute(d.info, 2))
      const dust = new THREE.Points(dg, new THREE.ShaderMaterial({ vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, uniforms: { uPx: U.uPx }, transparent: true, blending: THREE.NormalBlending, depthWrite: false }))
      dust.frustumCulled = false
      dust.renderOrder = 2
      galaxy.add(dust)

      // soft core glow: warm and small, so the centre never blows out to a white disc
      const glow = document.createElement('canvas'); glow.width = glow.height = 128
      const paint = glow.getContext('2d'), gr = paint.createRadialGradient(64, 64, 0, 64, 64, 64)
      gr.addColorStop(0, '#fff6e2'); gr.addColorStop(0.1, '#ffe0b0c0'); gr.addColorStop(0.35, '#ffb98040'); gr.addColorStop(1, '#ff9a6000')
      paint.fillStyle = gr; paint.fillRect(0, 0, 128, 128)
      coreTexture = new THREE.CanvasTexture(glow)
      coreMaterial = new THREE.SpriteMaterial({ map: coreTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 })
      core = new THREE.Sprite(coreMaterial)
      core.scale.set(3.6, 3.6, 1)
      galaxy.add(core)

      root.add(galaxy)
      ctx.scene.add(root)
      ctx.rig.fov = 50
    },
    update(dt, a, c) {
      t += dt
      spin += dt * (0.045 + a.energy * 0.05) // rigid pattern rotation
      galaxy.rotation.y = -spin
      U.uTime.value = t
      U.uBass.value = ease(U.uBass.value, a.bass, 10, dt)
      U.uMid.value = ease(U.uMid.value, a.mid, 12, dt)
      U.uTreble.value = a.treble
      U.uKick.value = ease(U.uKick.value, a.kick, 18, dt)
      U.uPx.value = c.px
      U.ca.value.copy(c.pal.a); U.cb.value.copy(c.pal.b); U.cc.value.copy(c.pal.c); U.cd.value.copy(c.pal.d)
      core.scale.setScalar(3.4 + U.uBass.value * 1.6 + U.uKick.value * 0.5)
      coreMaterial.opacity = 0.45 + U.uBass.value * 0.3
      // slow drift around the galaxy, gently closer on loud passages
      orbit += dt * 0.025
      const dist = 17 - a.energy * 2 - U.uKick.value * 0.8
      c.rig.pos.set(Math.sin(orbit) * dist * 0.35, 9 + Math.sin(orbit * 0.7) * 2.5, Math.cos(orbit) * dist)
      c.rig.look.set(0, -0.5, 0)
    },
    dispose() {
      ctx.scene.remove(root)
      disposeObject(root)
      coreTexture?.dispose()
    },
  }
}

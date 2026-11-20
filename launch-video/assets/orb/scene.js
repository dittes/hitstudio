// Copied verbatim from HitStudio app/features/visualizer/scenes/{types,orb}.js and ambient-particles.js; only the 'three' import is pointed at the CDN.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.187.0/+esm'
export function disposeObject(root                ) {
  root.traverse((o) => {
    const m = o
    m.geometry?.dispose()
    const mat = m.material
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose()
    if ((o                       ).isInstancedMesh) (o                       ).dispose()
  })
}

export const ease = (cur        , target        , rate        , dt        ) => cur + (target - cur) * (1 - Math.exp(-dt * rate))

/** Ashima simplex noise 3D */
export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`

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
const hash=n=>{const x=Math.sin(n*127.1)*43758.5453;return x-Math.floor(x)};
export function drawAmbientParticles(g,w,h,t,a,colors){
 g.save();g.globalCompositeOperation='screen';const count=w<600?550:1300;
 for(let i=0;i<count;i++){const depth=.3+hash(i+700)*.7,x=(hash(i+1)*w+t*(1+depth*4))%w,y=(hash(i+301)*h+Math.sin(t*.16+i)*6*depth+h)%h;g.fillStyle=colors[i%4];g.globalAlpha=(.09+hash(i+811)*.2+a.treble*.15)*depth;const size=(.5+hash(i+199)*1.2+a.kick*.3)*depth;g.fillRect(x,y,size,size)}g.restore();
}
export function createAmbientParticles(scene){
 const n=3600,positions=new Float32Array(n*3);for(let i=0;i<n;i++){positions[i*3]=(hash(i+1)-.5)*80;positions[i*3+1]=(hash(i+900)-.5)*50;positions[i*3+2]=(hash(i+1500)-.5)*80}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const uniforms={uTime:{value:0},uEnergy:{value:0},uPx:{value:1},ca:{value:new THREE.Color()},cb:{value:new THREE.Color()}};
 const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,vertexShader:'uniform float uTime,uEnergy,uPx;varying float seed;void main(){vec3 p=position;p.y+=sin(uTime*.18+p.x)*.7;seed=fract(sin(position.x*19.1+position.z)*1437.5);vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((.8+seed*1.8+uEnergy)*uPx*20./max(5.,-mv.z),.6,4.);}',fragmentShader:'uniform vec3 ca,cb;varying float seed;void main(){float d=length(gl_PointCoord-.5);float glow=smoothstep(.5,0.,d);gl_FragColor=vec4(mix(ca,cb,seed)*glow*(.35+seed*.5),glow*.6);}'});
 const points=new THREE.Points(geometry,material);points.frustumCulled=false;scene.add(points);
 return{update(dt,a,c,visible){points.visible=visible;uniforms.uTime.value+=dt;uniforms.uEnergy.value=a.treble;uniforms.uPx.value=c.px;uniforms.ca.value.copy(c.pal.a);uniforms.cb.value.copy(c.pal.c);points.rotation.y+=dt*.008},dispose(){scene.remove(points);geometry.dispose();material.dispose()}};
}

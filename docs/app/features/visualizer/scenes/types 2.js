import * as THREE from 'three'

export const PALETTES                                                                                            = {
  bloom: { label: 'HitStudio', colors: ['#a78bfa', '#f472b6', '#fb923c', '#38bdf8'], chip: 'linear-gradient(135deg,#a78bfa,#f472b6,#fb923c)' },
  neon: { label: 'Neon', colors: ['#00ffd5', '#ff2bd6', '#7cff3a', '#2b6bff'], chip: 'linear-gradient(135deg,#00ffd5,#ff2bd6,#7cff3a)' },
  sunset: { label: 'Sunset', colors: ['#7b2ff7', '#ff5e62', '#ff9966', '#ffd166'], chip: 'linear-gradient(135deg,#7b2ff7,#ff5e62,#ffd166)' },
  ocean: { label: 'Ocean', colors: ['#6366f1', '#0ea5e9', '#22d3ee', '#2dd4bf'], chip: 'linear-gradient(135deg,#6366f1,#0ea5e9,#2dd4bf)' },
  mono: { label: 'Mono', colors: ['#6b6b80', '#a6a6b8', '#e8e8f5', '#ffffff'], chip: 'linear-gradient(135deg,#6b6b80,#e8e8f5,#ffffff)' },
}

/** gradient a→b→c→d, t clamped 0..1 */
export function palSample(p         , t        , out             )              {
  t = Math.min(1, Math.max(0, t)) * 3
  if (t < 1) return out.copy(p.a).lerp(p.b, t)
  if (t < 2) return out.copy(p.b).lerp(p.c, t - 1)
  return out.copy(p.c).lerp(p.d, t - 2)
}
/** cyclic gradient a→b→c→d→a, t any real */
export function palCyc(p         , t        , out             )              {
  t = (((t % 1) + 1) % 1) * 4
  const i = Math.floor(t)
  const f = t - i
  const arr = [p.a, p.b, p.c, p.d]
  return out.copy(arr[i]).lerp(arr[(i + 1) % 4], f)
}

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

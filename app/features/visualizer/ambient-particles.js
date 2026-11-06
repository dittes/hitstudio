import * as THREE from 'three';
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

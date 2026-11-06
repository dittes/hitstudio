import * as THREE from 'three';
import {drawExtraScene} from '../extra-scenes.js';
/** GPU composition of the same original effects available in Canvas mode. */
export function createExtraScene(id){
 let canvas,paint,texture,mesh,scene,time=0;const state={};
 return{init(c){scene=c.scene;canvas=document.createElement('canvas');paint=canvas.getContext('2d',{alpha:false});texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({uniforms:{map:{value:texture}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:'uniform sampler2D map;varying vec2 vUv;void main(){gl_FragColor=texture2D(map,vUv);}',depthTest:false,depthWrite:false}));mesh.frustumCulled=false;scene.add(mesh)},
 update(dt,a,c){time+=dt;const source=c.renderer.domElement,scale=Math.min(1,Math.sqrt(1_000_000/(source.width*source.height))),w=Math.max(2,Math.round(source.width*scale)),h=Math.max(2,Math.round(source.height*scale));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}drawExtraScene(paint,id,a,w,h,time,[c.pal.a,c.pal.b,c.pal.c,c.pal.d].map(x=>'#'+x.getHexString()),state,{...c.settings,plotBottom:(c.settings?.plotBottom||0)*h/Math.max(1,source.clientHeight)});texture.needsUpdate=true},
 dispose(){scene?.remove(mesh);mesh?.geometry.dispose();mesh?.material.dispose();texture?.dispose();canvas=null}};
}

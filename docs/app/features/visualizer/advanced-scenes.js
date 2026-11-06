import {spectralHistory} from './spectral-history.js';
import {SPECTRAL_BINS as B,DENSITY_LEVELS as L,MIN_DB,MAX_DB} from './spectral-model.js';
export const ADVANCED_SCENES=[
 {id:'spectrogram',name:'Spectrogram',analysis:true},
 {id:'waterfall',name:'Frequency waterfall',analysis:true},
 {id:'density',name:'Phosphor density',analysis:true},
 {id:'flowfield',name:'Flow field'},
 {id:'warp',name:'Warp drive'},
 {id:'rose',name:'Laser rosette'},
 {id:'helix',name:'Light helix'},
 {id:'cymatic',name:'Cymatic bloom'},
];
export function heatColor(value,colors){if(value<=0)return [6,5,11];const stops=['#06050b',colors[0],colors[1],colors[2],'#fff9e8'];const t=Math.max(0,Math.min(1,value))*4,i=Math.min(3,Math.floor(t)),a=stops[i],b=stops[i+1],mix=t-i;return [1,3,5].map(k=>Math.round(parseInt(a.slice(k,k+2),16)*(1-mix)+parseInt(b.slice(k,k+2),16)*mix))}
function prepareHeat(state,colors){const key=colors.join();if(state.colorKey===key)return;state.colorKey=key;state.lut=Array.from({length:256},(_,i)=>heatColor(i/255,colors))}
function plotBox(w,h,settings){const bottom=settings.plotBottom||0,top=bottom?Math.max(w<500?172:132,h*.2):h*.16;return{x:Math.max(48,w*.075),y:top,w:w-Math.max(48,w*.075)-Math.max(22,w*.04),h:Math.max(70,h-top-(bottom||h*.12)-Math.min(65,h*.1))}}
function axes(g,p,vertical,history,seconds,w){g.save();const font=Math.max(11,Math.min(17,w/85));g.font=`${font}px system-ui`;g.lineWidth=1;g.fillStyle='#d9d6e8';g.strokeStyle='#ffffff16';
 for(const hz of [20,100,1000,10000,20000]){if(hz>history.maxHz)continue;const t=Math.log(hz/20)/Math.log(history.maxHz/20),label=hz>=1000?hz/1000+'k':String(hz);g.beginPath();if(vertical){const y=p.y+p.h*(1-t);g.moveTo(p.x,y);g.lineTo(p.x+p.w,y);g.textAlign='right';g.fillText(label,p.x-10,y+font*.3)}else{const x=p.x+p.w*t;g.moveTo(x,p.y);g.lineTo(x,p.y+p.h);g.textAlign='center';g.fillText(label,x,p.y+p.h+font*1.7)}g.stroke()}
 g.textAlign='left';g.fillStyle='#a9a3be';g.fillText('Frequency · Hz (log)',p.x,p.y-18);if(vertical){g.textAlign='center';for(let i=0;i<=4;i++)g.fillText(i===4?'now':`−${seconds*(1-i/4)}s`,p.x+p.w*i/4,p.y+p.h+font*1.7)}g.restore()}
function analysisScene(g,id,w,h,colors,state,settings){
 const history=spectralHistory(),seconds=Number(settings.spectralWindow)||12,p=plotBox(w,h,settings);prepareHeat(state,colors);const hash=`${id}:${history.revision}:${seconds}:${state.colorKey}`;
 if(!state.heat){state.heat=document.createElement('canvas');state.heatCtx=state.heat.getContext('2d')}
 if(hash!==state.heatHash){const cw=id==='density'?B:id==='waterfall'?B:360,ch=id==='density'?L:id==='waterfall'?360:B;state.heat.width=cw;state.heat.height=ch;const image=state.heatCtx.createImageData(cw,ch),indices=history.imageColumns(seconds,360);
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){let value=0;if(id==='density'){value=Math.min(1,Math.sqrt(history.density[x*L+L-1-y])*2.7)}else{const column=id==='waterfall'?indices[359-y]:indices[x],bin=id==='waterfall'?x:B-1-y;if(column>=0)value=history.frames[column*B+bin]}const rgb=state.lut[Math.round(Math.max(0,Math.min(1,value))*255)],k=(y*cw+x)*4;image.data[k]=rgb[0];image.data[k+1]=rgb[1];image.data[k+2]=rgb[2];image.data[k+3]=255}
  state.heatCtx.putImageData(image,0,0);state.heatHash=hash;
 }
 g.imageSmoothingEnabled=false;g.drawImage(state.heat,p.x,p.y,p.w,p.h);g.imageSmoothingEnabled=true;
 if(id==='spectrogram')axes(g,p,true,history,seconds,w);else{
  axes(g,p,false,history,seconds,w);g.font=`${Math.max(11,Math.min(17,w/85))}px system-ui`;g.fillStyle='#d9d6e8';g.textAlign='right';for(let i=0;i<=4;i++){const y=p.y+p.h*i/4;g.fillText(id==='density'?`${Math.round(MAX_DB+(MIN_DB-MAX_DB)*i/4)}`:i===0?'now':`−${seconds*i/4}s`,p.x-10,y+5)}
  if(id==='density'){for(const [values,color,alpha]of [[history.peaks,colors[2],.65],[history.current,'#fff9e8',.95]]){g.beginPath();for(let i=0;i<B;i++){const x=p.x+i/(B-1)*p.w,y=p.y+(1-values[i])*p.h;if(!i)g.moveTo(x,y);else g.lineTo(x,y)}g.strokeStyle=color;g.globalAlpha=alpha;g.lineWidth=1.4;g.stroke()}g.globalAlpha=1}
 }
 g.textAlign='left';g.fillStyle='#b5afc7';g.font=`${Math.max(10,Math.min(15,w/95))}px system-ui`;g.fillText(id==='density'?'FFT density · brighter = more frequent · white = live · colour = peak hold':`FFT level · ${MIN_DB} to ${MAX_DB} dB · brighter = stronger`,p.x,p.y+p.h+Math.min(62,h*.09));g.fillText(`${history.fftSize}-sample FFT · ${Math.round(history.sampleRate/history.fftSize*10)/10} Hz/bin`,p.x,p.y-40);
}
const fract=x=>x-Math.floor(x),hash=n=>fract(Math.sin(n*127.1)*43758.5453123);
export function drawAdvancedScene(g,id,a,w,h,t,colors,state,settings){
 g.save();g.globalAlpha=1;g.globalCompositeOperation='source-over';g.shadowBlur=0;g.fillStyle='#06050b';g.fillRect(0,0,w,h);const cx=w/2,cy=h/2,u=Math.min(w,h),c=i=>colors[((i%4)+4)%4];g.lineCap='round';g.lineJoin='round';
 if(['spectrogram','waterfall','density'].includes(id)){analysisScene(g,id,w,h,colors,state,settings);g.restore();return}
 const glow=g.createRadialGradient(cx,cy,0,cx,cy,Math.max(w,h)*.65);glow.addColorStop(0,c(0)+'22');glow.addColorStop(1,'#06050b');g.fillStyle=glow;g.fillRect(0,0,w,h);g.globalCompositeOperation='screen';
 if(id==='flowfield'){
  if(!state.trail){state.trail=document.createElement('canvas');state.trailCtx=state.trail.getContext('2d')}
  const tw=Math.max(2,Math.round(w)),th=Math.max(2,Math.round(h));if(state.trail.width!==tw||state.trail.height!==th){state.trail.width=tw;state.trail.height=th;state.particles=Array.from({length:1100},(_,i)=>({x:hash(i+1)*w,y:hash(i+503)*h}))}
  const p=state.trailCtx;p.globalCompositeOperation='source-over';p.fillStyle='#06050b0a';p.fillRect(0,0,w,h);p.globalCompositeOperation='screen';p.lineWidth=.8+u/1200;const dt=Math.min(.06,Math.max(0,t-(state.lastT??t)));for(let i=0;i<state.particles.length;i++){const q=state.particles[i],angle=Math.sin(q.x/w*8+t*.19)*2+Math.cos(q.y/h*7-t*.13)*2+Math.atan2(q.y-cy,q.x-cx)*.6,step=dt*(35+a.bass*150);const x=q.x+Math.cos(angle)*step,y=q.y+Math.sin(angle)*step;p.strokeStyle=c(i)+'aa';p.beginPath();p.moveTo(q.x,q.y);p.lineTo(x,y);p.stroke();q.x=(x+w)%w;q.y=(y+h)%h}state.lastT=t;g.drawImage(state.trail,0,0,w,h);
 }else if(id==='warp'){
  for(let i=0;i<1400;i++){const angle=hash(i+30)*Math.PI*2,z=fract(hash(i+800)-t*(.06+a.bass*.1)),r=u*.025/(.025+z),speed=(.012+a.bass*.04)/(z+.12);const x=Math.cos(angle)*r,y=Math.sin(angle)*r;g.strokeStyle=c(i);g.globalAlpha=(1-z)*.85;g.lineWidth=.6+(1-z)*2;g.beginPath();g.moveTo(cx+x,cy+y);g.lineTo(cx+x*(1+speed),cy+y*(1+speed));g.stroke()}
 }else if(id==='rose'){
  g.translate(cx,cy);g.rotate(t*.06);for(let trail=0;trail<9;trail++){g.beginPath();for(let i=0;i<=960;i++){const th=i/960*Math.PI*2,r=u*(.24+.07*Math.sin(th*7+t*.25+trail*.03))*(.55+.45*Math.cos(th*5+t*.12))+a.bands[i%64]*u*.06;const x=Math.cos(th+trail*.007)*r,y=Math.sin(th+trail*.007)*r;if(!i)g.moveTo(x,y);else g.lineTo(x,y)}g.strokeStyle=c(trail);g.globalAlpha=.2+(.7*(1-trail/9));g.shadowColor=c(trail);g.shadowBlur=trail===0?12:0;g.lineWidth=1.1+u/900;g.stroke()}
 }else if(id==='helix'){
  for(let i=0;i<150;i++){const z=i/149,phase=z*Math.PI*8+t*.65,spread=u*(.16+a.bass*.035),center=cx+Math.sin(z*6-t*.2)*u*.05,y=h*(.08+z*.84),x1=center+Math.sin(phase)*spread,x2=center-Math.sin(phase)*spread;g.globalAlpha=.2+(.5+.5*Math.cos(phase))*.55;g.strokeStyle=c(Math.floor(z*12));if(i%3===0){g.beginPath();g.moveTo(x1,y);g.lineTo(x2,y);g.lineWidth=1;g.stroke()}for(const[x,front]of [[x1,Math.cos(phase)],[x2,-Math.cos(phase)]]){g.fillStyle=c(Math.floor(z*12)+(front>0?0:1));g.beginPath();g.arc(x,y,Math.max(1,(2+front)*u/300+a.bands[i%64]*3),0,Math.PI*2);g.fill()}}
 }else if(id==='cymatic'){
  g.translate(cx,cy);g.rotate(t*.045);for(let i=0;i<12000;i++){const r=Math.sqrt(hash(i+400))*u*.42,angle=hash(i+2000)*Math.PI*2,x=Math.cos(angle)*r,y=Math.sin(angle)*r,m=4+Math.round(a.bass*3),n=3+Math.round(a.treble*4),value=Math.sin(x/u*Math.PI*m)*Math.sin(y/u*Math.PI*n)-Math.sin(y/u*Math.PI*m)*Math.sin(x/u*Math.PI*n);if(Math.abs(value)>.18+a.mid*.12)continue;g.fillStyle=c(Math.floor(r/u*16));g.globalAlpha=.25+(1-Math.min(1,Math.abs(value)*5))*.7;g.fillRect(x,y,1.7+u/700,1.7+u/700)}
 }
 g.restore();
}

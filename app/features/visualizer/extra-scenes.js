import {ADVANCED_SCENES,drawAdvancedScene} from './advanced-scenes.js';
export const EXTRA_SCENES=[...['spectrum','scope','kaleido','aurora'].map((id,i)=>({id,name:['Spectrum','Oscilloscope','Kaleidoscope','Aurora'][i]})),...ADVANCED_SCENES];
/** Original Canvas scenes, shared by the compatibility and GPU renderers. */
export function drawExtraScene(ctx,id,a,w,h,time,colors,state={},settings={}){
 if(state.id!==id){for(const key of Object.keys(state))delete state[key];state.id=id}
 if(ADVANCED_SCENES.some(s=>s.id===id)){drawAdvancedScene(ctx,id,a,w,h,time,colors,state,settings);return}
 const cx=w/2,cy=h/2,u=Math.min(w,h),color=i=>colors[((i%4)+4)%4];
 ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#06050b';ctx.fillRect(0,0,w,h);
 const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,Math.max(w,h)*.7);glow.addColorStop(0,color(0)+'25');glow.addColorStop(1,'#06050b');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
 ctx.lineJoin='round';ctx.lineCap='round';
 if(id==='spectrum'){
  const n=64,gap=w*.84/n,base=h*.72;
  for(let i=0;i<n;i++){const band=a.bands[Math.floor(Math.abs(i-31.5)/31.5*63)],v=(.025+band*.5+Math.sin(time*1.2+i*.1)*.006)*h,x=w*.08+i*gap;const grad=ctx.createLinearGradient(0,base-v,0,base);grad.addColorStop(0,color(2));grad.addColorStop(.5,color(1));grad.addColorStop(1,color(0));ctx.fillStyle=grad;ctx.shadowBlur=10;ctx.shadowColor=color(1);ctx.fillRect(x,base-v,gap*.65,v);ctx.shadowBlur=0;ctx.globalAlpha=.16;ctx.fillRect(x,base+7,gap*.65,v*.35);ctx.globalAlpha=1}
 }else if(id==='scope'){
  ctx.strokeStyle=color(0)+'18';ctx.lineWidth=1;for(let i=1;i<12;i++){ctx.beginPath();ctx.moveTo(i*w/12,0);ctx.lineTo(i*w/12,h);ctx.stroke()}for(let i=1;i<8;i++){ctx.beginPath();ctx.moveTo(0,i*h/8);ctx.lineTo(w,i*h/8);ctx.stroke()}
  for(let layer=4;layer>=0;layer--){ctx.beginPath();for(let i=0;i<512;i++){const x=w*(.07+i/511*.86),y=cy+a.wave[i]*h*.3+Math.sin(i*.022+time)*u*.035+(layer-2)*u*.012;if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.strokeStyle=color(layer);ctx.globalAlpha=layer===0?1:.2;ctx.lineWidth=layer===0?2.5:1.3;ctx.shadowColor=color(layer);ctx.shadowBlur=layer===0?15:0;ctx.stroke()}
 }else if(id==='kaleido'){
  ctx.translate(cx,cy);ctx.rotate(time*.08);ctx.globalCompositeOperation='screen';
  for(let petal=0;petal<12;petal++){ctx.save();ctx.rotate(petal*Math.PI/6);for(let ring=0;ring<7;ring++){ctx.beginPath();for(let j=0;j<=80;j++){const phase=j/80*Math.PI*2,r=u*(.08+ring*.035)+(a.bands[(j+ring*7)%64]||0)*u*.09;const x=Math.cos(phase)*r,y=Math.sin(phase*2+time*.3)*r*.35+u*(.04+ring*.013);if(!j)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.strokeStyle=color(ring+petal);ctx.globalAlpha=.12+ring*.045;ctx.lineWidth=1.2+a.kick;ctx.stroke()}ctx.restore()}
 }else if(id==='aurora'){
  ctx.globalCompositeOperation='screen';for(let layer=0;layer<9;layer++){ctx.beginPath();for(let j=0;j<=120;j++){const x=j/120*w,y=h*(.35+layer*.038)+Math.sin(j*.035+time*.3+layer*.25)*h*.13+Math.sin(j*.08-time*.4)*u*.035-a.bands[j%64]*u*.09;if(!j)ctx.moveTo(x,y);else ctx.lineTo(x,y)}ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();const gradient=ctx.createLinearGradient(0,h*.2,0,h);gradient.addColorStop(0,color(layer)+'00');gradient.addColorStop(.4,color(layer)+'50');gradient.addColorStop(1,color(layer)+'00');ctx.fillStyle=gradient;ctx.globalAlpha=.55;ctx.fill()}
  ctx.globalAlpha=.8;for(let i=0;i<380;i++){const x=((Math.sin(i*127.1)*43758.5453)%1+1)%1*w,y=((Math.sin(i*311.7)*17431.32)%1+1)%1*h*.7;ctx.fillStyle=color(i);ctx.fillRect(x,y,1+(i%3)*.4,1+(i%3)*.4)}
 }
 ctx.restore();
}

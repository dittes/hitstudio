import {paintAnalysisPreviews} from './features/visualizer/analysis-previews.js';
import {EXTRA_SCENES} from './features/visualizer/extra-scenes.js';
import {clearSpectralHistory,spectralHistory} from './features/visualizer/spectral-history.js';
import {showModal,closeModal} from './dialogs.js';
import {createExtraScene} from './features/visualizer/scenes/extra.js';
import { icon, escape } from './dom.js';
import { startCanvasVisualizer } from './features/visualizer/renderer2d.js';
import { startWebGLVisualizer } from './features/visualizer/renderer3d.js';
import { sampleAnalysis } from './features/visualizer/analysis.js';
import { PALETTES } from './features/visualizer/scenes/types.js';
import { createTerrain } from './features/visualizer/scenes/terrain.js';
import { createOrb } from './features/visualizer/scenes/orb.js';
import { createTunnel } from './features/visualizer/scenes/tunnel.js';
import { createParticles } from './features/visualizer/scenes/particles.js';
import { createRibbon } from './features/visualizer/scenes/ribbon.js';
import { createBars } from './features/visualizer/scenes/bars.js';
import { startVideoRecording, downloadBlob, videoExtension } from './features/visualizer/recorder.js';
import { toast } from './core/toast.js';
import * as music from './media.js';
export const SCENES=[{id:'terrain',name:'Terrain',make:createTerrain},{id:'orb',name:'Orb',make:createOrb},{id:'tunnel',name:'Tunnel',make:createTunnel},{id:'particles',name:'Galaxy',make:createParticles},{id:'ribbon',name:'Ribbon',make:createRibbon},{id:'bars',name:'Bars city',make:createBars},...EXTRA_SCENES.map(scene=>({...scene,make:()=>createExtraScene(scene.id)}))];
function stored(k,d){try{return JSON.parse(localStorage.getItem('bloom.viz.'+k))??d}catch{return d}}
export function mountVisualize(container, actions) {
  const settings={want:1,palette:stored('palette','bloom'),sens:Math.max(.4,Math.min(2.5,Number(stored('sens',1))||1)),auto:!!stored('auto',false),spectralWindow:[6,12,24].includes(Number(stored('spectralWindow',12)))?Number(stored('spectralWindow',12)):12};
  if(!PALETTES[settings.palette])settings.palette='bloom';
  let mode=stored('renderer','webgl'),release=()=>{},disposed=false,raf=0,lastCheck=0,lastSwitch=performance.now(),lastDrop=sampleAnalysis().dropCount,recorder=null,recordAt=0,capture=null,starting=false,lastActivity=performance.now();
  container.innerHTML=`<section class="viz controls-visible" aria-label="Music visualization">
    <canvas aria-label="Audio-reactive visualization"></canvas><div class="viz-fade"></div>
    <div class="viz-top"><div class="viz-title"><button class="ghost" data-action="welcome">HitStudio</button><span class="scene-name"></span><span class="badge viz-signal">Preview</span></div><div class="viz-actions">
      <button class="icon" data-action="add-songs" aria-label="Add songs" title="Add songs">${icon('folder')}</button>
      <button class="icon" data-action="library" aria-label="Song list" title="Song list">${icon('library')}</button>
      <button class="icon" data-action="record-video" aria-label="Record video" title="Record video">${icon('record')}</button>
      <button class="icon" data-action="immersive" aria-label="Enter immersive view" title="Immersive view">${icon('expand')}</button>
      <button class="icon" data-action="fullscreen" aria-label="Fullscreen" title="Fullscreen">${icon('expand')}</button>
    </div></div>
    <div class="viz-hint"></div>
    <div class="viz-dock"><div class="scene-browser"><span>Choose your scene</span><span>Scroll to explore →</span></div><div class="scene-list">${SCENES.map((s,i)=>`<button class="scene-card" data-scene="${i}" data-analysis="${!!s.analysis}" aria-label="${s.name} scene" aria-pressed="${i===settings.want}">${s.analysis?`<span class="scene-art"><canvas data-analysis-preview="${s.id}" aria-hidden="true"></canvas></span>`:`<span class="scene-art art-${s.id}"></span>`}<span>${s.name}</span></button>`).join('')}</div>
    <div class="viz-settings"><div class="palettes">${Object.entries(PALETTES).map(([id,p])=>`<button class="palette ${id===settings.palette?'active':''}" data-palette="${id}" style="background:${p.chip}" aria-label="${escape(p.label)} colors"></button>`).join('')}</div><label class="reactivity-control">Reactivity <input data-setting="sens" type="range" min="0.4" max="2.5" step="0.01" value="${settings.sens}" aria-label="Visual reactivity" /></label><label><input data-setting="auto" type="checkbox" ${settings.auto?'checked':''} /> Auto journey</label><select data-setting="renderer" aria-label="Visualization renderer"><option value="webgl">3D</option><option value="canvas">Compatibility</option></select></div><div class="spectral-controls" hidden><label class="spectral-window">Time window <select data-setting="spectralWindow" aria-label="Spectrogram time window">${[6,12,24].map(n=>`<option value="${n}" ${n===settings.spectralWindow?'selected':''}>${n} seconds</option>`).join('')}</select></label><span>Measured audio · log frequency · −100 to −10 dB</span><button data-clear-spectrum>Clear history</button></div><div class="viz-mode"></div></div>
  </section>`;
  const root=container.firstElementChild, hint=root.querySelector('.viz-hint'),signal=root.querySelector('.viz-signal');
  const persist=(k,v)=>{try{localStorage.setItem('bloom.viz.'+k,JSON.stringify(v))}catch{}};
  const app=document.querySelector('#app'),activity=new AbortController();
  const poke=()=>{lastActivity=performance.now();root.classList.add('controls-visible');app.classList.remove('immersive-idle')};
  for(const event of ['pointermove','pointerdown','focusin','keydown'])window.addEventListener(event,poke,{signal:activity.signal,passive:true});
  function idle(now){if(app.classList.contains('immersive')&&now-lastActivity>=3000&&!document.querySelector('dialog[open]')){root.classList.remove('controls-visible');app.classList.add('immersive-idle')}}
  function startRenderer(next){
    release();mode=next==='canvas'?'canvas':'webgl';persist('renderer',mode);
    const old=root.querySelector('canvas'),canvas=document.createElement('canvas');canvas.setAttribute('aria-label',`${SCENES[settings.want].name} audio visualization`);old.replaceWith(canvas);
    root.querySelector('.viz-fade').style.opacity='0';root.querySelector('[data-setting=renderer]').value=mode;
    root.querySelector('.viz-mode').textContent=mode==='canvas'?'Compatibility renderer · no graphics acceleration required':'3D renderer';
    if(mode==='canvas')release=startCanvasVisualizer(canvas,root,()=>settings);
    else release=startWebGLVisualizer(canvas,root,SCENES,()=>settings,root.querySelector('.viz-fade'),()=>{queueMicrotask(()=>{if(!disposed){stopRecording();startRenderer('canvas')}})});
  }
  function recordButton(on){const b=root.querySelector('[data-action=record-video]');b.classList.toggle('active',on);b.setAttribute('aria-label',on?'Stop video recording':'Record video');b.title=on?'Stop and save video':'Record video';b.innerHTML=icon(on?'stop':'record')}
  async function stopRecording(){if(!recorder)return;const take=recorder,stage=capture;recorder=null;capture=null;recordButton(false);try{const blob=await take.stop();downloadBlob(blob,`hitstudio-${SCENES[settings.want].id}-${stage.width}x${stage.height}.${videoExtension(take.mime)}`);toast('Video saved with audio.')}catch(error){toast({title:'Could not save recording',body:String(error),kind:'error'})}finally{stage.dispose()}}
  async function beginRecording(format,layout){
    if(starting||recorder)return;starting=true;
    let stage,disposeRenderer=()=>{};
    try{
      const [width,height]=layout.split('x').map(Number);if(!['1920x1080','1080x1920','1080x1080'].includes(layout))throw Error('Choose a recording layout.');
      stage=document.createElement('div');stage.className='recording-stage';stage.style.cssText=`position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;document.body.append(stage);
      let canvas=document.createElement('canvas');stage.append(canvas);const read=()=>({...settings,plotBottom:0,resolution:{width,height}});let failed=false;
      const fallback=()=>{failed=true;if(recorder)void stopRecording()};
      if(mode==='canvas')disposeRenderer=startCanvasVisualizer(canvas,stage,read);else disposeRenderer=startWebGLVisualizer(canvas,stage,SCENES,read,document.createElement('div'),fallback);
      await new Promise(requestAnimationFrame);
      if(failed){disposeRenderer();canvas=document.createElement('canvas');stage.replaceChildren(canvas);disposeRenderer=startCanvasVisualizer(canvas,stage,read);await new Promise(requestAnimationFrame)}
      if(disposed){disposeRenderer();stage.remove();return}
      capture={width,height,dispose(){disposeRenderer();stage.remove()}};
      recorder=await startVideoRecording(canvas,{format});
      if(disposed){await stopRecording();return}
      if(format==='mp4'&&!recorder.mime.includes('mp4'))toast('This browser cannot record MP4; using WebM instead.');
      recordAt=performance.now();recordButton(true);poke();toast(`Recording ${width} × ${height} with master audio.`);
    }catch(error){disposeRenderer();stage?.remove();capture=null;toast({title:'Could not start recording',body:String(error),kind:'error'})}finally{starting=false}
  }
  async function toggleRecording(){
    if(recorder)return stopRecording();if(starting)return;
    const format=stored('videoFormat','mp4'),layout=stored('videoLayout','1920x1080');
    showModal('Record visualization',`<p class="tip">Record the visualization and master audio. The video is composed at your chosen dimensions, without the studio controls.</p><form id="video-record-form" class="stack"><label class="field">Recording format<select name="format" aria-label="Recording format"><option value="mp4">MP4 · H.264 / AAC</option><option value="webm">WebM · VP9 / Opus</option></select></label><label class="field">Video layout<select name="layout" aria-label="Video layout"><option value="1920x1080">Landscape · Full HD · 1920 × 1080</option><option value="1080x1920">Portrait · Full HD · 1080 × 1920</option><option value="1080x1080">Square · 1080 × 1080</option></select></label><p class="tip">30 fps. MP4 falls back to WebM if your browser cannot encode it.</p><button class="primary" type="submit">${icon('record')} Start recording</button></form>`);
    const form=document.querySelector('#video-record-form');form.elements.format.value=['mp4','webm'].includes(format)?format:'mp4';form.elements.layout.value=['1920x1080','1080x1920','1080x1080'].includes(layout)?layout:'1920x1080';
    form.onsubmit=e=>{e.preventDefault();const data=new FormData(form),format=data.get('format'),layout=data.get('layout');persist('videoFormat',format);persist('videoLayout',layout);closeModal();void beginRecording(format,layout)};
  }
  function scrollToScene(){const card=root.querySelector(`[data-scene="${settings.want}"]`);if(card&&!card.hidden)requestAnimationFrame(()=>{if(!disposed)card.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'})})}
  function selectScene(index){settings.want=index;persist('scene',index);root.classList.toggle('viz-analysis',!!SCENES[index].analysis);root.querySelectorAll('[data-scene]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.scene)===index)));root.querySelector('canvas').setAttribute('aria-label',`${SCENES[index].name} audio visualization`);scrollToScene()}
  root.addEventListener('click',e=>{
    if(e.target.closest('[data-clear-spectrum]'))clearSpectralHistory();
    const s=e.target.closest('[data-scene]');if(s)selectScene(Number(s.dataset.scene));
    const p=e.target.closest('[data-palette]');if(p){settings.palette=p.dataset.palette;persist('palette',settings.palette);root.querySelectorAll('[data-palette]').forEach(b=>b.classList.toggle('active',b.dataset.palette===settings.palette))}
  });
  root.addEventListener('input',e=>{if(e.target.dataset.setting==='sens'){settings.sens=Number(e.target.value);persist('sens',settings.sens)}});
  root.addEventListener('change',e=>{if(e.target.dataset.setting==='spectralWindow'){settings.spectralWindow=Number(e.target.value);persist('spectralWindow',settings.spectralWindow)}if(e.target.dataset.setting==='auto'){settings.auto=e.target.checked;persist('auto',settings.auto)}if(e.target.dataset.setting==='renderer'){if(recorder){e.target.value=mode;toast('Stop video recording before changing renderer.')}else startRenderer(e.target.value)}});
  let lastHint='';
  const loop=now=>{
    if(disposed)return;raf=requestAnimationFrame(loop);if(document.hidden)return;spectralHistory();if(now-lastCheck<200)return;lastCheck=now;idle(now);
    paintAnalysisPreviews(root,PALETTES[settings.palette].colors,settings.spectralWindow);
    const isAnalysis=!!SCENES[settings.want].analysis;root.classList.toggle('viz-analysis',isAnalysis);settings.plotBottom=app.classList.contains('immersive')?0:root.querySelector('.viz-dock').offsetHeight+20;root.querySelector('.spectral-controls').hidden=!isAnalysis;root.querySelector('.spectral-window').hidden=SCENES[settings.want].id==='density';
    const a=sampleAnalysis();signal.textContent=recorder?`REC ${Math.floor((now-recordAt)/1000)}s`:isAnalysis?(music.isPlaying()?'Measured audio':'No audio'):a.silent?'Preview':'Live audio';root.querySelector('.scene-name').textContent=SCENES[settings.want].name;
    const status=isAnalysis?'analysis':a.silent&&!music.isPlaying()?'paused':'playing';
    if(status!==lastHint){lastHint=status;hint.innerHTML=status==='paused'?`<div><div class="eyebrow">Your listening space</div><h1>Your sound,<br>in full colour.</h1><p>Choose a song, discover a CC0 sound, or bring your studio mix to life.</p><div class="row" style="justify-content:center"><button class="primary" data-action="add-songs">${icon('folder')} Add songs</button><button data-action="library">${icon('library')} Open library</button></div></div>`:'';if(status==='paused')poke()}
    if(settings.auto&&!a.silent&&now-lastSwitch>16000&&(a.dropCount!==lastDrop||now-lastSwitch>30000)){lastSwitch=now;const visible=[...root.querySelectorAll('[data-scene]:not([hidden])')].map(b=>Number(b.dataset.scene));selectScene(visible[(visible.indexOf(settings.want)+1)%visible.length])}
    lastDrop=a.dropCount;
  };
  startRenderer(mode);raf=requestAnimationFrame(loop);poke();scrollToScene();
  return {poke,resize(){release.resize?.();poke()},toggleRecording,dispose(){disposed=true;cancelAnimationFrame(raf);activity.abort();app.classList.remove('immersive-idle');release();void stopRecording()}};
}

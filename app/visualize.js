import { getEngine } from './core/engine.js';
import {paintAnalysisPreviews} from './features/visualizer/analysis-previews.js';
import {EXTRA_SCENES} from './features/visualizer/extra-scenes.js';
import {clearSpectralHistory,spectralHistory} from './features/visualizer/spectral-history.js';
import {showModal,closeModal} from './dialogs.js';
import {createExtraScene} from './features/visualizer/scenes/extra.js';
import { icon, escape, emptyState } from './dom.js';
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
/** Scenes grouped into a few families so the picker never shows all 18 at once. Unlisted scenes land in Flow. */
const FAMILY_DEFS=[{id:'classic',name:'Classic',ids:['bars','spectrum','scope','terrain']},{id:'space',name:'Space',ids:['particles','warp','tunnel','aurora']},{id:'shapes',name:'Shapes',ids:['orb','kaleido','cymatic','rose']},{id:'flow',name:'Flow',ids:['ribbon','flowfield','helix']},{id:'analysis',name:'Analysis',ids:['spectrogram','waterfall','density']}];
export const FAMILIES=FAMILY_DEFS.map(f=>({...f,scenes:f.ids.map(id=>SCENES.findIndex(s=>s.id===id)).filter(i=>i>=0)}));
for(const [i,s] of SCENES.entries())if(!FAMILIES.some(f=>f.scenes.includes(i)))FAMILIES.find(f=>f.id===(s.analysis?'analysis':'flow')).scenes.push(i);
const SCENE_ORDER=FAMILIES.flatMap(f=>f.scenes),familyOf=i=>FAMILIES.find(f=>f.scenes.includes(i));
/** One Intensity value (0 calm … 1 wild) drives speed, glow and reactivity; 0.5 is the neutral 1×. */
const lerp3=(t,[a,b,c])=>t<.5?a+(b-a)*t*2:b+(c-b)*(t-.5)*2;
const INTENSITY={sens:[.5,1,2.2],speed:[.5,1,2],glow:[.3,1,1.8]};
const chevron=right=>`<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${right?'m9 18 6-6-6-6':'m15 18-6-6 6-6'}"/></svg>`;
const VIZ_KEYS=[['← / →','Previous / next scene'],['C','Customize'],['S','Shuffle scenes on or off'],['F','Fullscreen'],['H','Hide the controls (move the mouse to bring them back)'],['Space','Play / pause'],['Esc','Close the panel / leave immersive view'],['?','Show these shortcuts']];
export function mountVisualize(container, actions) {
  const settings={want:Math.max(0,Math.min(SCENES.length-1,Number(stored('scene',1))||0)),intensity:Math.max(0,Math.min(1,Number(stored('intensity',.5))??.5)),palette:stored('palette','bloom'),sens:Math.max(.4,Math.min(2.5,Number(stored('sens',1))||1)),auto:!!stored('auto',false),speed:Math.max(.25,Math.min(2.5,Number(stored('speed',1))||1)),glow:Math.max(0,Math.min(2,Number(stored('glow',1))??1)),particles:stored('particles',true)!==false,spectralWindow:[6,12,24].includes(Number(stored('spectralWindow',12)))?Number(stored('spectralWindow',12)):12};
  if(!PALETTES[settings.palette])settings.palette='bloom';
  let mode=stored('renderer','webgl'),release=()=>{},disposed=false,raf=0,lastCheck=0,lastSwitch=performance.now(),lastDrop=sampleAnalysis().dropCount,recorder=null,recordAt=0,capture=null,starting=false,lastActivity=performance.now();
  container.innerHTML=`<section class="viz controls-visible" data-theme="dark" aria-label="Music visualization">
    <canvas aria-label="Audio-reactive visualization"></canvas><div class="viz-fade"></div>
    <div class="viz-top"><div class="viz-title"><span class="badge viz-signal" hidden></span></div><div class="viz-actions">
      <button class="icon" data-action="library" aria-label="Song list" title="Song list">${icon('library')}</button>
      <button class="icon" data-action="record-video" aria-label="Record video" title="Record video">${icon('record')}</button>
      <button class="icon" data-action="immersive" aria-label="Enter immersive view" title="Immersive view">${icon('eye')}</button>
      <button class="icon" data-action="fullscreen" aria-label="Fullscreen" title="Fullscreen">${icon('maximize')}</button>
    </div></div>
    <div class="viz-hint"></div>
    <div class="viz-dock"><div class="viz-bar" role="toolbar" aria-label="Scene controls">
      <button class="icon" data-viz-step="-1" aria-label="Previous scene" title="Previous scene (←)">${chevron(false)}</button>
      <button class="viz-bar-scene" data-viz-panel aria-label="Choose a scene" title="Choose a scene (C)"><small class="viz-bar-family"></small><b class="viz-bar-name"></b></button>
      <button class="icon" data-viz-step="1" aria-label="Next scene" title="Next scene (→)">${chevron(true)}</button>
      <span class="viz-bar-sep" aria-hidden="true"></span>
      <button class="viz-bar-toggle" data-viz-shuffle aria-pressed="${settings.auto}" title="Shuffle: move to a new scene on big moments in the music (S)">${icon('shuffle')}<span>Shuffle</span></button>
      <button class="viz-bar-toggle" data-viz-panel aria-expanded="false" aria-controls="viz-panel" title="Customize (C)">${icon('settings')}<span>Customize</span></button>
    </div></div>
    <aside class="viz-panel" id="viz-panel" hidden aria-label="Customize the visualizer">
      <header class="viz-panel-head"><h2>Customize</h2><button class="icon" data-viz-close aria-label="Close panel" title="Close (Esc)">${icon('close')}</button></header>
      <section class="viz-panel-sec"><h3>Scene</h3>
        <div class="viz-families" role="tablist" aria-label="Scene families">${FAMILIES.map(f=>`<button role="tab" data-family="${f.id}" aria-selected="false">${f.name}</button>`).join('')}</div>
        ${FAMILIES.map(f=>`<div class="viz-scene-grid" role="tabpanel" data-family-grid="${f.id}" aria-label="${f.name} scenes" hidden>${f.scenes.map(i=>{const s=SCENES[i];return `<button class="scene-card" data-scene="${i}" data-analysis="${!!s.analysis}" aria-label="${s.name} scene" aria-pressed="${i===settings.want}">${s.analysis?`<span class="scene-art"><canvas data-analysis-preview="${s.id}" aria-hidden="true"></canvas></span>`:`<span class="scene-art art-${s.id}"></span>`}<span>${s.name}</span></button>`}).join('')}</div>`).join('')}
        <p class="viz-note viz-analysis-only">Measured audio · log frequency · −100 to −10 dB</p>
      </section>
      <section class="viz-panel-sec"><h3>Colours</h3><div class="palettes">${Object.entries(PALETTES).map(([id,p])=>`<button class="palette ${id===settings.palette?'active':''}" data-palette="${id}" style="background:${p.chip}" aria-label="${escape(p.label)} colours" title="${escape(p.label)}"></button>`).join('')}</div></section>
      <section class="viz-panel-sec viz-scene-only"><h3>Intensity</h3><input data-setting="intensity" type="range" min="0" max="1" step="0.01" value="${settings.intensity}" aria-label="Intensity, from calm to wild" /><div class="viz-range-ends" aria-hidden="true"><span>Calm</span><span>Wild</span></div></section>
      <details class="viz-panel-sec viz-advanced"><summary>Advanced</summary>
        <div class="viz-scene-only viz-adv-grid"><label>Speed <input data-setting="speed" type="range" min="0.25" max="2.5" step="0.05" value="${settings.speed}" aria-label="Animation speed" /></label><label>Glow <input data-setting="glow" type="range" min="0" max="2" step="0.05" value="${settings.glow}" aria-label="Glow strength" /></label><label>Reactivity <input data-setting="sens" type="range" min="0.4" max="2.5" step="0.01" value="${settings.sens}" aria-label="Visual reactivity" /></label><label class="opt-check"><input data-setting="particles" type="checkbox" ${settings.particles?'checked':''} /> Floating particles</label></div>
        <div class="viz-analysis-only viz-adv-grid"><label class="spectral-window">Time window <select data-setting="spectralWindow" aria-label="Spectrogram time window">${[6,12,24].map(n=>`<option value="${n}" ${n===settings.spectralWindow?'selected':''}>${n} seconds</option>`).join('')}</select></label><button data-clear-spectrum>Clear history</button></div>
      </details>
      <footer class="viz-panel-foot"><p class="viz-keys-hint"><kbd>←</kbd><kbd>→</kbd> scenes · <kbd>F</kbd> fullscreen · <kbd>H</kbd> hide · <button class="link" data-viz-keys>All shortcuts</button></p><p class="viz-mode"></p><button class="link" data-action="settings">Renderer and defaults in Settings</button></footer>
    </aside>
  </section>`;
  const root=container.firstElementChild, hint=root.querySelector('.viz-hint'),signal=root.querySelector('.viz-signal');
  const persist=(k,v)=>{try{localStorage.setItem('bloom.viz.'+k,JSON.stringify(v))}catch{}};
  const app=document.querySelector('#app'),activity=new AbortController();
  const panel=root.querySelector('.viz-panel');
  const poke=()=>{lastActivity=performance.now();root.classList.add('controls-visible');root.classList.remove('auto-hidden');app.classList.remove('immersive-idle')};
  for(const event of ['pointermove','pointerdown','focusin','keydown'])window.addEventListener(event,poke,{signal:activity.signal,passive:true});
  /** Immersive view hides everything after 3 s. In the normal view only the scene bar and top buttons fade, after 4 s of stillness while music plays. */
  function idle(now){
    const busy=!!document.querySelector('dialog[open]')||!panel.hidden||!!root.querySelector('.viz-top:hover,.viz-dock:hover');
    if(app.classList.contains('immersive')){if(now-lastActivity>=3000&&!busy){root.classList.remove('controls-visible');app.classList.add('immersive-idle')}return}
    if(now-lastActivity>=4000&&!busy&&lastHint!=='paused'&&!recorder)root.classList.add('auto-hidden');
  }
  function hideNow(){if(lastHint==='paused')return;closePanel();lastActivity=-Infinity;root.classList.add('auto-hidden');if(app.classList.contains('immersive')){root.classList.remove('controls-visible');app.classList.add('immersive-idle')}}
  function showFamily(id){root.querySelectorAll('[data-family]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.family===id)));root.querySelectorAll('[data-family-grid]').forEach(g=>{g.hidden=g.dataset.familyGrid!==id})}
  function openPanel(){panel.hidden=false;root.classList.add('panel-open');root.querySelectorAll('[data-viz-panel][aria-expanded]').forEach(b=>b.setAttribute('aria-expanded','true'));showFamily(familyOf(settings.want).id);scrollToScene();requestAnimationFrame(()=>{if(!disposed)root.querySelector(`.viz-panel [data-scene="${settings.want}"]`)?.focus({preventScroll:true})})}
  function closePanel(){if(panel.hidden)return;const hadFocus=panel.contains(document.activeElement);panel.hidden=true;root.classList.remove('panel-open');root.querySelectorAll('[data-viz-panel][aria-expanded]').forEach(b=>b.setAttribute('aria-expanded','false'));if(hadFocus)root.querySelector('[data-viz-panel][aria-expanded]')?.focus({preventScroll:true})}
  const togglePanel=()=>panel.hidden?openPanel():closePanel();
  function stepScene(dir){const at=SCENE_ORDER.indexOf(settings.want);selectScene(SCENE_ORDER[(at+dir+SCENE_ORDER.length)%SCENE_ORDER.length])}
  function setShuffle(on){settings.auto=on;persist('auto',on);lastSwitch=performance.now();root.querySelector('[data-viz-shuffle]').setAttribute('aria-pressed',String(on))}
  function setIntensity(t){settings.intensity=t;persist('intensity',t);for(const k of Object.keys(INTENSITY)){settings[k]=Math.round(lerp3(t,INTENSITY[k])*100)/100;persist(k,settings[k]);const input=root.querySelector(`[data-setting="${k}"]`);if(input)input.value=settings[k]}}
  function showKeys(){showModal('Visualizer shortcuts',`<div class="st-keys">${VIZ_KEYS.map(([k,d])=>`<div><kbd>${k}</kbd><span>${escape(d)}</span></div>`).join('')}</div>`)}
  window.addEventListener('keydown',e=>{
    if(e.metaKey||e.ctrlKey||e.altKey||document.querySelector('dialog[open]'))return;
    if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopImmediatePropagation();closePanel();return}
    if(e.target.closest?.('input,select,textarea,[contenteditable=true],[role=tab]'))return;
    const key=e.key.length===1?e.key.toLowerCase():e.key;
    const run={ArrowLeft:()=>stepScene(-1),ArrowRight:()=>stepScene(1),c:togglePanel,s:()=>setShuffle(!settings.auto),f:()=>root.querySelector('[data-action=fullscreen]').click(),'?':showKeys}[key];
    if(key==='h'&&!e.repeat){e.preventDefault();e.stopImmediatePropagation();hideNow();return}
    if(run&&!(e.repeat&&key.length===1)){e.preventDefault();run()}
  },{capture:true,signal:activity.signal});
  function startRenderer(next){
    release();mode=next==='canvas'?'canvas':'webgl';persist('renderer',mode);
    const old=root.querySelector('canvas'),canvas=document.createElement('canvas');canvas.setAttribute('aria-label',`${SCENES[settings.want].name} audio visualization`);old.replaceWith(canvas);
    root.querySelector('.viz-fade').style.opacity='0';
    root.querySelector('.viz-mode').textContent=mode==='canvas'?'Using the Compatibility renderer (no graphics acceleration).':'';
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
    if(music.source()==='radio'){toast({title:'Radio can’t be recorded',body:'Live radio is for listening and visualizing only. Switch to your own music to record a video.',kind:'error'});return}
    const format=stored('videoFormat','mp4'),layout=stored('videoLayout','1920x1080');
    showModal('Record visualization',`<p class="tip">Record the visualization and master audio. The video is composed at your chosen dimensions, without the studio controls.</p><form id="video-record-form" class="stack"><label class="field">Recording format<select name="format" aria-label="Recording format"><option value="mp4">MP4 · H.264 / AAC</option><option value="webm">WebM · VP9 / Opus</option></select></label><label class="field">Video layout<select name="layout" aria-label="Video layout"><option value="1920x1080">Landscape · Full HD · 1920 × 1080</option><option value="1080x1920">Portrait · Full HD · 1080 × 1920</option><option value="1080x1080">Square · 1080 × 1080</option></select></label><p class="tip">30 fps. MP4 falls back to WebM if your browser cannot encode it.</p><button class="primary" type="submit">${icon('record')} Start recording</button></form>`);
    const form=document.querySelector('#video-record-form');form.elements.format.value=['mp4','webm'].includes(format)?format:'mp4';form.elements.layout.value=['1920x1080','1080x1920','1080x1080'].includes(layout)?layout:'1920x1080';
    form.onsubmit=e=>{e.preventDefault();const data=new FormData(form),format=data.get('format'),layout=data.get('layout');persist('videoFormat',format);persist('videoLayout',layout);closeModal();void beginRecording(format,layout)};
  }
  function scrollToScene(){const card=root.querySelector(`[data-scene="${settings.want}"]`);if(card&&!panel.hidden)requestAnimationFrame(()=>{if(!disposed)card.scrollIntoView({block:'nearest',behavior:'smooth'})})}
  function syncSceneUI(){const s=SCENES[settings.want],fam=familyOf(settings.want);root.classList.toggle('viz-analysis',!!s.analysis);root.querySelector('.viz-bar-name').textContent=s.name;root.querySelector('.viz-bar-family').textContent=fam.name;root.querySelector('.spectral-window').hidden=s.id==='density';root.querySelectorAll('[data-scene]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.scene)===settings.want)));root.querySelector('canvas').setAttribute('aria-label',`${s.name} audio visualization`)}
  function selectScene(index){settings.want=index;persist('scene',index);syncSceneUI();if(!panel.hidden)showFamily(familyOf(index).id);scrollToScene()}
  root.addEventListener('click',e=>{
    if(e.target.closest('[data-clear-spectrum]'))clearSpectralHistory();
    const s=e.target.closest('[data-scene]');if(s)selectScene(Number(s.dataset.scene));
    const f=e.target.closest('[data-family]');if(f)showFamily(f.dataset.family);
    const step=e.target.closest('[data-viz-step]');if(step)stepScene(Number(step.dataset.vizStep));
    if(e.target.closest('[data-viz-panel]'))togglePanel();
    if(e.target.closest('[data-viz-close]'))closePanel();
    if(e.target.closest('[data-viz-shuffle]'))setShuffle(!settings.auto);
    if(e.target.closest('[data-viz-keys]'))showKeys();
    const p=e.target.closest('[data-palette]');if(p){settings.palette=p.dataset.palette;persist('palette',settings.palette);root.querySelectorAll('[data-palette]').forEach(b=>b.classList.toggle('active',b.dataset.palette===settings.palette))}
  });
  root.addEventListener('keydown',e=>{const tab=e.target.closest('[data-family]');if(!tab||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();const tabs=[...root.querySelectorAll('[data-family]')],next=tabs[(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];next.focus();showFamily(next.dataset.family)});
  root.addEventListener('input',e=>{const k=e.target.dataset.setting;if(k==='intensity')setIntensity(Number(e.target.value));if(k==='sens'||k==='speed'||k==='glow'){settings[k]=Number(e.target.value);persist(k,settings[k])}});
  root.addEventListener('change',e=>{if(e.target.dataset.setting==='spectralWindow'){settings.spectralWindow=Number(e.target.value);persist('spectralWindow',settings.spectralWindow)}if(e.target.dataset.setting==='particles'){settings.particles=e.target.checked;persist('particles',settings.particles)}});
  let lastHint='';
  const loop=now=>{
    if(disposed)return;raf=requestAnimationFrame(loop);if(document.hidden)return;spectralHistory();if(now-lastCheck<200)return;lastCheck=now;{const eng=getEngine();if(eng.ctx.state!=='running'&&music.isPlaying())void eng.resume()}idle(now);
    if(!panel.hidden)paintAnalysisPreviews(root,PALETTES[settings.palette].colors,settings.spectralWindow);
    const isAnalysis=!!SCENES[settings.want].analysis;settings.plotBottom=app.classList.contains('immersive')?0:root.querySelector('.viz-dock').offsetHeight+20;
    const a=sampleAnalysis();signal.textContent=recorder?`REC ${Math.floor((now-recordAt)/1000)}s`:'';signal.hidden=!recorder;
    const status=isAnalysis?'analysis':a.silent&&!music.isPlaying()?'paused':'playing';
    if(status!==lastHint){lastHint=status;root.classList.toggle('viz-paused',status==='paused');hint.innerHTML=status==='paused'?`${emptyState({title:'Your sound, <span class="grad-text">in full colour</span>',sub:'Play a song, tune into live radio or bring your studio mix to life.',actions:`<button class="primary" data-action="add-songs">${icon('folder')} Add songs</button><button data-action="library">${icon('library')} Open library</button><button data-action="library-radio">${icon('radio')} Live radio</button>`})}`:'';if(status==='paused')poke()}
    if(settings.auto&&!a.silent&&now-lastSwitch>16000&&(a.dropCount!==lastDrop||now-lastSwitch>30000)){lastSwitch=now;const pool=SCENE_ORDER.filter(i=>i!==settings.want&&!SCENES[i].analysis);selectScene(pool[Math.floor(Math.random()*pool.length)])}
    lastDrop=a.dropCount;
  };
  setShuffle(settings.auto);syncSceneUI();startRenderer(mode);raf=requestAnimationFrame(loop);poke();
  return {poke,resize(){release.resize?.();poke()},toggleRecording,dispose(){disposed=true;cancelAnimationFrame(raf);activity.abort();app.classList.remove('immersive-idle');release();void stopRecording()}};
}

import { startHeaderVisualizer } from './header-visualizer.js';
import { quickTask } from './features/io/quicktasks.js';
import { registerCommand } from './core/commands.js';
import { $, $$, icon, escape, button } from './dom.js';
import { useStore, makeTrack, projectDuration, setUndoToastHook } from './core/store.js';
import { getEngine } from './core/engine.js';
import { buffers } from './core/buffers.js';
import { useToasts, toast } from './core/toast.js';
import './features/effects/defs/index.js';
import { PROCESSES, useProcDialog } from './features/effects/processes.js';
import { pickFiles, useIO, ioSet } from './features/io/state.js';
import { importFiles } from './features/io/import.js';
import { saveProjectFile, openProjectFile } from './features/io/project-file.js';
import { startAutosave, restoreAutosave } from './features/io/autosave.js';
import { loadDemoSong } from './features/io/demo.js';
import { useRec, isRecording, stopRecording } from './features/io/record.js';
import { previewMelodyRow } from './features/create/sequencer.js';
import { useCreate } from './features/create/state.js';
import { useDJ } from './features/dj/state.js';
import { getDJ } from './features/dj/engine.js';
import { detectBpm, detectKeyInfo } from './features/io/analysis.js';
import { mountVisualize } from './visualize.js';
import { mountStudio, studioAction, splitSelection, deleteSelection, duplicateSelection, copySelection, pasteSelection } from './studio.js';
import { showLibrary, hideLibrary, toggleLibrary, renderLibrary, loadSounds } from './library.js';
import { welcome, showModal, closeModal, showSongMenu, showEffects, showEffectParams, showProcesses, showProcess, showExport, showRecord } from './dialogs.js';
import * as music from './media.js';

const app=$('#app'),library=$('#library'),player=$('#player');
let workspace=$('#workspace');
const modes=[['create','Create'],['edit','Edit'],['mix','Mix'],['dj','DJ'],['tools','Tools'],['visualize','Visualize']];
let fullscreenPreviousImmersive=false,fullscreenRequested=false;
let view=null,renderPending=0,immersive=false,previousMode=null,bootReady=false;
const dismissedTips=new Set((()=>{try{const value=JSON.parse(localStorage.getItem('hitstudio.dismissedTips')||'[]');return Array.isArray(value)?value:[]}catch{return []}})());
const updateTips=()=>document.documentElement.dataset.dismissedTips=[...dismissedTips].join(' ');updateTips();
const actions={effects:showEffects,effectParams:showEffectParams,songMenu:showSongMenu,pickAudio:multiple=>pickFiles({multiple})};
const safe=fn=>async(...args)=>{try{await fn(...args)}catch(error){console.error(error);toast({title:'That action could not finish',body:error.message||String(error),kind:'error'})}};
function setImmersive(value){immersive=value;app.classList.toggle('immersive',value);updateImmersiveButton();view?.resize?.();view?.poke?.()}
function updateFullscreenButton(){const b=workspace.querySelector('[data-action=fullscreen]');if(b){const active=!!document.fullscreenElement||fullscreenRequested;b.setAttribute('aria-label',active?'Exit fullscreen':'Fullscreen');b.title=active?'Exit fullscreen':'Fullscreen';b.innerHTML=icon(active?'shrink':'expand')}}
function updateImmersiveButton(){updateFullscreenButton();const b=workspace.querySelector('[data-action=immersive]');if(b){b.innerHTML=icon(immersive?'shrink':'expand');b.setAttribute('aria-label',immersive?'Back to studio':'Enter immersive view');b.title=immersive?'Back to studio (Esc)':'Enter immersive view'}}
function renderView(){
 cancelAnimationFrame(renderPending);renderPending=0;
 const mode=useStore.getState().ui.mode;
 view?.dispose?.();view=null;
 // Replacing the native subtree releases all DOM listeners; DSP engines persist.
 const fresh=document.createElement('main');fresh.id='workspace';fresh.tabIndex=-1;workspace.replaceWith(fresh);workspace=fresh;
 if(mode!=='visualize'&&immersive)setImmersive(false);
 $$('.rail [data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
 const mount=mode==='visualize'?mountVisualize:mountStudio;
 if(mode==='visualize')view=mount(workspace,actions);else view=mount(mode,workspace,actions);
 updateImmersiveButton();
 if(location.hash!=='#'+mode)history.replaceState(null,'','#'+mode);
 if(previousMode!==mode){previousMode=mode;$('#project-name').value=useStore.getState().project.name}
}
function scheduleRender(){if(!renderPending)renderPending=requestAnimationFrame(renderView)}
$('.rail').innerHTML=modes.map(([id,label])=>`<button data-mode="${id}" aria-label="${label}">${icon(id)}<span>${label}</span></button>`).join('')+`<button class="rail-library" data-action="library" aria-label="Song list">${icon('library')}<span>Library</span></button>`;
player.innerHTML=`<button class="player-lift" data-action="library" aria-label="Slide up to open library" aria-expanded="false" aria-controls="library"><span></span></button><div class="player-info"><select id="audio-source" aria-label="Audio source"><option value="queue">Song list</option><option value="studio">Studio mix</option><option value="create">Beat Maker</option><option value="dj">DJ decks</option><option value="radio" disabled>Live radio</option><option value="preview" disabled>Sound preview</option><option value="jingle" disabled>Welcome ident</option></select><strong id="now-playing">Choose your next song</strong></div><div class="player-controls"><button class="icon" data-action="shuffle" aria-label="Shuffle" title="Shuffle">${icon('shuffle')}</button><button class="icon" data-action="previous" aria-label="Previous song">${icon('previous')}</button><button class="main-play icon" data-action="play" aria-label="Play">${icon('play')}</button><button class="icon" data-action="next" aria-label="Next song">${icon('next')}</button><button class="icon" data-action="repeat" aria-label="Repeat song" title="Repeat song">${icon('repeat')}</button></div><div class="player-progress"><span class="time" id="elapsed">0:00</span><input id="seek" type="range" min="0" max="1" step=".01" value="0" aria-label="Song position"/><span class="time" id="duration">0:00</span></div><label class="volume">${icon('volume')}<input id="master-volume" type="range" min="0" max="1" step=".01" value="1" aria-label="Master volume"/></label><div class="player-right"><button class="icon" data-action="library" aria-label="Song list" title="Song list">${icon('library')}</button><button class="icon" data-action="stop-all" aria-label="Stop all audio" title="Stop all audio">${icon('stop')}</button></div>`;
function time(value){value=Math.max(0,Number(value)||0);return `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`}
function updatePlayer(){
 const S=useStore.getState(),source=music.source(),playing=music.isPlaying();
 $('#now-playing').textContent=music.isBusy()?'Loading…':music.nowPlaying();$('#audio-source').value=source;
 const play=$('[data-action=play]',player);play.innerHTML=icon(playing?'pause':'play');play.setAttribute('aria-label',playing?'Pause':'Play');
 const duration=source==='studio'?projectDuration(S.project):['queue','preview','jingle'].includes(source)?music.currentDuration():0;
 const position=source==='studio'?S.transport.position:['queue','preview','jingle'].includes(source)?music.media.currentTime:0;
 const seek=$('#seek');seek.disabled=!duration;if(document.activeElement!==seek){seek.max=Math.max(1,duration);seek.value=Math.max(0,Math.min(duration,position))}
 $('#elapsed').textContent=source==='radio'?'LIVE':time(position);$('#duration').textContent=duration?time(duration):'—';
 if(document.activeElement!==$('#master-volume'))$('#master-volume').value=Math.min(1,S.project.master.volume);
 $('[data-action=shuffle]',player).setAttribute('aria-pressed',String(music.settings().shuffle));$('[data-action=repeat]',player).setAttribute('aria-pressed',String(music.settings().repeat));
 $('[data-action=undo]').disabled=S.past.length===0;$('[data-action=redo]').disabled=S.future.length===0;
 const record=workspace.querySelector('[data-action=record]');if(record){record.classList.toggle('active',isRecording());record.title=isRecording()?'Stop recording':'Record microphone'}
}
$('#seek').addEventListener('input',e=>{if(music.source()==='studio')getEngine().seek(Number(e.target.value));else if(music.currentDuration())music.media.currentTime=Number(e.target.value)});
$('#audio-source').addEventListener('change',safe(async e=>{await music.setSource(e.target.value);updatePlayer()}));
$('#master-volume').addEventListener('input',e=>useStore.getState().mutate('Master volume',p=>{p.master.volume=Number(e.target.value)},{coalesce:'master-volume'}));
$('#project-name').addEventListener('change',e=>useStore.getState().mutate('Rename project',p=>{p.name=e.target.value||'Untitled song'}));
useStore.subscribe((s,prev)=>{
 if(s.ui.mode!==prev.ui.mode){if(s.ui.mode==='create'){music.stopAll();void music.setSource('create')}if(bootReady)void music.sectionSound();if(s.ui.mode==='visualize')s.setTransport({metronome:false});renderView()}
 else if(s.project!==prev.project&&s.ui.mode!=='visualize')scheduleRender();
 else if(s.ui.zoom!==prev.ui.zoom||s.ui.snap!==prev.ui.snap)scheduleRender();
 if(s.project.name!==prev.project.name&&document.activeElement!==$('#project-name'))$('#project-name').value=s.project.name;
 updatePlayer();
});
music.subscribeMedia(updatePlayer);useDJ.subscribe(updatePlayer);useRec.subscribe(updatePlayer);setInterval(updatePlayer,200);
setUndoToastHook(message=>toast({title:message,ms:1200}));
useToasts.subscribe(state=>{$('#toasts').innerHTML=state.toasts.map(t=>`<div class="toast"><strong>${escape(t.title)}</strong>${t.body?`<p>${escape(t.body)}</p>`:''}${t.action?`<button data-toast-action="${t.id}">${escape(t.action.label)}</button>`:''}</div>`).join('')});
useIO.subscribe((s,prev)=>{
 if(s.exportOpen&&!prev.exportOpen){showExport(s.exportPreset);ioSet({exportOpen:false,exportPreset:null})}
 if(s.confirm&&s.confirm!==prev.confirm){const req=s.confirm;let settled=false;const finish=value=>{if(settled)return;settled=true;ioSet({confirm:null});req.resolve(value)};showModal(req.title,`<p class="tip">${escape(req.body)}</p><div class="row"><button id="confirm-no">Cancel</button><button id="confirm-yes" class="primary">${escape(req.confirmLabel||'Continue')}</button></div>`,()=>finish(false));$('#confirm-no').onclick=()=>{finish(false);closeModal()};$('#confirm-yes').onclick=()=>{finish(true);closeModal()}}
});
useProcDialog.subscribe((s,prev)=>{if(s.open&&s.open!==prev.open)showProcess(s.open)});
async function addFilesToSongs(){const files=await pickFiles();if(files.length){await music.addSongs(files);showLibrary(library,actions,'songs');toast(`Added ${files.length} file${files.length===1?'':'s'} to your song list.`)}}
const runAction=safe(async action=>{
 if(action.startsWith('mode:')){useStore.getState().setMode(action.split(':')[1]);return}
 if(action==='welcome')await welcome(actions);
 if(action==='close-modal')closeModal();
 if(action==='welcome-listen'){music.stopAll();useStore.getState().setMode('visualize');setImmersive(true);closeModal();showLibrary(library,actions,'songs')}
 if(action==='welcome-dj'){closeModal();useStore.getState().setMode('dj')}
 if(action==='welcome-create'){closeModal();useStore.getState().setMode('create')}
 if(action==='welcome-edit'){closeModal();useStore.getState().setMode('edit')}
 if(action==='restore-project'){music.stopAll();if(await restoreAutosave()){closeModal();useStore.getState().setMode('edit');await music.setSource('studio');toast('Project restored.')}else toast('This session could not be restored.')}
 if(action==='add-songs')await addFilesToSongs();
 if(action==='add-demos'){music.addDemoSongs();renderLibrary()}
 if(action==='library')toggleLibrary(library,actions);
 if(action==='close-library')hideLibrary();
 if(action==='restore-tips'){dismissedTips.clear();localStorage.setItem('hitstudio.dismissedTips','[]');updateTips();toast('Tips shown again.')} 
 if(action==='play'){if(useStore.getState().ui.mode==='create'&&music.source()!=='create')await music.setSource('create');if(music.source()==='queue'&&!music.songs.length){showLibrary(library,actions,'songs');toast('Add a song, or choose a studio source.')}else await music.togglePlayback()}
 if(action==='previous')await music.nextSong(-1);if(action==='next')await music.nextSong(1);
 if(action==='shuffle')music.setShuffle();if(action==='repeat')music.setRepeat();if(action==='stop-all')music.stopAll();
 if(action==='immersive')setImmersive(!immersive);
 if(action==='fullscreen'){if(document.fullscreenElement||fullscreenRequested){fullscreenRequested=false;if(document.fullscreenElement)await document.exitFullscreen();setImmersive(fullscreenPreviousImmersive)}else{fullscreenPreviousImmersive=immersive;fullscreenRequested=true;setImmersive(true);try{await document.documentElement.requestFullscreen();view?.resize?.()}catch(error){fullscreenRequested=false;setImmersive(fullscreenPreviousImmersive);throw error}}updateFullscreenButton()}
 if(action==='record-video')await view?.toggleRecording?.();
 if(action==='undo')useStore.getState().undo();if(action==='redo')useStore.getState().redo();
 if(action==='import-project'){closeModal();const files=await pickFiles();if(files.length){music.stopAll();await importFiles(files);await music.setSource('studio');useStore.getState().setMode('edit')}}
 if(action==='save-project')await saveProjectFile();
 if(action==='open-project'){const files=await pickFiles({multiple:false,accept:'.hitstudio,.bloom,application/zip'});if(files[0]){music.stopAll();await openProjectFile(files[0]);await music.setSource('studio')}}
 if(action==='export')showExport();
 if(action==='theme'){const S=useStore.getState();S.setUI({theme:S.ui.theme==='dark'?'light':'dark'});document.documentElement.dataset.theme=S.ui.theme;const b=$('[data-action=theme]');b.setAttribute('aria-label',S.ui.theme==='dark'?'Light theme':'Dark theme')}
 if(action.startsWith('task:')){music.stopAll();void music.setSource('studio');await quickTask(action.split(':')[1])}
 if(action==='command-palette'){showModal('Search actions',`<input id="action-search" placeholder="Search actions…" aria-label="Search actions" style="width:100%;margin-bottom:16px"/><div class="effect-list" id="action-results"></div>`);const list=[['New track','add-track'],['Save project','save-project'],['Open project','open-project'],['Export audio','export'],['Show welcome screen','welcome'],['Show tips','restore-tips'],['Add songs','add-songs'],['Find BPM & key','analyze'],...modes.map(([id,label])=>['Go to '+label,'mode:'+id]),...PROCESSES.map(p=>[p.label,'process:'+p.id])];const render=()=>{$('#action-results').innerHTML=list.filter(([label])=>label.toLowerCase().includes($('#action-search').value.toLowerCase())).map(([label,a])=>`<button data-command-action="${a}">${escape(label)}</button>`).join('');$$('[data-command-action]').forEach(b=>b.onclick=()=>{closeModal();if(b.dataset.commandAction.startsWith('process:'))showProcess(b.dataset.commandAction.split(':')[1]);else void runAction(b.dataset.commandAction)})};$('#action-search').oninput=render;render();$('#action-search').focus()}
if(action==='process-picker')showProcesses();
 if(action==='demo'){closeModal();music.stopAll();await loadDemoSong();await music.setSource('studio')}
 if(action==='record'){useStore.getState().setMode('edit');if(isRecording())await stopRecording();else showRecord()}
 if(action==='metronome'){const S=useStore.getState();S.setTransport({metronome:!S.transport.metronome});scheduleRender()}
 if(action==='analyze'){const S=useStore.getState(),clip=S.project.clips.find(c=>S.selection.clipIds.includes(c.id));if(!clip){toast('Select an audio clip first.');return}const buffer=buffers.get(clip.bufferId)?.buffer;if(buffer){const bpm=detectBpm(buffer),key=detectKeyInfo(buffer);showModal('BPM & key estimate',`<h2>${Math.round(bpm.bpm||bpm)} BPM</h2><p>${escape(key.label||key.key||String(key))}</p><p class="tip">Estimates can be wrong for recordings with changing tempo, speech, or ambiguous harmony.</p>`)}}
 await studioAction(action);updatePlayer();
});
document.addEventListener('click',e=>{if(e.target.closest('.player-lift')&&performance.now()<suppressLiftClickUntil)return;const tip=e.target.closest('[data-dismiss-tip]');if(tip){dismissedTips.add(tip.dataset.dismissTip);localStorage.setItem('hitstudio.dismissedTips',JSON.stringify([...dismissedTips]));updateTips();return}const toastAction=e.target.closest('[data-toast-action]');if(toastAction){useToasts.getState().toasts.find(t=>t.id===Number(toastAction.dataset.toastAction))?.action?.run();return}const mode=e.target.closest('[data-mode]');if(mode){useStore.getState().setMode(mode.dataset.mode);return}const button=e.target.closest('[data-action]');if(button)void runAction(button.dataset.action)});
const isTextTarget=target=>target?.closest('input,textarea,select,[contenteditable=true]');
window.addEventListener('keydown',e=>{
 if(e.key==='Escape'){if($('#modal').open)return;if(document.fullscreenElement){e.preventDefault();void document.exitFullscreen();return}if(immersive){e.preventDefault();setImmersive(false);return}music.stopAll();return}
 if(isTextTarget(e.target)||$('#modal').open)return;
 if(e.target.closest('.player-lift')&&(e.code==='Space'||e.key==='Enter'))return;
 const mod=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
 if(mod&&key==='k'){e.preventDefault();void runAction('command-palette');return}
 if(e.shiftKey&&e.code==='Space'&&useStore.getState().ui.mode==='create'){e.preventDefault();void runAction('create-play');return}
 if(mod&&key==='z'){e.preventDefault();void runAction(e.shiftKey?'redo':'undo');return}
 if(mod&&key==='s'){e.preventDefault();void runAction('save-project');return}
 if(mod&&key==='o'){e.preventDefault();void runAction('open-project');return}
 if(mod&&key==='e'){e.preventDefault();void runAction('export');return}
 if(mod&&key==='i'){e.preventDefault();void runAction('import-project');return}
 if(mod&&/^[1-6]$/.test(key)){e.preventDefault();useStore.getState().setMode(modes[Number(key)-1][0]);return}
 if(e.code==='Space'){e.preventDefault();void runAction('play');return}
 if(useStore.getState().ui.mode==='create'&&!mod&&!e.repeat){const i=['a','s','d','f','g','h','j','k'].indexOf(key);if(i>=0){e.preventDefault();void (async()=>{if(music.source()!=='create')await music.claimSource('create');previewMelodyRow(i)})();return}}
 if(useStore.getState().ui.mode==='dj'&&!mod&&!e.repeat){const map={z:[0,'toggle'],n:[1,'toggle'],x:[0,'cue'],b:[1,'cue'],c:[0,'sync'],v:[1,'sync']};if(key==='t'){e.preventDefault();void runAction('dj-transition');return}if(map[key]){e.preventDefault();const [i,method]=map[key];void (async()=>{if(music.source()!=='dj')await music.claimSource('dj');const d=getDJ().decks[i];if(method==='cue'){d.cueDown();d.cueUp()}else if(method==='sync')d.syncNow();else d.toggle()})();return}}
 if(useStore.getState().ui.mode==='edit'){
  if(!mod&&key==='s'){e.preventDefault();splitSelection()}
  if(key==='delete'||key==='backspace'){e.preventDefault();deleteSelection()}
  if(mod&&key==='d'){e.preventDefault();duplicateSelection()}
  if(mod&&key==='c'){e.preventDefault();copySelection()}
  if(mod&&key==='x'){e.preventDefault();copySelection(true)}
  if(mod&&key==='v'){e.preventDefault();pasteSelection()}
  if(!mod&&key==='r'){e.preventDefault();void runAction('record')}
 }
});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&fullscreenRequested){fullscreenRequested=false;setImmersive(fullscreenPreviousImmersive)}updateFullscreenButton();view?.resize?.()});
window.addEventListener('hitstudio:refresh',scheduleRender);
window.addEventListener('hashchange',()=>{const mode=location.hash.slice(1);if(modes.some(m=>m[0]===mode)&&mode!==useStore.getState().ui.mode)useStore.getState().setMode(mode)});
document.addEventListener('dragover',e=>{if(e.target.closest?.('#workspace')&&e.dataTransfer.types.includes('Files'))e.preventDefault()});
document.addEventListener('drop',safe(async e=>{if(!e.target.closest?.('#workspace')||!e.dataTransfer.files.length)return;e.preventDefault();if(useStore.getState().ui.mode==='edit'){music.stopAll();await importFiles(e.dataTransfer.files)}else{await music.addSongs(e.dataTransfer.files);showLibrary(library,actions,'songs')}}));
const initialMode=location.hash.slice(1);useStore.getState().setMode(modes.some(m=>m[0]===initialMode)?initialMode:'edit');
if(!view)renderView();
await music.restoreSongs();music.addDemoSongs();
try{await loadSounds()}catch(error){toast(String(error))}
startAutosave();updatePlayer();
document.documentElement.dataset.theme=useStore.getState().ui.theme;
startHeaderVisualizer($('.vz-mini canvas'));
registerCommand({id:'io.analyze',label:'Find BPM & key',run:()=>void runAction('analyze')});
bootReady=true;
music.openingChime();
if(localStorage.getItem('bloom.welcome.dismissed')!=='1')void welcome(actions);

let liftStart=null,suppressLiftClickUntil=0;
player.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('input,select,button:not(.player-lift)'))return;liftStart={x:e.clientX,y:e.clientY}});
window.addEventListener('pointerup',e=>{if(!liftStart)return;const dy=e.clientY-liftStart.y,dx=e.clientX-liftStart.x;liftStart=null;if(Math.abs(dy)<35||Math.abs(dy)<Math.abs(dx))return;suppressLiftClickUntil=performance.now()+400;if(dy<0)showLibrary(library,actions);else hideLibrary()});
window.addEventListener('pointercancel',()=>liftStart=null);

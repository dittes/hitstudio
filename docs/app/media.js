import { getEngine } from './core/engine.js';
import { useStore, makeTrack, makeClip } from './core/store.js';
import { buffers } from './core/buffers.js';
import { stopSeq, startSeq, usePlaying } from './features/create/sequencer.js';
import { getDJ, peekDJ } from './features/dj/engine.js';
import { useDJ } from './features/dj/state.js';
import { startJam, stopJam, useJam } from './features/jam/engine.js';
import { toast } from './core/toast.js';
import { DEMOS } from './features/dj/demoLoops.js';
import { GENERATED_DEMOS } from './features/create/songgen.js';
import { audioBufferToPcm } from './features/io/export/loudness.js';
import { encodeWav } from './features/io/export/wav.js';

export const media = new Audio();
media.preload = 'metadata';
let mediaNode = null, active = 'queue', current = -1, busy = false, loadToken = 0;
let titleOverride = '', repeat = false, shuffle = false;
export const songs = [];
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());
export const subscribeMedia = fn => { listeners.add(fn); return () => listeners.delete(fn) };
export const source = () => active;
export const currentIndex = () => current;
export const settings = () => ({ repeat, shuffle });
export const setRepeat = () => { repeat = !repeat; notify() };
export const setShuffle = () => { shuffle = !shuffle; notify() };
let dbPromise;
function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open('hitstudio-library', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  return dbPromise;
}
export async function restoreSongs() {
  try {
    const d = await db();
    const stored = await new Promise((resolve, reject) => { const r = d.transaction('songs').objectStore('songs').getAll(); r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error) });
    for (const item of stored.sort((a,b)=>(a.order||0)-(b.order||0))) songs.push({...item, url:URL.createObjectURL(item.file)});
  } catch { toast('Your browser could not restore the song library. Local files can still be added.') }
  notify();
}
async function persistSong(item) {
  try { const d=await db();const tx=d.transaction('songs','readwrite');tx.objectStore('songs').put({id:item.id,title:item.title,artist:item.artist,file:item.file,order:songs.indexOf(item)});await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=reject}) }
  catch { toast('This song is available now, but could not be saved in browser storage.') }
}
export async function addSongs(files) {
  for (const file of files) {
    if (!/^(audio|video)\//.test(file.type) && !/\.(wav|mp3|flac|m4a|aac|aif|aiff|ogg|opus|webm|mp4)$/i.test(file.name)) { toast(`Skipped ${file.name}: choose an audio or video file.`); continue }
    const item = {id:crypto.randomUUID(),title:file.name.replace(/\.[^.]+$/,''),artist:'Local file',file,url:URL.createObjectURL(file)};
    songs.push(item); await persistSong(item);
  }
  notify();
}
export async function removeSong(id) {
  const i=songs.findIndex(s=>s.id===id);if(i<0)return;
  const item=songs[i];if(current===i&&active==='queue') stopAll();
  songs.splice(i,1);if(i<current)current--;else if(i===current)current=-1;
  if(item.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);
  try {const d=await db();d.transaction('songs','readwrite').objectStore('songs').delete(id)}catch{}
  notify();
}
export function moveSong(id, direction) {
  const i=songs.findIndex(s=>s.id===id),j=i+direction;if(i<0||j<0||j>=songs.length)return;
  const selected=songs[current];[songs[i],songs[j]]=[songs[j],songs[i]];current=songs.indexOf(selected);
  songs.forEach(item=>{if(item.file)void persistSong(item)});notify();
}
export function addDemoSongs() {
  for(const demo of DEMOS) if(!songs.some(s=>s.id===demo.id)) songs.push({id:demo.id,title:demo.name.replace(' (demo)',''),artist:'HitStudio · original demo',get:demo.render});
  for(const demo of GENERATED_DEMOS) if(!songs.some(s=>s.id===demo.id)) songs.push({id:demo.id,title:demo.title,artist:'HitStudio · generated demo',get:()=>demo.render()});
  notify();
}
export function stopAll() {
  loadToken++;busy=false;media.pause();
  try{getEngine().pause()}catch{}
  stopSeq();stopJam();const dj=peekDJ();if(dj){dj.cancelAuto();dj.decks.forEach(d=>d.pause());if(dj.recording)dj.stopRecording()}
  notify();
}
export async function claimSource(next) {
  stopAll();active=next;titleOverride='';
  // The metronome is a studio tool, never a background listening source.
  if(!['studio','create'].includes(next))useStore.getState().setTransport({metronome:false});
  const e=getEngine();await e.resume();
  if(!mediaNode){mediaNode=e.ctx.createMediaElementSource(media);mediaNode.connect(e.externalInput)}
  notify();
}
export function isPlaying() {
  if(active==='studio')return useStore.getState().transport.playing;
  if(active==='create')return usePlaying.getState().playing;
  if(active==='dj')return useDJ.getState().decks.some(d=>d.playing);
  if(active==='jam')return useJam.getState().playing;
  return !media.paused;
}
export function nowPlaying() {
  if(active==='studio')return useStore.getState().project.name;
  if(active==='create')return 'Beat Maker · live pattern';
  if(active==='dj')return useDJ.getState().decks.filter(d=>d.playing).map(d=>d.title).join(' + ')||'DJ decks';
  if(active==='jam'){const j=useJam.getState();return j.playing&&j.title?`Jam band · ${j.title}`:'Jam band'}
  return titleOverride || songs[current]?.title || 'Choose your next song';
}
export function currentDuration() { return Number.isFinite(media.duration)?media.duration:0 }
export function isBusy(){return busy}
export async function playSong(index) {
  const item=songs[index];if(!item)return;
  await claimSource('queue');const token=loadToken;current=index;busy=true;notify();
  try {
    if(!item.url && item.get){const buffer=await item.get();const blob=encodeWav(audioBufferToPcm(buffer),16);item.url=URL.createObjectURL(blob)}
    if(token!==loadToken)return;
    media.crossOrigin='anonymous';media.src=item.url;media.load();await media.play();
  } catch(error){if(token===loadToken)toast({title:'Could not play this song',body:String(error),kind:'error'})}
  finally{if(token===loadToken){busy=false;notify()}}
}
export async function nextSong(direction=1) {
  if(!songs.length){toast('Add songs to your list first.');return}
  let index=shuffle?Math.floor(Math.random()*songs.length):(current+direction+songs.length)%songs.length;
  if(shuffle&&songs.length>1&&index===current)index=(index+1)%songs.length;
  await playSong(index);
}
export async function togglePlayback() {
  if(isPlaying()){
    if(active==='studio')getEngine().pause();else if(active==='create')stopSeq();else if(active==='dj')peekDJ()?.decks.forEach(d=>d.pause());else if(active==='jam')stopJam();else media.pause();
    notify();return;
  }
  if(active==='studio'){await claimSource('studio');await getEngine().play();}
  else if(active==='create'){await claimSource('create');await startSeq()}
  else if(active==='jam'){await claimSource('jam');await startJam()}
  else if(active==='dj'){const dj=getDJ();await claimSource('dj');if(!useDJ.getState().decks.some(d=>d.itemId))throw new Error('Load a song onto a DJ deck first.');for(const d of dj.decks)if(d.st.itemId)d.toggle()}
  else if(active==='queue'){
    if(current<0||!media.src||media.ended)await playSong(current<0?0:current);
    else{const token=loadToken;await getEngine().resume();if(token===loadToken)await media.play()}
  } else if(active==='radio'){await getEngine().resume();await media.play()}
  else await playSong(current<0?0:current);
  notify();
}
export async function setSource(next){await claimSource(next)}
export async function songToProject(id){
  const item=songs.find(s=>s.id===id);if(!item)return;
  let data;if(item.file)data=await item.file.arrayBuffer();else {if(!item.url){const b=await item.get();item.url=URL.createObjectURL(encodeWav(audioBufferToPcm(b),16))}data=await (await fetch(item.url)).arrayBuffer()}
  const entry=await buffers.decode(data,item.title);
  const S=useStore.getState();S.mutate('Add song to timeline',p=>{const t=makeTrack(p,{name:item.title});p.tracks.push(t);p.clips.push(makeClip({trackId:t.id,bufferId:entry.id,duration:entry.buffer.duration,name:item.title}))});
  useStore.getState().setMode('edit');await claimSource('studio');toast('Added to the timeline. Your song list is unchanged.');
}
export async function playRadio(url,title='Internet radio'){
  const parsed=new URL(url);if(parsed.protocol!=='https:')throw Error('Use a direct HTTPS audio stream URL.');
  await claimSource('radio');titleOverride=title;media.crossOrigin='anonymous';media.src=parsed.href;media.load();await media.play();notify();
}
export async function welcomeSound(){const expected=loadToken+1;await claimSource('jingle');if(expected!==loadToken||active!=='jingle')return;titleOverride='HitStudio · welcome ident';media.src=new URL('../assets/brand/hitstudio-welcome.mp3',import.meta.url).href;media.load();await media.play();notify()}
media.addEventListener('ended',()=>{
  if(active==='queue'){if(repeat){media.currentTime=0;void media.play().catch(()=>{})}else if(shuffle||current<songs.length-1)void nextSong()}
  else if(active==='jingle'){active='queue';titleOverride='';media.removeAttribute('src');media.load()}
  notify();
});
for(const event of ['play','pause','loadedmetadata','waiting','playing'])media.addEventListener(event,notify);
media.addEventListener('error',()=>{if(media.src){toast(active==='radio'?'This stream could not be played or analyzed. The station may block cross-origin audio; try a different HTTPS stream.':'This audio could not be decoded by your browser.');busy=false;notify()}});

/** One opening ident. Autoplay restrictions fall back to the first non-playback gesture. */
export function openingChime(){
 if(localStorage.getItem('hitstudio.chime')==='0')return;
 let done=false;
 let pendingToken=loadToken;
 const playbackTarget=target=>!!target?.closest?.('[data-song-play],[data-action="play"],[data-action="record"],[data-action="create-play"],[data-dj-play],#audio-source,#seek');
 const attempt=async gesture=>{
  if(done)return;
  if(loadToken!==pendingToken){done=true;remove();return}
  const engine=getEngine();
  if(engine.ctx.state!=='running'&&!gesture){void engine.ctx.resume().then(()=>attempt(false)).catch(()=>{});return}
  done=true;remove();
  try{await welcomeSound()}catch(error){if(error.name==='NotAllowedError'&&active==='jingle'){pendingToken=loadToken;done=false;arm()}else console.warn('Opening ident could not play',error)}
 };
 const interact=e=>{if(playbackTarget(e.target)||e.code==='Space'||e.key==='r'){done=true;remove();return}void attempt(true)};
 function arm(){window.addEventListener('pointerdown',interact,{capture:true});window.addEventListener('keydown',interact,{capture:true})}
 function remove(){window.removeEventListener('pointerdown',interact,true);window.removeEventListener('keydown',interact,true)}
 arm();void attempt(false);
}

// A brief, quiet section accent, separate from music and recording buses.
let sectionVoice=null;
export async function sectionSound(){
 try{
  if(localStorage.getItem('hitstudio.uisounds')==='0')return;
  const ctx=getEngine().ctx;
  if(ctx.state!=='running')return;
  sectionVoice?.stop();
  const voice=ctx.createOscillator(),gain=ctx.createGain(),at=ctx.currentTime;
  sectionVoice=voice;voice.type='sine';voice.frequency.setValueAtTime(880,at);voice.frequency.exponentialRampToValueAtTime(1320,at+.055);
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.018,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+.085);
  voice.connect(gain).connect(ctx.destination);voice.start(at);voice.stop(at+.09);voice.onended=()=>{voice.disconnect();gain.disconnect();if(sectionVoice===voice)sectionVoice=null};
 }catch{/* Navigation never depends on UI audio. */}
}

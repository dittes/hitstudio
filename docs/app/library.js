import { $, icon, escape } from './dom.js';
import * as music from './media.js';
import { toast } from './core/toast.js';
let tab='songs',query='',open=false;
let currentContainer,callbacks,closeTimer=0;
function syncLift(){const b=document.querySelector('.player-lift');if(b){b.setAttribute('aria-expanded',String(open));b.setAttribute('aria-label',open?'Slide down to close library':'Slide up to open library')}}

/** Stations that publish a free public listener stream. Played straight from the station; never recorded or re-broadcast. */
export const STATIONS=[
 {id:'rp-main',name:'Radio Paradise',tag:'Eclectic mix',blurb:'Hand-picked rock, world, electronic and more, with no algorithm.',url:'https://stream.radioparadise.com/mp3-128',site:'https://radioparadise.com',hue:265},
 {id:'rp-mellow',name:'RP Mellow Mix',tag:'Chill',blurb:'Gentle, atmospheric tracks for focus and evenings.',url:'https://stream.radioparadise.com/mellow-128',site:'https://radioparadise.com',hue:200},
 {id:'rp-rock',name:'RP Rock Mix',tag:'Rock',blurb:'Classic and contemporary rock from the same curators.',url:'https://stream.radioparadise.com/rock-128',site:'https://radioparadise.com',hue:10},
 {id:'rp-global',name:'RP Global Mix',tag:'World',blurb:'Music from every corner of the planet.',url:'https://stream.radioparadise.com/global-128',site:'https://radioparadise.com',hue:150},
 {id:'kexp',name:'KEXP 90.3',tag:'Indie · Seattle',blurb:'Listener-supported radio with DJs who really love music.',url:'https://kexp.streamguys1.com/kexp160.aac',site:'https://www.kexp.org',hue:330},
 {id:'dublab',name:'dublab',tag:'Los Angeles',blurb:'Independent, community-driven radio for experimental sounds.',url:'https://dublab.out.airtime.pro/dublab_a',site:'https://www.dublab.com',hue:300},
];
const hueOf=text=>[...text].reduce((h,c)=>(h*31+c.charCodeAt(0))%360,7);
const stationPlaying=st=>music.source()==='radio'&&music.isPlaying()&&music.media.src.startsWith(st.url.split('?')[0]);
export const isLibraryOpen=()=>open;
export function showLibrary(container,actions,nextTab){currentContainer=container;callbacks=actions;if(nextTab)tab=nextTab;open=true;clearTimeout(closeTimer);container.hidden=false;syncLift();requestAnimationFrame(()=>{if(open)container.classList.add('sheet-visible')});document.querySelector('#app').classList.add('drawer-open');renderLibrary()}
export function hideLibrary(){open=false;syncLift();currentContainer?.classList.remove('sheet-visible');document.querySelector('#app').classList.remove('drawer-open');closeTimer=setTimeout(()=>{if(!open&&currentContainer)currentContainer.hidden=true},280)}
export function toggleLibrary(container,actions){open?hideLibrary():showLibrary(container,actions)}
export function renderLibrary(){
 if(!open||!currentContainer)return;const container=currentContainer;
 const items=music.songs.filter(s=>(s.title+' '+s.artist).toLowerCase().includes(query.toLowerCase()));
 const songsHTML=()=>{
  const rows=items.map(item=>{const i=music.songs.indexOf(item),current=music.currentIndex()===i&&music.source()==='queue',playing=current&&music.isPlaying();
   return `<div class="song-row ${current?'current':''} ${playing?'playing':''}" draggable="true" data-song-id="${escape(item.id)}" title="Drag onto a DJ deck to load it"><button class="song-cover" style="--h:${hueOf(item.title)}" data-song-play="${i}" aria-label="${playing?'Pause':'Play'} ${escape(item.title)}"><span class="song-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="song-glyph">${icon(playing?'pause':'play')}</span></button><div class="song-info"><strong title="${escape(item.title)}">${escape(item.title)}</strong><small>${escape(item.artist)}</small></div><button class="song-menu" data-song-menu="${escape(item.id)}" aria-label="Options for ${escape(item.title)}">${icon('settings')}</button></div>`}).join('');
  return `<div class="lib-bar"><label class="lib-search">${icon('search')}<input class="library-search" placeholder="Search your songs" aria-label="Search your songs" value="${escape(query)}" /></label><button class="primary" data-action="add-songs">${icon('plus')}<span>Add songs</span></button><button data-action="add-demos">Demos</button></div>${rows?`<div class="song-list">${rows}</div><p class="lib-note">Drag to reorder, or drop a song onto a DJ deck. Your files stay on this device.</p>`:`<div class="lib-empty"><div class="lib-empty-orb">${icon('library')}</div><b>${query?'No songs match':'Your song list is empty'}</b><span>${query?'Try another search.':'Add audio files or load the original demos to get started.'}</span></div>`}`};
 const radioHTML=()=>`<div class="station-grid">${STATIONS.map(st=>{const on=stationPlaying(st);return `<div class="station ${on?'on':''}" style="--h:${st.hue}"><button class="station-play" data-station="${st.id}" aria-label="${on?'Pause':'Play'} ${escape(st.name)}"><span class="station-art"><span class="song-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="song-glyph">${icon(on?'pause':'play')}</span></span><span class="station-text"><b>${escape(st.name)}</b><small>${escape(st.tag)}</small></span></button><p>${escape(st.blurb)}</p><a href="${escape(st.site)}" target="_blank" rel="noopener noreferrer">Station website ${icon('arrow')}</a></div>`}).join('')}</div>
  <details class="lib-custom"><summary>Use your own stream</summary><form id="radio-form" class="stack"><input type="url" required placeholder="https://…/stream.mp3" aria-label="Radio stream URL" /><input type="text" placeholder="Station name (optional)" aria-label="Station name" /><button class="primary" type="submit">${icon('radio')} Play stream</button></form><small>Only use streams you are allowed to listen to. The station must allow browser playback for the visualizer to react.</small></details>
  <p class="lib-note">These stations offer free public listener streams. HitStudio plays them directly from the station, never records or re-broadcasts them, and the visualizer only listens. Please support the stations you enjoy.</p>`;
 container.innerHTML=`<div class="library-head"><div><div class="eyebrow">Keep the music going</div><h2>Library</h2></div><button class="icon" data-action="close-library" aria-label="Close library">${icon('close')}</button></div><div class="lib-tabs" role="tablist" aria-label="Library">${['songs','radio'].map(t=>`<button role="tab" aria-selected="${tab===t}" data-library-tab="${t}" class="${tab===t?'active':''}">${icon(t==='songs'?'song':'radio')}<span>${t==='songs'?'Songs':'Live radio'}</span></button>`).join('')}</div>${tab==='songs'?songsHTML():radioHTML()}`;
 $('.library-search',container)?.addEventListener('input',e=>{query=e.target.value;const position=e.target.selectionStart;renderLibrary();const input=$('.library-search',container);input.focus();input.setSelectionRange(position,position)});
 container.onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{
  if(b.dataset.libraryTab){tab=b.dataset.libraryTab;query='';renderLibrary()}
  if(b.dataset.songPlay!==undefined){const i=Number(b.dataset.songPlay);if(i===music.currentIndex()&&music.source()==='queue')await music.togglePlayback();else await music.playSong(i)}
  if(b.dataset.songMenu)callbacks.songMenu(b.dataset.songMenu);
  if(b.dataset.station){const st=STATIONS.find(s=>s.id===b.dataset.station);if(stationPlaying(st))await music.togglePlayback();else await music.playRadio(st.url,st.name)}
 }catch(error){toast({title:'That stream could not be played',body:'The station may be offline or blocking browser playback.',kind:'error'})}};
 $('#radio-form',container)?.addEventListener('submit',async e=>{e.preventDefault();const [url,name]=[...e.target.querySelectorAll('input')].map(i=>i.value);try{await music.playRadio(url,name||'Internet radio')}catch(error){toast(String(error))}});
 container.ondragstart=e=>{const row=e.target.closest('[data-song-id]');if(row){e.dataTransfer.setData('application/x-hitstudio-song',row.dataset.songId);e.dataTransfer.effectAllowed='copyMove'}};
 container.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-hitstudio-song'))e.preventDefault()};
 container.ondrop=e=>{const id=e.dataTransfer.getData('application/x-hitstudio-song'),target=e.target.closest('[data-song-id]');if(!id||!target)return;e.preventDefault();const from=music.songs.findIndex(s=>s.id===id),to=music.songs.findIndex(s=>s.id===target.dataset.songId);if(from<0||to<0)return;for(let n=0;n<Math.abs(to-from);n++)music.moveSong(id,Math.sign(to-from));renderLibrary()};
}
music.subscribeMedia(()=>{if(open)renderLibrary()});

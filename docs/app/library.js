import { $, icon, escape } from './dom.js';
import * as music from './media.js';
import { toast } from './core/toast.js';
let source='all',query='',open=false;
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
export function showLibrary(container,actions,nextTab){currentContainer=container;callbacks=actions;if(nextTab)source=nextTab==='songs'?'all':nextTab;open=true;clearTimeout(closeTimer);container.hidden=false;syncLift();requestAnimationFrame(()=>{if(open)container.classList.add('sheet-visible')});document.querySelector('#app').classList.add('drawer-open');renderLibrary()}
export function hideLibrary(){open=false;syncLift();currentContainer?.classList.remove('sheet-visible');document.querySelector('#app').classList.remove('drawer-open');closeTimer=setTimeout(()=>{if(!open&&currentContainer)currentContainer.hidden=true},280)}
export function toggleLibrary(container,actions){open?hideLibrary():showLibrary(container,actions)}
const SOURCES={
 all:{label:'All songs',icon:'library',group:'Your music',blurb:'Everything in your list'},
 files:{label:'My files',icon:'folder',group:'Your music',blurb:'Songs you added from this device'},
 demos:{label:'Demos',icon:'sparkles',group:'Your music',blurb:'Original songs made by HitStudio'},
 radio:{label:'Live radio',icon:'radio',group:'Listen live',blurb:'Free public streams, played straight from the station'},
};
const isDemo=item=>!item.file;
const inSource=item=>source==='all'||(source==='files'&&!isDemo(item))||(source==='demos'&&isDemo(item));
const countOf=id=>id==='radio'?STATIONS.length:music.songs.filter(s=>id==='all'||(id==='files'&&!isDemo(s))||(id==='demos'&&isDemo(s))).length;

export function renderLibrary(){
 if(!open||!currentContainer)return;const container=currentContainer;
 if(!SOURCES[source])source='all';
 const info=SOURCES[source],isRadio=source==='radio';
 const q=query.toLowerCase();
 const songs=music.songs.filter(s=>inSource(s)&&(s.title+' '+s.artist).toLowerCase().includes(q));
 const stations=STATIONS.filter(st=>(st.name+' '+st.tag+' '+st.blurb).toLowerCase().includes(q));
 const queueActive=music.source()==='queue',curIdx=music.currentIndex();
 const songIdx=songs.map(s=>music.songs.indexOf(s));
 const listPlaying=isRadio?stations.some(stationPlaying):queueActive&&songIdx.includes(curIdx)&&music.isPlaying();
 const nav=['Your music','Listen live'].map(group=>`<div class="pl-group"><span class="pl-group-title">${group}</span>${Object.entries(SOURCES).filter(([,v])=>v.group===group).map(([id,v])=>`<button class="pl-src ${id===source?'on':''}" data-source="${id}" aria-pressed="${id===source}">${icon(v.icon)}<span>${v.label}</span><em>${countOf(id)}</em></button>`).join('')}</div>`).join('');
 const songRows=songs.map((item,n)=>{const i=music.songs.indexOf(item),current=queueActive&&curIdx===i,playing=current&&music.isPlaying();
  return `<div class="pl-row ${current?'current':''} ${playing?'playing':''}" draggable="true" data-song-id="${escape(item.id)}" title="Drag onto a DJ deck to load it"><button class="pl-play" data-song-play="${i}" aria-label="${playing?'Pause':'Play'} ${escape(item.title)}"><span class="pl-num">${n+1}</span><span class="pl-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="pl-glyph">${icon(playing?'pause':'play')}</span></button><button class="pl-info" data-song-play="${i}"><strong title="${escape(item.title)}">${escape(item.title)}</strong><small>${escape(item.artist)}</small></button><span class="pl-tag">${isDemo(item)?'Demo':'File'}</span><button class="pl-menu" data-song-menu="${escape(item.id)}" aria-label="Options for ${escape(item.title)}">${icon('settings')}</button></div>`}).join('');
 const stationRows=stations.map((st,n)=>{const on=stationPlaying(st);
  return `<div class="pl-row ${on?'current playing':''}" style="--h:${st.hue}"><button class="pl-play" data-station="${st.id}" aria-label="${on?'Pause':'Play'} ${escape(st.name)}"><span class="pl-num">${n+1}</span><span class="pl-eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="pl-glyph">${icon(on?'pause':'play')}</span></button><button class="pl-info" data-station="${st.id}"><strong>${escape(st.name)}</strong><small>${escape(st.tag)} · ${escape(st.blurb)}</small></button><span class="pl-tag live">Live</span><a class="pl-menu pl-link" href="${escape(st.site)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(st.name)} website" title="Station website">${icon('arrow')}</a></div>`}).join('');
 const empty=isRadio?`<div class="lib-empty"><div class="lib-empty-orb">${icon('radio')}</div><b>No stations match</b><span>Try another search.</span></div>`:`<div class="lib-empty"><div class="lib-empty-orb">${icon(info.icon)}</div><b>${query?'No songs match':source==='files'?'No files yet':source==='demos'?'No demos loaded':'Your song list is empty'}</b><span>${query?'Try another search.':source==='demos'?'Load the original demos to listen right away.':'Add audio files or load the original demos to get started.'}</span><div class="lib-empty-actions"><button class="primary" data-action="add-songs">${icon('plus')}<span>Add songs</span></button><button data-action="add-demos">Load demos</button></div></div>`;
 const rows=isRadio?stationRows:songRows,count=isRadio?stations.length:songs.length;
 container.innerHTML=`<div class="pl">
  <aside class="pl-nav" aria-label="Library sources"><div class="pl-nav-head"><span class="eyebrow">Keep the music going</span><h2>Library</h2></div>${nav}</aside>
  <section class="pl-main" aria-label="${escape(info.label)}">
   <header class="pl-head"><div class="pl-cover">${icon(info.icon)}</div><div class="pl-title"><span class="eyebrow">${isRadio?'Live':'Playlist'}</span><h3>${escape(info.label)}</h3><small>${count} ${isRadio?'station':'song'}${count===1?'':'s'} · ${escape(info.blurb)}</small></div>
    <div class="pl-actions">${rows?`<button class="primary pl-playall" data-pl-playall>${icon(listPlaying?'pause':'play')}<span>${listPlaying?'Pause':'Play'}</span></button>`:''}${isRadio?'':`<button class="pl-shuffle" data-pl-shuffle aria-pressed="${music.settings().shuffle}" title="Shuffle">${icon('shuffle')}</button><button data-action="add-songs" class="pl-add" title="Add songs">${icon('plus')}<span>Add</span></button>`}<button class="icon pl-close" data-action="close-library" aria-label="Close library">${icon('close')}</button></div></header>
   <label class="lib-search pl-search">${icon('search')}<input class="library-search" placeholder="Search ${escape(info.label.toLowerCase())}" aria-label="Search" value="${escape(query)}" /></label>
   <div class="pl-list" role="list">${rows||empty}
    ${isRadio?`<details class="lib-custom"><summary>Use your own stream</summary><form id="radio-form" class="stack"><input type="url" required placeholder="https://…/stream.mp3" aria-label="Radio stream URL" /><input type="text" placeholder="Station name (optional)" aria-label="Station name" /><button class="primary" type="submit">${icon('radio')} Play stream</button></form><small>Only use streams you are allowed to listen to. The station must allow browser playback for the visualizer to react.</small></details><p class="lib-note">These stations offer free public listener streams. HitStudio plays them directly from the station, never records or re-broadcasts them, and the visualizer only listens. Please support the stations you enjoy.</p>`:rows?`<p class="lib-note">Drag to reorder, or drop a song onto a DJ deck. Your files stay on this device.</p>`:''}</div>
  </section></div>`;
 $('.library-search',container)?.addEventListener('input',e=>{query=e.target.value;const position=e.target.selectionStart;renderLibrary();const input=$('.library-search',container);input.focus();input.setSelectionRange(position,position)});
 container.onclick=async e=>{const b=e.target.closest('button');if(!b)return;try{
  if(b.dataset.source){source=b.dataset.source;query='';renderLibrary();return}
  if(b.dataset.songPlay!==undefined){const i=Number(b.dataset.songPlay);if(i===music.currentIndex()&&music.source()==='queue')await music.togglePlayback();else await music.playSong(i)}
  if(b.dataset.songMenu)callbacks.songMenu(b.dataset.songMenu);
  if(b.dataset.station){const st=STATIONS.find(s=>s.id===b.dataset.station);if(stationPlaying(st))await music.togglePlayback();else await music.playRadio(st.url,st.name)}
  if('plPlayall'in b.dataset){
   if(listPlaying){await music.togglePlayback();return}
   if(isRadio){const st=stations.find(stationPlaying)||stations[0];if(st)await music.playRadio(st.url,st.name)}
   else if(songIdx.length){if(queueActive&&songIdx.includes(curIdx))await music.togglePlayback();else await music.playSong(songIdx[0])}}
  if('plShuffle'in b.dataset){music.setShuffle();renderLibrary()}
 }catch(error){toast({title:'That could not be played',body:'The stream may be offline or blocking browser playback.',kind:'error'})}};
 $('#radio-form',container)?.addEventListener('submit',async e=>{e.preventDefault();const [url,name]=[...e.target.querySelectorAll('input')].map(i=>i.value);try{await music.playRadio(url,name||'Internet radio')}catch(error){toast(String(error))}});
 container.ondragstart=e=>{const row=e.target.closest('[data-song-id]');if(row){e.dataTransfer.setData('application/x-hitstudio-song',row.dataset.songId);e.dataTransfer.effectAllowed='copyMove'}};
 container.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-hitstudio-song'))e.preventDefault()};
 container.ondrop=e=>{const id=e.dataTransfer.getData('application/x-hitstudio-song'),target=e.target.closest('[data-song-id]');if(!id||!target)return;e.preventDefault();const from=music.songs.findIndex(s=>s.id===id),to=music.songs.findIndex(s=>s.id===target.dataset.songId);if(from<0||to<0)return;for(let n=0;n<Math.abs(to-from);n++)music.moveSong(id,Math.sign(to-from));renderLibrary()};
}
music.subscribeMedia(()=>{if(open)renderLibrary()});

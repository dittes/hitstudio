import {spectralHistory} from './spectral-history.js';
import {heatColor} from './advanced-scenes.js';
import {SPECTRAL_BINS as B,DENSITY_LEVELS as L} from './spectral-model.js';
/** The actual measured history, rendered small; no decorative fake analysis. */
export function paintAnalysisPreviews(root,colors,seconds){
 const history=spectralHistory(),cols=history.imageColumns(seconds,112);
 for(const canvas of root.querySelectorAll('canvas[data-analysis-preview]')){const g=canvas.getContext('2d'),id=canvas.dataset.analysisPreview,w=112,h=48;canvas.width=w;canvas.height=h;const image=g.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=0;if(id==='density')v=Math.min(1,Math.sqrt(history.density[Math.min(B-1,Math.floor(x/w*B))*L+Math.min(L-1,Math.floor((1-y/h)*(L-1)))])*2.7);else{const column=id==='waterfall'?cols[Math.min(111,Math.floor((1-y/h)*111))]:cols[x],bin=id==='waterfall'?Math.floor(x/w*(B-1)):Math.floor((1-y/h)*(B-1));if(column>=0)v=history.frames[column*B+bin]}const c=heatColor(v,colors),i=(y*w+x)*4;image.data[i]=c[0];image.data[i+1]=c[1];image.data[i+2]=c[2];image.data[i+3]=255}g.putImageData(image,0,0);
  if(!history.current.some(v=>v>.01)){g.fillStyle='#c8c2d9';g.font='9px system-ui';g.textAlign='center';g.fillText('Waiting for audio',w/2,h/2+3)}
 }
}

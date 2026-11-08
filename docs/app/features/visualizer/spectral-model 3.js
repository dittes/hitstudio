/** Rolling, measured FFT frames. No synthetic idle signal enters this model. */
export const SPECTRAL_BINS=256, SPECTRAL_COLUMNS=900, DENSITY_LEVELS=80;
export const MIN_DB=-100, MAX_DB=-10, MIN_HZ=20;
export class SpectralHistory{
 constructor(){this.frames=new Float32Array(SPECTRAL_BINS*SPECTRAL_COLUMNS);this.times=new Float64Array(SPECTRAL_COLUMNS);this.current=new Float32Array(SPECTRAL_BINS);this.peaks=new Float32Array(SPECTRAL_BINS);this.density=new Float32Array(SPECTRAL_BINS*DENSITY_LEVELS);this.head=0;this.count=0;this.revision=0;this.maxHz=20000;this.lastTime=0;this.sampleRate=48000;this.fftSize=8192}
 clear(){this.frames.fill(0);this.times.fill(0);this.current.fill(0);this.peaks.fill(0);this.density.fill(0);this.head=0;this.count=0;this.lastTime=0;this.revision++}
 push(db,time,sampleRate,fftSize){
  if(this.count&&time-this.lastTime<1/30-.001)return false;
  if(this.count&&time-this.lastTime>1)this.clear();
  const dt=this.count?Math.max(0,time-this.lastTime):1/30;this.sampleRate=sampleRate;this.fftSize=fftSize;this.maxHz=Math.min(20000,sampleRate/2);const ratio=this.maxHz/MIN_HZ,binHz=sampleRate/fftSize;
  const decay=Math.exp(-dt/2.5);for(let i=0;i<this.density.length;i++)this.density[i]*=decay;
  for(let i=0;i<SPECTRAL_BINS;i++){
   const low=MIN_HZ*ratio**(i/SPECTRAL_BINS),high=MIN_HZ*ratio**((i+1)/SPECTRAL_BINS),lo=Math.max(1,Math.floor(low/binHz)),hi=Math.min(db.length,Math.max(lo+1,Math.ceil(high/binHz)));let peak=-Infinity;
   for(let k=lo;k<hi;k++)peak=Math.max(peak,db[k]);const value=Number.isFinite(peak)?Math.max(0,Math.min(1,(peak-MIN_DB)/(MAX_DB-MIN_DB))):0;
   this.current[i]=value;this.frames[this.head*SPECTRAL_BINS+i]=value;this.peaks[i]=Math.max(value,this.peaks[i]-dt*.12);
   if(value>0)this.density[i*DENSITY_LEVELS+Math.min(DENSITY_LEVELS-1,Math.floor(value*DENSITY_LEVELS))]+=1-decay;
  }
  this.times[this.head]=time;this.head=(this.head+1)%SPECTRAL_COLUMNS;this.count=Math.min(SPECTRAL_COLUMNS,this.count+1);this.lastTime=time;this.revision++;return true;
 }
 /** Regrid timestamps onto a wall-clock time axis; missing samples remain blank. */
 imageColumns(seconds,width=360){const out=new Int32Array(width);out.fill(-1);if(!this.count)return out;let cursor=0;const oldest=(this.head-this.count+SPECTRAL_COLUMNS)%SPECTRAL_COLUMNS;
  for(let x=0;x<width;x++){const target=this.lastTime-seconds+(x+.5)/width*seconds;while(cursor<this.count-1&&this.times[(oldest+cursor+1)%SPECTRAL_COLUMNS]<=target)cursor++;const index=(oldest+cursor)%SPECTRAL_COLUMNS;if(target>=this.times[index]&&target-this.times[index]<.14)out[x]=index}return out;
 }
}

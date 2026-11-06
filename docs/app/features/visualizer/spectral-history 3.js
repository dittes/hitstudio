import {getEngine} from '../../core/engine.js';
import {SpectralHistory} from './spectral-model.js';
const history=new SpectralHistory();let source=null,analyser=null,data=null,lastRead=-Infinity;
export function clearSpectralHistory(){history.clear();lastRead=-Infinity}
export function spectralHistory(){
 const engine=getEngine(),next=engine.masterAnalyser,now=performance.now()/1000;
 if(source!==next){if(source&&analyser)try{source.disconnect(analyser)}catch{}source=next;analyser=engine.ctx.createAnalyser();analyser.fftSize=8192;analyser.smoothingTimeConstant=0;analyser.minDecibels=-100;analyser.maxDecibels=-10;source.connect(analyser);data=new Float32Array(analyser.frequencyBinCount);clearSpectralHistory()}
 if(now-lastRead>=1/30-.001){lastRead=now;if(engine.ctx.state==='running')analyser.getFloatFrequencyData(data);else data.fill(-Infinity);history.push(data,now,engine.ctx.sampleRate,analyser.fftSize)}
 return history;
}

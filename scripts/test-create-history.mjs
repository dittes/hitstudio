// Create-mode undo/redo: steps, grouped drags, coalescing, redo invalidation and the output stage headroom.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){if(specifier==='immer')return {url:new URL('../vendor/immer.mjs',import.meta.url).href,shortCircuit:true};return next(specifier,context)}});
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};globalThis.window=globalThis;
const {useCreate,useCreateHistory,createEdit,createUndo,createRedo}=await import('../app/features/create/state.js');
const grid=()=>useCreate.getState().drums.grid.perc;
const hist=()=>useCreateHistory.getState();

useCreate.getState().resetAll();
assert.deepEqual([hist().past,hist().future],[0,0],'fresh history is empty');
const start=grid()[0];

// single edit, undo, redo
createEdit(s=>{s.drums.grid.perc[0]=start>0?0:.8});
assert.equal(hist().past,1);
assert.notEqual(grid()[0],start);
assert.equal(createUndo(),true);assert.equal(grid()[0],start);assert.equal(hist().future,1);
assert.equal(createRedo(),true);assert.notEqual(grid()[0],start);
createUndo();

// one drag = one undo step
const before=[...grid()];
for(let i=1;i<=6;i++)createEdit(s=>{s.drums.grid.perc[i]=.8},{group:'drag-1'});
assert.equal(hist().past,1,'a grouped drag is one step');
createUndo();assert.deepEqual([...grid()],before,'undo reverts the whole drag');

// a new edit clears redo
createEdit(s=>{s.drums.grid.perc[2]=.8});createUndo();assert.equal(hist().future,1);
createEdit(s=>{s.drums.grid.perc[3]=.8});assert.equal(hist().future,0,'new edits drop the redo stack');
createUndo();

// coalescing merges quick repeated edits of the same kind
useCreate.getState().resetAll();const swing0=useCreate.getState().drums.swing;
createEdit(s=>{s.drums.swing=.1},{coalesce:'swing'});createEdit(s=>{s.drums.swing=.2},{coalesce:'swing'});createEdit(s=>{s.drums.swing=.3},{coalesce:'swing'});
assert.equal(hist().past,1);createUndo();assert.equal(useCreate.getState().drums.swing,swing0);

// nothing to undo / redo
assert.equal(createUndo(),false);
useCreate.getState().resetAll();assert.equal(createRedo(),false);

// the output stage: reverb tail, glue, headroom and a limiter before the destination
const {createOutputStage}=await import('../app/features/create/synth/mix.js');
const edges=[];let id=0;
const node=(type)=>({type,id:id++,gain:{value:1},threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0},connect(n){edges.push([this,n]);return n}});
const channels=[];
const ctx={sampleRate:8000,createGain:()=>node('gain'),createDynamicsCompressor:()=>node('compressor'),createConvolver:()=>node('convolver'),createBuffer:(ch,len)=>({getChannelData:(c)=>(channels[c]??=new Float32Array(len))})};
const dest=node('dest');
const stage=createOutputStage(ctx,dest);
const reach=(from,to,seen=new Set())=>from===to||(!seen.has(from)&&(seen.add(from),edges.filter(([a])=>a===from).some(([,b])=>reach(b,to,seen))));
assert.ok(reach(stage.input,dest),'parts reach the destination');
assert.ok(reach(stage.reverbIn,stage.input),'the reverb returns into the mix');
const lim=edges.find(([,b])=>b===dest)[0];
assert.equal(lim.type,'compressor');assert.ok(lim.ratio.value>=10&&lim.threshold.value<0,'a limiter sits right before the destination');
const trim=edges.find(([a,b])=>a.type==='compressor'&&b.type==='gain')[1];
assert.ok(trim.gain.value<0.7&&trim.gain.value>0.4,'headroom for four summed parts');
const ir=channels[0],q=Math.floor(ir.length/4);const energy=(from,to)=>{let e=0;for(let i=from;i<to;i++)e+=ir[i]*ir[i];return e};
assert.ok(energy(0,q)>energy(ir.length-q,ir.length)*20,'the reverb tail decays');
console.log('Create history: steps, grouped drags, coalescing, redo invalidation and output stage passed.');

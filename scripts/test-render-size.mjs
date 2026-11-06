import assert from 'node:assert/strict';
import {renderSize} from '../app/features/visualizer/render-size.js';
for(const [width,height,dpr]of [[3840,2160,2],[7680,4320,2],[1710,1074,1],[1208,600,2],[317,656,1]]){const r=renderSize(width,height,dpr);assert.ok(r.width*r.height*r.pixelRatio**2<=1_800_001);assert.equal(r.width/r.height,width/height);assert.ok(r.pixelRatio>0)}
assert.equal(renderSize(0,0,2),null);assert.equal(renderSize(100,0,2),null);
for(const resolution of [{width:1920,height:1080},{width:1080,height:1920},{width:1080,height:1080}]){const r=renderSize(1,1,2,resolution);assert.equal(r.width,resolution.width);assert.equal(r.height,resolution.height);assert.equal(r.pixelRatio,1)}
assert.deepEqual(renderSize(1208,600,1),renderSize(1208,600,1));
console.log('Preview sizes stay within the GPU pixel budget, transient zero sizes are ignored, and exports retain exact dimensions.');

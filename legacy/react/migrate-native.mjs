import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
const root=process.cwd();
async function walk(dir){const out=[];for(const item of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())out.push(...await walk(p));else out.push(p)}return out}
for(const file of await walk('src')){
 if(!file.endsWith('.ts')||file.endsWith('.d.ts'))continue;
 const target=file.replace(/^src\//,'app/').replace(/\.ts$/,'.js');
 let code=stripTypeScriptTypes(await readFile(file,'utf8'),{mode:'strip'});
 const store=path.relative(path.dirname(target),'app/lib/state.js').replaceAll('\\','/');
 code=code.replaceAll("from 'zustand'",`from '${store.startsWith('.')?store:'./'+store}'`);
 code=code.replace(/((?:from\s*|import\s*|import\s*\()\s*['"])(\.[^'"]+)(['"])/g,(all,a,b,c)=>{
  if(/\.(js|json|css|wav|mp3)$/.test(b))return all;
  let resolved=path.resolve(path.dirname(file),b);
  const index=!path.extname(b)&&!['ProcessDialogs','kit'].includes(path.basename(b))&&['defs'].includes(path.basename(b));
  return a+b+(index?'/index.js':'.js')+c;
 });
 if(target.endsWith('/engine.js')&&target.includes('/core/'))code=code.replace('if (!useStore.getState().transport.metronome || !this.playing)',"if (!useStore.getState().transport.metronome || !this.playing || !['edit', 'create'].includes(useStore.getState().ui.mode))");
 await mkdir(path.dirname(target),{recursive:true});await writeFile(target,code);
}
await mkdir('vendor/three',{recursive:true});
for(const file of ['three.module.js','three.core.js'])await cp('node_modules/three/build/'+file,'vendor/three/'+file);
await cp('node_modules/three/examples/jsm','vendor/three/addons',{recursive:true});
await cp('node_modules/three/LICENSE','vendor/three/LICENSE');
await cp('node_modules/immer/dist/immer.mjs','vendor/immer.mjs');
await cp('node_modules/immer/LICENSE','vendor/immer-LICENSE');

import {cp,mkdir,rename,stat} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),destination=path.join(root,'dist');
try{await stat(destination);await mkdir('work',{recursive:true});await rename(destination,path.join(root,'work','dist-before-'+Date.now()))}catch(e){if(e.code!=='ENOENT')throw e}
await mkdir(destination,{recursive:true});
for(const file of ['index.html','favicon.svg','app','assets','vendor','README.md','SOUND-SOURCES.md','VISUALIZATION-NOTES.md'])await cp(file,path.join(destination,file),{recursive:true});
console.log('Static site ready in dist/. Upload its contents to any static host. No build or app server is needed to run it.');

import {cp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),destination=path.join(root,'docs');
await mkdir(destination,{recursive:true});
for(const file of ['index.html','impressum.html','favicon.svg','app','assets','vendor','README.md','SOUND-SOURCES.md','VISUALIZATION-NOTES.md']){const target=path.join(destination,file);await rm(target,{recursive:true,force:true});await cp(file,target,{recursive:true})}
console.log('Static site ready in docs/. Upload its contents to any static host. No build or app server is needed to run it.');

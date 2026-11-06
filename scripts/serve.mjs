import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),port=Number(process.env.PORT||5199);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.mp3':'audio/mpeg','.wav':'audio/wav','.wasm':'application/wasm','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
const handler=async(req,res)=>{try{const url=new URL(req.url,'http://localhost');let p=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(p!==root&&!p.startsWith(root+path.sep)){res.writeHead(403).end();return}if((await stat(p)).isDirectory())p=path.join(p,'index.html');const data=await readFile(p);res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data)}catch{res.writeHead(404).end('Not found')}};
for(const host of ['127.0.0.1','::1'])http.createServer(handler).listen(port,host);
console.log(`HitStudio static preview: http://localhost:${port}`);

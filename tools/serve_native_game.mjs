// Explicit development entry. Normal Dex startup is untouched.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const types={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.gif':'image/gif','.wav':'audio/wav','.woff':'font/woff'};
const server=http.createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const url=new URL(req.url,'http://localhost'),relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'game/index.html',file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)||relative.split(/[\\/]/).some(p=>p.startsWith('.'))||!(relative.startsWith('game/')||relative.startsWith('brisk-dex-items/')||relative.startsWith('brisk-dex-sprites/')||relative.startsWith('brisk-dex-cries/')||relative.startsWith('brisk-dex-asset-patches/')||relative==='brisk-dex-data.json')){res.writeHead(403);res.end();return;}
    const type=types[path.extname(file)];if(!type){res.writeHead(403);res.end();return;}
    const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){res.writeHead(404);res.end('Not found');}
});
server.listen(8790,'127.0.0.1',()=>console.log('Brisk standalone prototype: http://127.0.0.1:8790/game/index.html\nDevelopment only; online services are disconnected.'));

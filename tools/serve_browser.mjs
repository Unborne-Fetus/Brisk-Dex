import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.webp':'image/webp', '.svg':'image/svg+xml', '.ogg':'audio/ogg',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.woff2':'font/woff2',
  '.ico':'image/x-icon', '.wasm':'application/wasm'
};
const server = http.createServer((req,res)=>{
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end(); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403); res.end(); return;
  }
  // Only expose the files used by the browser app, never repository metadata or save files.
  if (relative.split(/[\\/]/).some(part => part.startsWith('.')) ||
      !['.html','.js','.mjs','.css','.json','.png','.jpg','.jpeg','.gif','.webp','.svg','.ogg','.mp3','.wav','.woff2','.ico','.wasm'].includes(path.extname(file).toLowerCase())) {
    res.writeHead(403); res.end(); return;
  }
  fs.stat(file,(error,stat)=>{
    if(error || !stat.isFile()){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD'){res.end();return;}
    fs.createReadStream(file).pipe(res);
  });
});
server.listen(0,host,()=>{
  const address=server.address();
  const url=`http://${host}:${address.port}/`;
  console.log('Brisk Dex browser: '+url);
  console.log('Keep this window open while using Brisk Dex. Press Ctrl+C to stop.');
  if(process.platform==='win32'){
    import('node:child_process').then(({spawn})=>{
      spawn('cmd.exe',['/c','start','',url],{stdio:'ignore',detached:true,windowsHide:true}).unref();
    }).catch(()=>{});
  }
});

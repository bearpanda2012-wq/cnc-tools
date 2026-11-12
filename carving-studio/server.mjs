import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('./public/',import.meta.url);
const allowed=new Map([['/','index.html'],['/app.js','app.js'],['/engine.js','engine.js'],['/style.css','style.css']]);
const server=http.createServer(async(req,res)=>{
 if(req.method==='POST'&&req.url==='/api/artcam/open'){
  // Local-only, explicit launch; never execute client-supplied paths or arguments.
  if(req.headers.origin!=='http://127.0.0.1:4317'){res.writeHead(403);res.end();return;}
  const child=spawn('C:\\Program Files\\Autodesk\\ArtCAM 2017\\Exec64\\ArtCAMPro.exe',[],{detached:true,stdio:'ignore'});
  child.once('error',e=>{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));});
  child.once('spawn',()=>{child.unref();res.writeHead(200,{'Content-Type':'application/json'});res.end('{"launched":true}');});return;
 }
 const name=allowed.get(req.url);if(req.method!=='GET'||!name){res.writeHead(404);res.end();return;}
 try{const content=await readFile(new URL(name,root));res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'"});res.end(content);}catch{res.writeHead(500);res.end('Cannot read application file');}
});
server.listen(4317,'127.0.0.1',()=>console.log('Carving Studio: http://127.0.0.1:4317'));

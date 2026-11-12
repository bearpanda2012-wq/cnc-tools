import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validate,validateShapes,contour,reliefMesh,reliefPreview,stl,dxf,gcode} from './src/engine.js';
import {vectorRelief,machineRelief,binaryStl} from './src/relief-machining.js';
const data=new URL('./data/',import.meta.url),file=new URL('current-model.json',data);
const defaults={width:200,height:150,thickness:20,depth:3,diameter:3,stepdown:1,feed:600,plunge:150,safeZ:5,stepover:1};
export function validateProject(project){
 if(!project||project.version!==1)throw Error('Unsupported project version');validate(project.params);validateShapes(project.shapes,project.params);
 if(project.notes!==undefined&&(typeof project.notes!=='string'||project.notes.length>5000))throw Error('Notes exceed 5000 characters');
 if(project.relief){const r=project.relief;if(!Number.isInteger(r.n)||r.n<64||r.n>256||!Array.isArray(r.heights)||r.heights.length!==(r.n+1)**2||r.heights.some(v=>!Number.isFinite(v)||v<0||v>project.params.depth))throw Error('Invalid relief samples');}
 if(project.machining){if(!Array.isArray(project.machining.operations)||project.machining.operations.length>5)throw Error('Invalid machining operations');for(const op of project.machining.operations){validate(op.parameters);validatePaths(op.paths,project.params);}}
}
function validatePaths(paths,p){if(!Array.isArray(paths)||paths.length>10000)throw Error('Invalid toolpaths');let count=0;for(const path of paths){if(!Array.isArray(path))throw Error('Invalid toolpath');for(const point of path){if(++count>250000||!Array.isArray(point)||point.length!==3||point.some(v=>!Number.isFinite(v))||point[0]<0||point[0]>p.width||point[1]<0||point[1]>p.height||point[2]>0||point[2]<-p.depth-.00001)throw Error('Toolpath outside material/depth bounds');}}}
export class ModelStore{
 constructor({persist=true}={}){this.persist=persist;this.state={revision:0,project:{version:1,params:{...defaults},shapes:[],notes:'',relief:null},paths:[],pathKind:'',view:'2d',source:'initial'};this.queue=Promise.resolve();}
 async init(){if(!this.persist)return;try{const s=JSON.parse(await readFile(file,'utf8'));validateProject(s.project);validatePaths(s.paths,s.project.params);this.state=s;}catch(e){if(e.code!=='ENOENT')console.error('Stored model was not loaded:',e.message);}}
 async commit(next){validateProject(next.project);validatePaths(next.paths,next.project.params);next.revision=this.state.revision+1;this.state=next;if(this.persist){await mkdir(data,{recursive:true});const tmp=new URL('current-'+randomUUID()+'.tmp',data);await writeFile(tmp,JSON.stringify(next));await rename(tmp,file);}return structuredClone(next);}
 run(fn){const task=this.queue.then(fn);this.queue=task.catch(()=>{});return task;}
 summary(){const s=this.state;return {revision:s.revision,params:s.project.params,shapes:s.project.shapes,relief:s.project.relief?{mode:s.project.relief.mode,samples:s.project.relief.heights.length}:null,toolpaths:{kind:s.pathKind,passes:s.paths.length},machining:s.project.machining?{active:s.project.machining.active,operations:s.project.machining.operations.map(({paths,...op})=>({...op,rows:paths.length}))}:null,capabilities:['vector-relief','raster-roughing','raster-finishing','vectors','height-field-relief','centreline-engraving','dxf','stl','experimental-gcode'],limitations:['No native ART import','No cutter compensation','No pocketing or V-carving','No machine control'],view:s.view};}
 async command(command,args={}){return this.run(async()=>{
  const s=structuredClone(this.state),project=s.project,p=project.params;let result;
  if(command==='get_model')return this.summary();
  if(command==='new_model'){if(project.shapes.length||project.relief){if(!args.allow_replace)throw Error('Model contains work. Set allow_replace=true to replace it explicitly.');}s.project={version:1,params:{...defaults,...args.params},shapes:[],notes:'',relief:null};s.paths=[];s.pathKind='';s.view='2d';}
  else if(command==='add_vector'){validateShapes([args.shape],p);project.shapes.push(args.shape);s.paths=[];s.pathKind='';s.view='2d';}
  else if(command==='update_vector'){if(!Number.isInteger(args.index)||args.index<0||args.index>=project.shapes.length)throw Error('Vector index does not exist');project.shapes[args.index]=args.shape;s.paths=[];s.pathKind='';s.view='2d';}
  else if(command==='delete_vector'){if(!Number.isInteger(args.index)||args.index<0||args.index>=project.shapes.length)throw Error('Vector index does not exist');project.shapes.splice(args.index,1);s.paths=[];s.pathKind='';}
  else if(command==='set_parameters'){project.params={...p,...args.params};if(['width','height','depth'].some(k=>args.params[k]!==undefined))project.relief=null;s.paths=[];s.pathKind='';}
  else if(command==='create_relief'){const mesh=args.mode==='from-vectors'?vectorRelief(project.shapes,p,{resolution:args.resolution||192,bevel:args.bevel||5}):reliefMesh(p.width,p.height,p.depth,args.resolution||64,args.mode||'dome');project.relief={mode:args.mode||'dome',n:mesh.n,heights:Array.from(mesh.heights)};project.machining=null;s.paths=[];s.pathKind='';s.view='3d';}
  else if(command==='calculate_toolpath'){if(['roughing','finishing'].includes(args.mode)){if(!project.relief)throw Error('Create a relief first');const op=machineRelief({width:p.width,height:p.height,amplitude:p.depth,n:project.relief.n,heights:project.relief.heights},p,{mode:args.mode,toolType:args.toolType||'ballnose',allowance:args.allowance||0});project.machining={operations:[...(project.machining?.operations||[]).filter(x=>x.mode!==op.mode),op],active:op.mode};s.paths=op.paths;s.pathKind=op.mode;}else if(args.mode==='relief-preview'){if(!project.relief)throw Error('Create a relief first');s.paths=reliefPreview({width:p.width,height:p.height,amplitude:p.depth,n:project.relief.n,heights:project.relief.heights},p);s.pathKind='relief';}else{s.paths=contour(project.shapes,p);s.pathKind='contour';}s.view='path';}
  else if(command==='set_view'){if(!['2d','3d','path'].includes(args.view))throw Error('Invalid view');s.view=args.view;}
  else if(command==='export_model'){
   validateProject(project);let text,ext=args.format;if(ext==='dxf'){if(!project.shapes.length)throw Error('No vectors');text=dxf(project.shapes,p);}else if(ext==='stl'){if(!project.relief)throw Error('No relief');text=binaryStl({width:p.width,height:p.height,amplitude:p.depth,n:project.relief.n,heights:project.relief.heights});}else if(ext==='nc'){if(s.pathKind!=='contour')throw Error('Only centreline engraving can be exported as G-code');text=gcode(s.paths,p);}else if(ext==='json')text=JSON.stringify(project,null,2);else throw Error('Unsupported export format');
   const dir=new URL('exports/',data);await mkdir(dir,{recursive:true});const target=new URL(`model-${Date.now()}-${randomUUID().slice(0,8)}.${ext}`,dir);await writeFile(target,text,{flag:'wx'});return {path:fileURLToPath(target),bytes:Buffer.byteLength(text),format:ext,experimental:ext==='nc'};
  }else throw Error('Unknown command');
  s.source='mcp';await this.commit(s);return this.summary();
 });}
}
async function body(req){let n=0,chunks=[];for await(const chunk of req){n+=chunk.length;if(n>16*1024*1024)throw Error('Request too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
export function modelBridge(){const store=new ModelStore();return {name:'carving-studio-model-bridge',async configureServer(server){await store.init();server.middlewares.use(async(req,res,next)=>{
 if(!req.url.startsWith('/api/'))return next();const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.headers.host!=='127.0.0.1:4318'||req.headers.origin&&req.headers.origin!=='http://127.0.0.1:4318')return send(403,{error:'Local application origin required'});
 try{
  if(req.url==='/api/model'&&req.method==='GET')return send(200,store.state);
  if(req.url.startsWith('/api/model?')&&req.method==='GET'){if(Number(new URL(req.url,'http://127.0.0.1:4318').searchParams.get('after'))===store.state.revision){res.writeHead(204,{'Cache-Control':'no-store'});res.end();return;}return send(200,store.state);}
  if(req.url==='/api/mcp-config'&&req.method==='GET')return send(200,{mcpServers:{'carving-studio-classic':{command:process.execPath,args:[fileURLToPath(new URL('./mcp-server.mjs',import.meta.url))]}}});
  if(req.url==='/api/model'&&req.method==='POST'){const input=await body(req);return await store.run(async()=>{if(input.baseRevision!==store.state.revision)return send(409,store.state);validateProject(input.project);const paths=input.paths||[];validatePaths(paths,input.project.params);if(!['','contour','relief','roughing','finishing'].includes(input.pathKind||''))throw Error('Invalid toolpath kind');const state=await store.commit({revision:0,project:input.project,paths,pathKind:input.pathKind||'',view:['2d','3d','path'].includes(input.view)?input.view:'2d',source:'ui'});send(200,{revision:state.revision});});}
  if(req.url==='/api/command'&&req.method==='POST'){const {command,args}=await body(req);return send(200,await store.command(command,args));}
  return send(404,{error:'Unknown endpoint'});
 }catch(e){send(400,{error:e.message});}
 });}};}

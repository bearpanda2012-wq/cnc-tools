import {validate,validateShapes,shapePoints,contour,reliefMesh,reliefPreview,stl,gcode,dxf} from './engine.js';
export function initClassicCore(){
const $=id=>document.getElementById(id),canvas=$('canvas'),ctx=canvas.getContext('2d');
const keys=['width','height','thickness','depth','diameter','stepdown','feed','plunge','safeZ','stepover'];
let zoom=1,gridVisible=false,vectorColour='#000000';
let shapes=[],history=[],selected=-1,tool='select',view='2d',mesh=null,paths=[],pathKind='',drag=null,draft=[],image=null;
const params=()=>Object.fromEntries(keys.map(k=>[k,Number($(k).value)]));
const message=t=>{$('status').textContent=t;};
function guarded(fn){return async(...args)=>{try{await fn(...args);}catch(e){message(e.message);}};}
function snapshot(){history.push(JSON.stringify(shapes));if(history.length>50)history.shift();}
function invalidate(){machiningMeta=null;paths=[];pathKind='';$('stats').textContent='';}
function layout(){const p=params(),scale=Math.min((canvas.width-150)/p.width,(canvas.height-110)/p.height)*zoom;return {p,scale,ox:(canvas.width-p.width*scale)/2,oy:(canvas.height+p.height*scale)/2};}
function draw(){
 const {p,scale:s,ox,oy}=layout();if(!Number.isFinite(s)||s<=0)return;
 ctx.fillStyle='#73787b';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#ffff8b';ctx.fillRect(ox,oy-p.height*s,p.width*s,p.height*s);
 ctx.strokeStyle='#aaa692';ctx.lineWidth=.6;const spacing=Math.max(10,10**Math.floor(Math.log10(Math.max(p.width,p.height)/10)));
 if(gridVisible)for(let x=0;x<=p.width;x+=spacing){ctx.beginPath();ctx.moveTo(ox+x*s,oy);ctx.lineTo(ox+x*s,oy-p.height*s);ctx.stroke();}if(gridVisible)for(let y=0;y<=p.height;y+=spacing){ctx.beginPath();ctx.moveTo(ox,oy-y*s);ctx.lineTo(ox+p.width*s,oy-y*s);ctx.stroke();}
 const line=(pts,color,width=2)=>{if(!pts.length)return;ctx.beginPath();pts.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](ox+x*s,oy-y*s));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();};
 if(view==='3d'&&mesh){renderReliefScene(ctx,mesh);}
 else{shapes.forEach((sh,i)=>line(shapePoints(sh),i===selected?'#d52c91':sh.color||vectorColour,i===selected?3:2));if(view==='path')paths.forEach(pts=>line(pts,pathKind==='roughing'?'#3b94ed':'#e88027',.45));if(draft.length)line(draft,'#ad4233');}
 drawRulers(ctx,p,s,ox,oy);
 $('dimensions').textContent=`${p.width} × ${p.height} × ${p.thickness} mm`;$('count').textContent=`${shapes.length} vectors`;
 publish();updateEditor();
}
function setView(v){view=v;for(const [id,value]of [['view2d','2d'],['view3d','3d'],['viewpath','path']])$(id).classList.toggle('active',v===value);draw();}
function download(name,text,type='text/plain'){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message(`ส่งออก ${name} แล้ว`);}
function point(e){const r=canvas.getBoundingClientRect(),{p,scale:s,ox,oy}=layout();return [Math.max(0,Math.min(p.width,((e.clientX-r.left)*canvas.width/r.width-ox)/s)),Math.max(0,Math.min(p.height,(oy-(e.clientY-r.top)*canvas.height/r.height)/s))];}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;draft=[];document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x===b));setView('2d');});
canvas.onpointerdown=guarded(e=>{validate(params());canvas.focus();if(view!=='2d')return;const [x,y]=point(e);if(tool==='polyline'){if(draft.length>=1000)throw Error('เส้นยาวเกิน 1000 จุด');draft.push([x,y]);draw();return;}
 if(tool==='select'){selected=-1;for(let i=shapes.length-1;i>=0;i--){const pts=shapePoints(shapes[i]),xs=pts.map(a=>a[0]),ys=pts.map(a=>a[1]);if(x>=Math.min(...xs)&&x<=Math.max(...xs)&&y>=Math.min(...ys)&&y<=Math.max(...ys)){selected=i;break;}}}
 snapshot();drag={x,y,original:selected>=0?structuredClone(shapes[selected]):null};canvas.setPointerCapture(e.pointerId);draw();});
canvas.onpointermove=e=>{const [cx,cy]=point(e);$('cursor-x').textContent='X: '+cx.toFixed(3);$('cursor-y').textContent='Y: '+cy.toFixed(3);if(!drag||view!=='2d')return;draw();const [x,y]=point(e),{scale:s,ox,oy}=layout();ctx.strokeStyle='#b74f2b';ctx.lineWidth=2;ctx.setLineDash([7,5]);if(tool==='rect')ctx.strokeRect(ox+drag.x*s,oy-drag.y*s,(x-drag.x)*s,-(y-drag.y)*s);if(tool==='circle'){const p=params(),r=Math.min(Math.hypot(x-drag.x,y-drag.y),drag.x,p.width-drag.x,drag.y,p.height-drag.y);ctx.beginPath();ctx.arc(ox+drag.x*s,oy-drag.y*s,Math.max(0,r*s),0,Math.PI*2);ctx.stroke();}ctx.setLineDash([]);};
canvas.onpointerup=guarded(e=>{if(!drag)return;const [x,y]=point(e),p=params();let candidate=null;
 if(tool==='rect'&&Math.abs(x-drag.x)>.1&&Math.abs(y-drag.y)>.1)candidate={type:'rect',x:Math.min(x,drag.x),y:Math.min(y,drag.y),w:Math.abs(x-drag.x),h:Math.abs(y-drag.y)};
 if(tool==='circle'){const r=Math.min(Math.hypot(x-drag.x,y-drag.y),drag.x,p.width-drag.x,drag.y,p.height-drag.y);if(r>.1)candidate={type:'circle',x:drag.x,y:drag.y,r};}
 if(tool==='select'&&drag.original){const sh=structuredClone(drag.original),dx=x-drag.x,dy=y-drag.y;if(sh.type==='polyline')sh.points=sh.points.map(([a,b])=>[a+dx,b+dy]);else{sh.x+=dx;sh.y+=dy;}try{validateShapes([sh],p);shapes[selected]=sh;}catch{message('ย้ายไม่ได้: รูปทรงจะออกนอกชิ้นงาน');}}
 if(candidate){candidate.color=vectorColour;validateShapes([candidate],p);shapes.push(candidate);selected=shapes.length-1;}drag=null;invalidate();draw();});
canvas.onkeydown=e=>{if(e.key==='Escape'){draft=[];drag=null;draw();}if(e.key==='Enter'&&draft.length>1){snapshot();shapes.push({type:'polyline',color:vectorColour,points:structuredClone(draft)});draft=[];invalidate();draw();}if(e.key==='Delete')$('delete').click();};
$('undo').onclick=()=>{if(history.length){shapes=JSON.parse(history.pop());selected=-1;draft=[];invalidate();draw();}};
$('delete').onclick=()=>{if(selected>=0){snapshot();shapes.splice(selected,1);selected=-1;invalidate();draw();}};
for(const k of keys)$(k).oninput=()=>{invalidate();if(['width','height','depth'].includes(k))mesh=null;draw();};
for(const [id,v]of [['view2d','2d'],['view3d','3d'],['viewpath','path']])$(id).onclick=()=>setView(v);
$('relief').onclick=guarded(()=>{const p=params();validate(p);mesh=reliefMesh(p.width,p.height,p.depth,64,$('reliefMode').value,image);invalidate();setView('3d');message('สร้างลายนูนแล้ว · ส่งออก STL ได้');});
$('reliefMode').onchange=()=>{image=null;message('เลือกลายสำเร็จรูปแล้ว กดสร้างลายนูนเพื่ออัปเดต');};
$('image').onchange=guarded(async e=>{const file=e.target.files[0];if(!file)return;if(file.size>20e6)throw Error('รูปภาพต้องไม่เกิน 20 MB');const bitmap=await createImageBitmap(file,{resizeWidth:256,resizeHeight:256,resizeQuality:'high'}),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);image=c.getContext('2d').getImageData(0,0,c.width,c.height);bitmap.close();$('relief').click();});
$('stl').onclick=guarded(()=>{if(!mesh)throw Error('สร้างลายนูนก่อนส่งออก');download('relief.stl',stl(mesh));});
function stats(){const length=paths.reduce((sum,path)=>sum+path.slice(1).reduce((a,pt,i)=>a+Math.hypot(...pt.map((v,k)=>v-path[i][k])),0),0);$('stats').textContent=`${paths.length} แนว/เที่ยว · ระยะกัด ${(length/1000).toFixed(2)} m · เวลากัดขั้นต่ำ ${(length/params().feed).toFixed(1)} นาที (ไม่รวมยก/จ้วง)`;}
$('contour').onclick=guarded(()=>{paths=contour(shapes,params());pathKind='contour';stats();setView('path');message('คำนวณกัดศูนย์กลางดอกตามแนวเส้นแล้ว');});
$('raster').onclick=guarded(()=>{if(!mesh)throw Error('สร้างลายนูนก่อน');paths=reliefPreview(mesh,params());pathKind='relief';stats();setView('path');message('พรีวิวเท่านั้น: ยังไม่มี roughing และการชดเชยรูปดอก');});
$('gcode').onclick=guarded(()=>{if(pathKind!=='contour')throw Error('G-code รองรับเฉพาะกัดตามแนวเส้น กดคำนวณก่อน');download('engraving-experimental.nc',gcode(paths,params()));});
$('dxf').onclick=guarded(()=>{const p=params();validate(p);if(!shapes.length)throw Error('กรุณาวาดแบบก่อน');download('design-mm.dxf',dxf(shapes,p));});
$('save').onclick=()=>download('carving-project.json',JSON.stringify(serialise(),null,2),'application/json');
$('load').onchange=guarded(async e=>{const file=e.target.files[0];if(!file)return;if(file.size>32e6)throw Error('ไฟล์งานต้องไม่เกิน 32 MB');const project=JSON.parse(await file.text());if(project.version!==1)throw Error('รุ่นไฟล์งานไม่รองรับ');validate(project.params);validateShapes(project.shapes,project.params);let nextMesh=null;if(project.relief){const r=project.relief;if(!Number.isInteger(r.n)||r.n<64||r.n>256||!Array.isArray(r.heights)||r.heights.length!==(r.n+1)**2||r.heights.some(v=>!Number.isFinite(v)||v<0||v>project.params.depth))throw Error('ข้อมูลลายนูนไม่ถูกต้อง');nextMesh={width:project.params.width,height:project.params.height,amplitude:project.params.depth,n:r.n,heights:Float64Array.from(r.heights)};}snapshot();for(const k of keys)$(k).value=project.params[k];shapes=project.shapes;machiningMeta=project.machining||null;$('notes').value=String(project.notes||'');mesh=nextMesh;image=null;selected=-1;invalidate();setView(mesh?'3d':'2d');message('เปิดงานแล้ว');});
$('svg').onchange=guarded(async e=>{const file=e.target.files[0];if(!file)return;if(file.size>2e6)throw Error('SVG ต้องไม่เกิน 2 MB');const xml=new DOMParser().parseFromString(await file.text(),'image/svg+xml');if(xml.querySelector('parsererror'))throw Error('SVG ไม่ถูกต้อง');const nodes=[...xml.querySelectorAll('*')];if(nodes.some(n=>!['svg','g','rect','circle','polyline','polygon','line','title','desc','metadata'].includes(n.localName)||n.hasAttribute('transform')))throw Error('รองรับเฉพาะ rect/circle/line/polyline/polygon ที่ไม่มี transform; แปลง path ใน ArtCAM ก่อน');const num=(n,k,def=0)=>{const v=n.getAttribute(k);if(v===null)return def;if(!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v))throw Error('SVG ต้องใช้พิกัดตัวเลข ไม่มีหน่วย');return Number(v);};const p=params(),vb=xml.documentElement.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);if(vb&& (vb.length!==4||vb.some(v=>!Number.isFinite(v))||vb[2]<=0||vb[3]<=0))throw Error('viewBox ไม่ถูกต้อง');const w=vb?vb[2]:num(xml.documentElement,'width',p.width),h=vb?vb[3]:num(xml.documentElement,'height',p.height),sx=p.width/w,sy=p.height/h,added=[];if(w<=0||h<=0)throw Error('ขนาด SVG ไม่ถูกต้อง');const tx=x=>(x-(vb?.[0]||0))*sx,ty=y=>p.height-(y-(vb?.[1]||0))*sy;for(const n of nodes){let pts;if(n.localName==='rect'){const x=num(n,'x'),y=num(n,'y'),w=num(n,'width'),h=num(n,'height');if(w<=0||h<=0)throw Error('ขนาด SVG ไม่ถูกต้อง');pts=[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];}else if(n.localName==='circle'){const x=num(n,'cx'),y=num(n,'cy'),r=num(n,'r');if(r<=0)throw Error('รัศมี SVG ไม่ถูกต้อง');pts=Array.from({length:97},(_,i)=>[x+r*Math.cos(i*Math.PI/48),y+r*Math.sin(i*Math.PI/48)]);}else if(n.localName==='line')pts=[[num(n,'x1'),num(n,'y1')],[num(n,'x2'),num(n,'y2')]];else if(['polyline','polygon'].includes(n.localName)){const raw=(n.getAttribute('points')||'').trim().split(/[\s,]+/).map(Number);if(raw.length%2||raw.some(v=>!Number.isFinite(v)))throw Error('จุด SVG ไม่ถูกต้อง');pts=[];for(let i=0;i<raw.length;i+=2)pts.push([raw[i],raw[i+1]]);if(n.localName==='polygon'&&pts.length)pts.push(pts[0]);}if(pts)added.push({type:'polyline',points:pts.map(([x,y])=>[tx(x),ty(y)])});}validateShapes([...shapes,...added],p);snapshot();shapes.push(...added);invalidate();setView('2d');message(`นำเข้า ${added.length} รูปทรง ปรับให้พอดีชิ้นงานแล้ว`);});
$('artcam').onclick=guarded(async()=>{const r=await fetch('/api/artcam/open',{method:'POST'}),data=await r.json();if(!r.ok)throw Error(data.error||'เปิด ArtCAM ไม่สำเร็จ');message('ส่งคำสั่งเปิด ArtCAM แล้ว ให้นำเข้า DXF/STL ในโปรแกรม');});

function drawRulers(ctx,p,s,ox,oy){
 ctx.fillStyle='#d1d1d1';ctx.fillRect(0,0,canvas.width,21);ctx.fillRect(0,0,23,canvas.height);ctx.fillStyle='#333';ctx.font='11px Segoe UI';const step=Math.max(5,10**Math.floor(Math.log10(Math.max(p.width,p.height)/10)));
 for(let x=0;x<=p.width;x+=step){const px=ox+x*s;if(px<24||px>canvas.width)continue;ctx.fillText(x.toFixed(0),px+2,12);ctx.fillRect(px,16,1,5);}for(let y=0;y<=p.height;y+=step){const py=oy-y*s;if(py<24||py>canvas.height)continue;ctx.fillText(y.toFixed(0),2,py-2);ctx.fillRect(17,py,6,1);}
 ctx.strokeStyle='#ef301c';ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(ox+25,oy);ctx.stroke();ctx.strokeStyle='#26df32';ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(ox,oy-25);ctx.stroke();
}
let bridgeRevision=-1,bridgeApplying=false,bridgeBusy=false,bridgePending=false,lastLocal='',editorKey='',machiningMeta=null,cameraMode='top',show3DPaths=true;
function serialise(){return {version:1,params:params(),shapes,notes:$('notes').value,machining:machiningMeta,relief:mesh?{mode:mesh.mode||$('reliefMode').value,n:mesh.n,heights:Array.from(mesh.heights)}:null};}
function payload(){return {project:serialise(),paths,pathKind,view};}
function publish(){
 window.dispatchEvent(new CustomEvent('classic-change',{detail:{shapes:shapes.map(s=>({type:s.type})),selected,paths:paths.length,mesh:!!mesh,depth:params().depth,operations:(machiningMeta?.operations||[]).map(({paths,...op})=>({...op,rows:paths.length})),activeOperation:machiningMeta?.active}}));
 if(bridgeApplying)return;
 const value=JSON.stringify(payload());if(value!==lastLocal){lastLocal=value;bridgePending=true;}
}
function updateEditor(){const host=$('selection-editor');if(!host)return;const sh=shapes[selected],key=JSON.stringify([selected,sh]);if(key===editorKey)return;editorKey=key;host.replaceChildren();if(!sh||sh.type==='polyline')return;
 for(const [key,label]of Object.entries(sh.type==='rect'?{x:'Position X',y:'Position Y',w:'Width',h:'Height'}:{x:'Position X',y:'Position Y',r:'Radius'})){const row=document.createElement('label');row.className='field';const title=document.createElement('span');title.textContent=label;const input=document.createElement('input');input.type='number';input.step='0.1';input.value=Number(sh[key].toFixed(3));input.onchange=guarded(()=>{const next={...sh,[key]:Number(input.value)};validateShapes([next],params());snapshot();shapes[selected]=next;invalidate();draw();});row.append(title,input);host.append(row);}
}
function applyRemote(state){
 const project=state.project;validate(project.params);validateShapes(project.shapes,project.params);machiningMeta=project.machining||null;
 bridgeApplying=true;snapshot();for(const k of keys)$(k).value=project.params[k];shapes=project.shapes;$('notes').value=String(project.notes||'');selected=-1;image=null;draft=[];drag=null;
 mesh=project.relief?{mode:project.relief.mode,width:project.params.width,height:project.params.height,amplitude:project.params.depth,n:project.relief.n,heights:Float64Array.from(project.relief.heights)}:null;
 paths=state.paths||[];pathKind=state.pathKind||'';bridgeRevision=state.revision;bridgePending=false;setView(state.view||'2d');lastLocal=JSON.stringify(payload());bridgeApplying=false;
 if(state.source==='mcp')window.dispatchEvent(new Event('classic-open'));
 message(state.source==='mcp'?'MCP: model updated by AI':'Model synchronised');
}
async function bridgeTick(){
 if(bridgeBusy)return;bridgeBusy=true;
 try{
  if(bridgePending&&bridgeRevision>=0){
   const sent=lastLocal,response=await fetch('/api/model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:bridgeRevision,...JSON.parse(sent)})});
   const state=await response.json();if(!response.ok){if(response.status===409){bridgePending=false;applyRemote(state);message('Concurrent AI update received; previous local model is available with Undo');}else throw Error(state.error||'Sync failed');}
   else{bridgeRevision=state.revision;if(lastLocal===sent)bridgePending=false;}
  }else{const response=await fetch('/api/model?after='+bridgeRevision);if(response.status===204)return;if(!response.ok)throw Error('MCP bridge unavailable');const state=await response.json();if(state.revision!==bridgeRevision){if(bridgeRevision<0&&state.revision===0){bridgeRevision=0;lastLocal='';publish();}else applyRemote(state);}}
 }catch(e){message(e.message);}finally{bridgeBusy=false;}
}
window.classicCore={
 pathOverlay(){show3DPaths=!show3DPaths;draw();},
 camera(mode){cameraMode=mode;setView('3d');},
 operation(mode){const op=machiningMeta?.operations.find(o=>o.mode===mode);if(!op)return;for(const k of keys)$(k).value=op.parameters[k];paths=op.paths;pathKind=op.mode;machiningMeta.active=mode;setView('path');stats();message(`${mode}: ${op.tool.type} diameter ${op.tool.diameter} mm — experimental raster`);},
 chooseTool(t){tool=t;draft=[];drag=null;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));setView('2d');message(t==='polyline'?'Create polyline: click points, Enter to finish':'Create '+t+': drag inside the model area');},
 tool(t){document.querySelector(`[data-tool="${t}"]`)?.click();},
 select(i){selected=i;setView('2d');},
 colour(c){vectorColour=c;if(selected>=0){snapshot();shapes[selected].color=c;}draw();},
 zoom(f){zoom=Math.max(.2,Math.min(6,zoom*f));$('zoom-level').textContent=Math.round(zoom*100)+'%';draw();},
 fit(){zoom=1;$('zoom-level').textContent='100%';draw();},
 grid(){gridVisible=!gridVisible;draw();},
 duplicate:guarded(()=>{if(selected<0)throw Error('Select a vector first');const sh=structuredClone(shapes[selected]);if(sh.type==='polyline')sh.points=sh.points.map(([x,y])=>[x+5,y+5]);else{sh.x+=5;sh.y+=5;}validateShapes([sh],params());snapshot();shapes.push(sh);selected=shapes.length-1;invalidate();draw();}),
 newModel(){const next={...params(),width:Number($('new-width').value),height:Number($('new-height').value),thickness:Number($('new-thickness').value)};validate(next);snapshot();for(const k of keys)$(k).value=next[k];shapes=[];selected=-1;mesh=null;paths=[];pathKind='';draft=[];image=null;drag=null;$('notes').value='';zoom=1;setView('2d');message('New model created');}
};
const resizeHandler=()=>{const r=canvas.parentElement.getBoundingClientRect();if(r.width>0&&r.height>0){canvas.width=Math.round(r.width);canvas.height=Math.round(r.height);draw();}};
window.addEventListener('resize',resizeHandler);
$('notes').addEventListener('input',publish);
const bridgeTimer=setInterval(bridgeTick,650);resizeHandler();draw();
return ()=>{clearInterval(bridgeTimer);window.removeEventListener('resize',resizeHandler);$('notes')?.removeEventListener('input',publish);};

function reliefShade(mesh,i,j){const {n,heights:z,width,height}=mesh,k=j*(n+1)+i,v=z[k];if(v<.01)return '#605b51';const gx=(z[j*(n+1)+Math.min(n,i+1)]-z[j*(n+1)+Math.max(0,i-1)])/(2*width/n),gy=(z[Math.min(n,j+1)*(n+1)+i]-z[Math.max(0,j-1)*(n+1)+i])/(2*height/n),norm=Math.hypot(gx,gy,1),light=Math.max(0,(-gx*-.45-gy*.6+.8)/norm/1.1);return `hsl(43 72% ${22+light*49}%)`;}
function draw3DToolpaths(ctx,sc){if(!paths.length)return;ctx.strokeStyle=pathKind==='roughing'?'#58b9ff66':'#efad454d';ctx.lineWidth=.55;const p=params();for(const path of paths){ctx.beginPath();path.forEach(([x,y,z],i)=>{const px=canvas.width/2+(x-y)*sc,py=100+(x+y)*sc*.4-(z+p.depth)*sc*2;ctx[i?'lineTo':'moveTo'](px,py);});ctx.stroke();}}
function renderReliefScene(ctx,mesh){
 const {n,width:w,height:h,heights:z}=mesh,top=cameraMode==='top',sc=(top?Math.min((canvas.width-70)/w,(canvas.height-70)/(h*.82+mesh.amplitude*1.4)):Math.min((canvas.width-60)/(w+h),(canvas.height-80)/((w+h)*.42+mesh.amplitude*1.8)))*zoom;
 const ox=(canvas.width-w*sc)/2,oy=(canvas.height+h*sc*.82)/2;
 const project=(x,y,height)=>top?[ox+x*sc,oy-y*sc*.82-height*sc*1.4]:[canvas.width/2+(x-y)*sc,60+(x+y)*sc*.42-height*sc*1.8];
 const base=[project(0,0,0),project(w,0,0),project(w,h,0),project(0,h,0)];ctx.beginPath();base.forEach(([x,y],k)=>ctx[k?'lineTo':'moveTo'](x,y));ctx.closePath();ctx.fillStyle='#605b51';ctx.fill();
 const cell=(i,j)=>project(i*w/n,j*h/n,z[j*(n+1)+i]);
 const drawCell=(i,j)=>{if(z[j*(n+1)+i]<.001&&z[j*(n+1)+i+1]<.001&&z[(j+1)*(n+1)+i]<.001&&z[(j+1)*(n+1)+i+1]<.001)return;const pts=[cell(i,j),cell(i+1,j),cell(i+1,j+1),cell(i,j+1)];ctx.beginPath();pts.forEach(([x,y],k)=>ctx[k?'lineTo':'moveTo'](x,y));ctx.closePath();ctx.fillStyle=reliefShade(mesh,i,j);ctx.fill();ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.4;ctx.stroke();};
 if(top){for(let j=n-1;j>=0;j--)for(let i=0;i<n;i++)drawCell(i,j);}else for(let j=0;j<n;j++)for(let i=0;i<n;i++)drawCell(i,j);
 if(paths.length&&show3DPaths){ctx.strokeStyle=pathKind==='roughing'?'#69bbff70':'#ffb74645';ctx.lineWidth=.45;for(const path of paths){ctx.beginPath();path.forEach(([x,y,height],k)=>{const [px,py]=project(x,y,height+mesh.amplitude);ctx[k?'lineTo':'moveTo'](px,py);});ctx.stroke();}}
}

}

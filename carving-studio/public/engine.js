export function validate(p){
 for(const k of ['width','height','thickness','depth','stepdown','safeZ','feed','plunge','diameter','stepover'])if(!Number.isFinite(p[k])||p[k]<=0)throw Error(`ค่า ${k} ต้องมากกว่า 0`);
 if(p.width>2000||p.height>2000||p.thickness>500)throw Error('ชิ้นงานเกินขอบเขตต้นแบบ (2000 × 2000 × 500 มม.)');
 if(p.depth>=p.thickness)throw Error('ความลึกต้องน้อยกว่าความหนาชิ้นงาน');
 if(p.stepover>p.diameter)throw Error('ระยะห่างแนวกัดต้องไม่เกินขนาดดอก');
 if(p.stepdown>p.depth)throw Error('ความลึกต่อเที่ยวต้องไม่เกินความลึกรวม');
 if(p.depth/p.stepdown>1000)throw Error('จำนวนเที่ยวกัดเกิน 1000');
}
export function shapePoints(s){
 if(s.type==='rect')return [[s.x,s.y],[s.x+s.w,s.y],[s.x+s.w,s.y+s.h],[s.x,s.y+s.h],[s.x,s.y]];
 if(s.type==='circle')return Array.from({length:97},(_,i)=>[s.x+Math.cos(i*Math.PI/48)*s.r,s.y+Math.sin(i*Math.PI/48)*s.r]);
 if(s.type==='polyline')return s.points;
 throw Error('รูปทรงไม่รองรับ');
}
export function validateShapes(shapes,p){
 if(!Array.isArray(shapes)||shapes.length>1000)throw Error('จำนวนรูปทรงไม่รองรับ');
 let n=0;
 for(const s of shapes){if(!s||!['rect','circle','polyline'].includes(s.type))throw Error('รูปทรงไม่รองรับ');
  if(s.type==='rect'&&(!Number.isFinite(s.w)||!Number.isFinite(s.h)||s.w<=0||s.h<=0))throw Error('ขนาดสี่เหลี่ยมไม่ถูกต้อง');
  if(s.type==='circle'&&(!Number.isFinite(s.r)||s.r<=0))throw Error('รัศมีไม่ถูกต้อง');
  const pts=shapePoints(s);if(!Array.isArray(pts)||pts.length<2)throw Error('เส้นต้องมีอย่างน้อยสองจุด');
  n+=pts.length;if(n>20000)throw Error('จุดเวกเตอร์เกิน 20000');
  for(const pt of pts)if(!Array.isArray(pt)||pt.length!==2||pt.some(v=>!Number.isFinite(v))||pt[0]<0||pt[1]<0||pt[0]>p.width||pt[1]>p.height)throw Error('รูปทรงอยู่นอกชิ้นงานหรือมีพิกัดไม่ถูกต้อง');
 }
}
export function contour(shapes,p){
 validate(p);validateShapes(shapes,p);if(!shapes.length)throw Error('กรุณาวาดรูปก่อน');
 const passes=Math.ceil(p.depth/p.stepdown),result=[];
 if(shapes.reduce((n,s)=>n+shapePoints(s).length,0)*passes>250000)throw Error('เส้นทางใหญ่เกินขอบเขตต้นแบบ');
 for(let i=1;i<=passes;i++){const z=-Math.min(i*p.stepdown,p.depth);for(const s of shapes)result.push(shapePoints(s).map(([x,y])=>[x,y,z]));}return result;
}
// Relief is a height field, in millimetres above a flat base plane.
export function reliefMesh(width,height,amplitude,n=64,mode='dome',image=null){
 if(![width,height,amplitude].every(v=>Number.isFinite(v)&&v>0)||!Number.isInteger(n)||n<2||n>256)throw Error('ขนาดลายนูนไม่ถูกต้อง');
 const heights=new Float64Array((n+1)**2);
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
  const u=i/n,v=j/n;let h;
  if(image){const x=Math.min(image.width-1,Math.floor(u*image.width)),y=Math.min(image.height-1,Math.floor((1-v)*image.height)),k=(y*image.width+x)*4;h=(image.data[k]*.2126+image.data[k+1]*.7152+image.data[k+2]*.0722)/255*(image.data[k+3]/255);}
  else h=mode==='wave'?(Math.sin(u*Math.PI*4)*Math.sin(v*Math.PI*4)+1)/2:Math.sqrt(Math.max(0,1-(u*2-1)**2-(v*2-1)**2));
  heights[j*(n+1)+i]=h*amplitude;
 }
 return {width,height,amplitude,n,heights};
}
export function stl(mesh){
 const {width:w,height:h,n,heights:z}=mesh,lines=['solid relief'];
 const pt=(i,j)=>[i*w/n,j*h/n,z[j*(n+1)+i]];
 function tri(a,b,c){const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]),q=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],m=Math.hypot(...q)||1;lines.push(`facet normal ${q.map(x=>x/m).join(' ')}`,'outer loop',... [a,b,c].map(t=>'vertex '+t.join(' ')),'endloop','endfacet');}
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=pt(i,j),b=pt(i+1,j),c=pt(i+1,j+1),d=pt(i,j+1);tri(a,b,c);tri(a,c,d);}
 // Close with a bottom and four side walls; base sits one mm below the relief.
 const base=-1,bp=(i,j)=>[i*w/n,j*h/n,base];
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){tri(bp(i,j),bp(i+1,j+1),bp(i+1,j));tri(bp(i,j),bp(i,j+1),bp(i+1,j+1));}
 const wall=(a,b)=>{const aa=[a[0],a[1],base],bb=[b[0],b[1],base];tri(a,aa,bb);tri(a,bb,b);};
 for(let i=0;i<n;i++){wall(pt(i,0),pt(i+1,0));wall(pt(i+1,n),pt(i,n));wall(pt(0,i+1),pt(0,i));wall(pt(n,i),pt(n,i+1));}
 lines.push('endsolid relief');return lines.join('\n');
}
export function reliefPreview(mesh,p){
 validate(p);const {n,width,height,heights,amplitude}=mesh,paths=[];
 const rows=Math.ceil(height/p.stepover);if(rows>2000)throw Error('แนวกัดเกิน 2000');
 for(let row=0;row<=rows;row++){const y=Math.min(row*p.stepover,height),j=Math.round(y/height*n),path=[];for(let i=0;i<=n;i++)path.push([i*width/n,y,heights[j*(n+1)+i]-amplitude]);if(row%2)path.reverse();paths.push(path);}return paths;
}
export function gcode(paths,p){
 validate(p);if(!paths.length)throw Error('ยังไม่มีเส้นทางกัด');
 const f=v=>v.toFixed(3),out=['(Carving Studio experimental centerline engraving)','(Origin lower-left, Z0 stock top, mm)','(No cutter compensation. Verify in CAM simulator.)','G21','G90','G17','G94',`G0 Z${f(p.safeZ)}`];
 for(const path of paths){if(!path.length)continue;for(const pt of path)if(pt.length!==3||pt.some(v=>!Number.isFinite(v))||pt[0]<0||pt[1]<0||pt[0]>p.width||pt[1]>p.height||pt[2]>0||pt[2]<-p.depth-.00001)throw Error('เส้นทางกัดอยู่นอกขอบเขต');
 out.push(`G0 Z${f(p.safeZ)}`,`G0 X${f(path[0][0])} Y${f(path[0][1])}`,`G1 Z${f(path[0][2])} F${f(p.plunge)}`);for(const [x,y,z]of path.slice(1))out.push(`G1 X${f(x)} Y${f(y)} Z${f(z)} F${f(p.feed)}`);}
 out.push(`G0 Z${f(p.safeZ)}`,'M5','M2');return out.join('\n');
}
export function dxf(shapes,p){validateShapes(shapes,p);const out=['0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC','0','SECTION','2','ENTITIES'];for(const s of shapes){const pts=shapePoints(s);out.push('0','POLYLINE','8','0','66','1','70','0');for(const [x,y]of pts)out.push('0','VERTEX','8','0','10',String(x),'20',String(y),'30','0');out.push('0','SEQEND');}out.push('0','ENDSEC','0','EOF');return out.join('\n');}

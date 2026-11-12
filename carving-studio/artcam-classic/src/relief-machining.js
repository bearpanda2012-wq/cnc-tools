import {validate,validateShapes,shapePoints} from './engine.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function inside(x,y,points){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function edgeDistance(x,y,points){let d=Infinity;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1),0,1);d=Math.min(d,Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy));}return d;}
export function vectorRelief(shapes,p,{resolution=192,bevel=5}={}){
 validate(p);validateShapes(shapes,p);if(!Number.isInteger(resolution)||resolution<64||resolution>256||!Number.isFinite(bevel)||bevel<=0)throw Error('Invalid vector relief resolution/bevel');
 if(!shapes.length)throw Error('Create closed vectors first');
 const polygons=shapes.map(s=>{const points=shapePoints(s);if(Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])>1e-6)throw Error('Vector relief requires closed contours');const xs=points.map(pt=>pt[0]),ys=points.map(pt=>pt[1]);return {points,subtract:s.reliefRole==='subtract',box:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};});
 const n=resolution,heights=new Float64Array((n+1)**2),inBox=(x,y,b,pad=0)=>x>=b[0]-pad&&x<=b[2]+pad&&y>=b[1]-pad&&y<=b[3]+pad;
 for(let j=0;j<=n;j++)for(let i=0;i<=n;i++){
  const x=i*p.width/n,y=j*p.height/n;let distance=-1;
  for(const poly of polygons)if(!poly.subtract&&inBox(x,y,poly.box)&&inside(x,y,poly.points))distance=Math.max(distance,edgeDistance(x,y,poly.points));
  if(distance<0)continue;
  for(const poly of polygons)if(poly.subtract&&inBox(x,y,poly.box,bevel)){if(inside(x,y,poly.points)){distance=-1;break;}distance=Math.min(distance,edgeDistance(x,y,poly.points));}
  if(distance>=0){const t=clamp(distance/bevel,0,1);heights[j*(n+1)+i]=p.depth*Math.sin(t*Math.PI/2);}
 }
 return {width:p.width,height:p.height,amplitude:p.depth,n,heights};
}
export function machineRelief(mesh,p,{mode='finishing',toolType='ballnose',allowance=0}={}){
 validate(p);if(!['roughing','finishing'].includes(mode)||!['flat','ballnose'].includes(toolType)||!Number.isFinite(allowance)||allowance<0||allowance>=p.depth)throw Error('Invalid machining options');
 const {width:w,height:h,n,heights}=mesh;if(w!==p.width||h!==p.height)throw Error('Relief dimensions do not match material');
 const radius=p.diameter/2,dx=w/n,dy=h/n,pixelPad=Math.hypot(dx,dy)/2;
 // Conservative cell sampling: enlarged footprint covers the full raster cells.
 function tipHeight(x,y){let max=-p.depth;const ix0=Math.max(0,Math.floor((x-radius-pixelPad)/dx)),ix1=Math.min(n,Math.ceil((x+radius+pixelPad)/dx)),iy0=Math.max(0,Math.floor((y-radius-pixelPad)/dy)),iy1=Math.min(n,Math.ceil((y+radius+pixelPad)/dy));
  for(let j=iy0;j<=iy1;j++)for(let i=ix0;i<=ix1;i++){const r=Math.max(0,Math.hypot(i*dx-x,j*dy-y)-pixelPad);if(r>radius)continue;const sag=toolType==='ballnose'?radius-Math.sqrt(Math.max(0,radius*radius-r*r)):0;max=Math.max(max,heights[j*(n+1)+i]-p.depth-sag);}
  return Math.min(0,max+allowance);
 }
 if(p.width<=p.diameter||p.height<=p.diameter)throw Error('Tool does not fit workpiece');
 const rows=Math.ceil((h-p.diameter)/p.stepover),columns=Math.ceil((w-p.diameter)/Math.min(dx,p.diameter/3)),passes=mode==='roughing'?Math.ceil(p.depth/p.stepdown):1;
 if((rows+1)*(columns+1)*passes>250000)throw Error('Toolpath exceeds 250000 points. Increase stepover or stepdown.');
 const rowsData=[];for(let row=0;row<=rows;row++){const y=radius+(h-p.diameter)*row/rows,points=[];for(let col=0;col<=columns;col++){const x=radius+(w-p.diameter)*col/columns;points.push([x,y,tipHeight(x,y)]);}if(row%2)points.reverse();rowsData.push(points);}
 const paths=[];for(let pass=1;pass<=passes;pass++){const floor=-Math.min(pass*p.stepdown,p.depth);for(const row of rowsData)paths.push(row.map(([x,y,z])=>[x,y,mode==='roughing'?Math.max(floor,z):z]));}
 return {paths,mode,tool:{type:toolType,diameter:p.diameter},allowance,parameters:{...p},conservativeRaster:true,limitations:['Discrete raster envelope; not an exact CAD collision proof','No holder/clamp or machine simulation','Stock edge border remains uncut by tool radius']};
}
export function binaryStl(mesh){
 const {width:w,height:h,n,heights:z}=mesh,count=4*n*n+8*n,bytes=new Uint8Array(84+count*50),dv=new DataView(bytes.buffer);new TextEncoder().encodeInto('Carving Studio vector relief; millimetres',bytes.subarray(0,80));dv.setUint32(80,count,true);let offset=84;
 const pt=(i,j)=>[i*w/n,j*h/n,z[j*(n+1)+i]],bp=(i,j)=>[i*w/n,j*h/n,-1];
 const tri=(a,b,c)=>{const u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...normal)||1;for(const x of [...normal.map(v=>v/l),...a,...b,...c]){dv.setFloat32(offset,x,true);offset+=4;}dv.setUint16(offset,0,true);offset+=2;};
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){tri(pt(i,j),pt(i+1,j),pt(i+1,j+1));tri(pt(i,j),pt(i+1,j+1),pt(i,j+1));tri(bp(i,j),bp(i+1,j+1),bp(i+1,j));tri(bp(i,j),bp(i,j+1),bp(i+1,j+1));}
 const wall=(a,b)=>{const aa=[a[0],a[1],-1],bb=[b[0],b[1],-1];tri(a,aa,bb);tri(a,bb,b);};for(let i=0;i<n;i++){wall(pt(i,0),pt(i+1,0));wall(pt(i+1,n),pt(i,n));wall(pt(0,i+1),pt(0,i));wall(pt(n,i),pt(n,i+1));}return bytes;
}

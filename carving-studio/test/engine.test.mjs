import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contour,gcode,reliefMesh,stl,dxf,validateShapes} from '../public/engine.js';
const p={width:200,height:150,thickness:20,depth:3,diameter:3,stepdown:1,feed:600,plunge:150,safeZ:5,stepover:1};
const shapes=[{type:'rect',x:10,y:10,w:40,h:30},{type:'circle',x:100,y:75,r:20}];
test('contours never exceed requested depth; retract precedes XY rapids',()=>{
 const paths=contour(shapes,{...p,depth:2.5});assert.equal(paths.length,6);assert.equal(paths.at(-1)[0][2],-2.5);
 const code=gcode(paths,{...p,depth:2.5}),lines=code.split('\n');assert.match(code,/G21\nG90/);for(let i=0;i<lines.length;i++)if(lines[i].startsWith('G0 X'))assert.equal(lines[i-1],'G0 Z5.000');assert.equal(lines.at(-3),'G0 Z5.000');
});
test('reject unsafe stock, geometry and non-finite inputs',()=>{
 assert.throws(()=>contour(shapes,{...p,depth:20}));assert.throws(()=>contour([{type:'rect',x:199,y:0,w:20,h:20}],p));assert.throws(()=>gcode([[[0,0,-4]]],p));assert.throws(()=>contour(shapes,{...p,feed:NaN}));assert.throws(()=>validateShapes([{type:'polyline',points:[[1,2],[Infinity,2]]}],p));
});
test('DXF exports millimetres and closed rectangle vertices',()=>{const text=dxf([shapes[0]],p);assert.match(text,/\$INSUNITS\n70\n4/);assert.equal((text.match(/\nVERTEX\n/g)||[]).length,5);assert.match(text,/\nEOF$/);});
test('STL forms a watertight consistently oriented mesh',()=>{
 const mesh=reliefMesh(20,10,3,8),text=stl(mesh),verts=[...text.matchAll(/vertex ([^\n]+)/g)].map(m=>m[1].split(' ').map(Number)),edges=new Map();
 for(let i=0;i<verts.length;i+=3)for(let k=0;k<3;k++){const a=verts[i+k].join(','),b=verts[i+(k+1)%3].join(','),key=[a,b].sort().join('|'),e=edges.get(key)||{count:0,balance:0};e.count++;e.balance+=a<b?1:-1;edges.set(key,e);}
 // Collinear side/bottom edges must share the same tessellation to be watertight.
 for(const e of edges.values()){assert.equal(e.count,2);assert.equal(e.balance,0);}
});

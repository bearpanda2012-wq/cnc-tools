import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {fileURLToPath} from 'node:url';
import {writeFile,mkdir,copyFile} from 'node:fs/promises';
const out=new URL('../../research/thai-demo/',import.meta.url);await mkdir(out,{recursive:true});
const previous=await (await fetch('http://127.0.0.1:4318/api/model')).json();await writeFile(new URL('before-demo-'+Date.now()+'.json',out),JSON.stringify(previous),{flag:'wx'});
const client=new Client({name:'thai-relief-demonstration',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../mcp-server.mjs',import.meta.url))]}));
const transcript=[];
async function call(name,args={}){const result=await client.callTool({name,arguments:args});if(result.isError)throw Error(result.content[0].text);const value=JSON.parse(result.content[0].text);transcript.push({tool:name,args:name==='add_vector'?{points:args.shape.points.length,role:args.shape.reliefRole||'raise'}:args,result:name==='export_model'?value:{revision:value.revision,relief:value.relief,toolpaths:value.toolpaths}});return value;}
function bezier(start,segments){const points=[start];let a=start;for(const [b,c,d]of segments){for(let i=1;i<=20;i++){const t=i/20,q=1-t;points.push([q*q*q*a[0]+3*q*q*t*b[0]+3*q*t*t*c[0]+t*t*t*d[0],q*q*q*a[1]+3*q*q*t*b[1]+3*q*t*t*c[1]+t*t*t*d[1]]);}a=d;}if(Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])>1e-8)points.push([...points[0]]);return points;}
const main=bezier([100,32],[ [[71,43],[72,66],[92,84]],[[105,98],[131,100],[133,123]],[[135,145],[119,167],[132,196]],[[105,178],[101,157],[109,140]],[[114,129],[118,119],[111,110]],[[121,136],[97,151],[85,154]],[[95,137],[86,119],[75,106]],[[48,75],[61,45],[100,32]] ]);
const lower=bezier([79,29],[ [[46,20],[25,33],[25,52]],[[24,70],[38,84],[27,100]],[[51,92],[57,74],[48,62]],[[44,55],[34,51],[36,43]],[[40,34],[53,39],[58,45]],[[67,51],[70,42],[79,29]] ]);
const upper=bezier([55,100],[ [[38,108],[31,127],[37,142]],[[41,158],[35,168],[25,177]],[[54,168],[64,148],[56,133]],[[50,122],[46,116],[55,100]] ]);
const accent=bezier([68,148],[ [[53,161],[57,181],[48,193]],[[71,187],[80,175],[75,163]],[[72,157],[70,151],[68,148]] ]);
const foot=bezier([65,20],[ [[82,12],[94,12],[100,20]],[[106,12],[118,12],[135,20]],[[120,29],[110,32],[100,27]],[[90,32],[80,29],[65,20]] ]);
const eye=bezier([95,62],[ [[78,68],[78,82],[90,92]],[[98,99],[108,103],[113,114]],[[115,94],[109,82],[99,76]],[[93,71],[91,66],[95,62]] ]);
const mirror=pts=>pts.map(([x,y])=>[200-x,y]);
const contours=[main,lower,mirror(lower),upper,mirror(upper),accent,mirror(accent),foot];
try{
 await call('export_model',{format:'json'});
 await call('new_model',{allow_replace:true,params:{width:200,height:220,thickness:20,depth:6,diameter:6,stepdown:2,stepover:2.4,feed:1200,plunge:300,safeZ:10}});
 for(const points of contours)await call('add_vector',{shape:{type:'polyline',points}});
 await call('add_vector',{shape:{type:'polyline',points:eye,reliefRole:'subtract'}});
 await call('create_relief',{mode:'from-vectors',resolution:192,bevel:5});
 await call('calculate_toolpath',{mode:'roughing',toolType:'flat',allowance:.5});
 await call('set_parameters',{params:{diameter:3,stepover:.6,stepdown:1,feed:1000,plunge:200,safeZ:10}});
 await call('calculate_toolpath',{mode:'finishing',toolType:'ballnose',allowance:0});
 const exported={};for(const format of ['stl','dxf','json']){const result=await call('export_model',{format});const target=new URL('thai-kanok-demo.'+format,out);await copyFile(result.path,target);exported[format]=fileURLToPath(target);}
 await call('set_view',{view:'3d'});const state=await call('get_model');await writeFile(new URL('mcp-transcript.json',out),JSON.stringify(transcript,null,2));await writeFile(new URL('result.json',out),JSON.stringify({state,exported},null,2));console.log(JSON.stringify({vectors:state.shapes.length,relief:state.relief,toolpaths:state.machining,exported}));
}finally{await client.close();}

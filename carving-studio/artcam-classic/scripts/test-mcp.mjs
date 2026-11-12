import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const base='http://127.0.0.1:4318';
const original=await (await fetch(base+'/api/model')).json();
const client=new Client({name:'classic-integration-test',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../mcp-server.mjs',import.meta.url))]});
async function call(name,args={},expectError=false){const result=await client.callTool({name,arguments:args});assert.equal(!!result.isError,expectError,JSON.stringify(result));return result.isError?result:JSON.parse(result.content[0].text);}
try{
 await client.connect(transport);const list=await client.listTools();assert.equal(list.tools.length,10);
 await call('new_model',{allow_replace:true,params:{width:200,height:150}});
 await call('add_vector',{shape:{type:'rect',x:20,y:20,w:60,h:40}});
 await call('add_vector',{shape:{type:'circle',x:130,y:75,r:25}});
 let state=await call('get_model');assert.equal(state.shapes.length,2);
 await call('update_vector',{index:0,shape:{type:'rect',x:20,y:20,w:65,h:45}});
 await call('set_parameters',{params:{width:10}},true);state=await call('get_model');assert.equal(state.params.width,200);
 await call('calculate_toolpath',{mode:'centreline'});state=await call('get_model');assert.equal(state.toolpaths.passes,6);
 for(const format of ['dxf','nc','json']){const output=await call('export_model',{format});assert.ok(output.bytes>100);}
 await call('create_relief',{mode:'wave'});await call('export_model',{format:'stl'});await call('calculate_toolpath',{mode:'relief-preview'});await call('export_model',{format:'nc'},true);
 await call('set_view',{view:'3d'});
 const live=await (await fetch(base+'/api/model')).json();assert.equal(live.project.shapes.length,2);assert.equal(live.source,'mcp');
 const forbidden=await fetch(base+'/api/command',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({command:'get_model'})});assert.equal(forbidden.status,403);
 console.log('PASS: MCP initialize, tools/list (10 tools), geometry, invalid edits, toolpaths, DXF/NC/JSON/STL export, relief, live bridge and origin validation.');
}finally{
 await client.close();const current=await (await fetch(base+'/api/model')).json();const restore=await fetch(base+'/api/model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...original,baseRevision:current.revision})});assert.ok(restore.ok,'Restore pre-test project');
}

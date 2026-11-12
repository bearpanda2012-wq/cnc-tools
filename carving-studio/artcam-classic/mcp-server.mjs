import {McpServer} from '@modelcontextprotocol/server';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
const server=new McpServer({name:'carving-studio-classic',version:'0.2.0'});
const num=z.number().finite(),positive=num.positive();
const params=z.object({width:positive.optional(),height:positive.optional(),thickness:positive.optional(),depth:positive.optional(),diameter:positive.optional(),stepdown:positive.optional(),feed:positive.optional(),plunge:positive.optional(),safeZ:positive.optional(),stepover:positive.optional()}).strict();
const shape=z.discriminatedUnion('type',[
 z.object({type:z.literal('rect'),x:num,y:num,w:positive,h:positive}),
 z.object({type:z.literal('circle'),x:num,y:num,r:positive}),
 z.object({type:z.literal('polyline'),points:z.array(z.tuple([num,num])).min(2).max(20000),reliefRole:z.enum(['raise','subtract']).optional()})]);
const definitions=[
 ['get_model','Read workpiece, vector geometry, relief status and calculated toolpath metadata.',z.object({}),true],
 ['new_model','Create a model in mm. Existing work requires explicit allow_replace.',z.object({params:params.optional(),allow_replace:z.boolean().default(false)}),false],
 ['add_vector','Add a rectangle, circle or polyline inside the workpiece. Coordinates in mm, lower-left origin.',z.object({shape}),false],
 ['update_vector','Replace the vector at a zero-based index. Invalid or out-of-stock geometry is rejected.',z.object({index:z.number().int().min(0),shape}),false],
 ['delete_vector','Delete the vector at a zero-based index; invalidates toolpaths.',z.object({index:z.number().int().min(0)}),false],
 ['set_parameters','Update stock and cutting parameters in mm / mm per minute. Invalidates toolpaths.',z.object({params}),false],
 ['create_relief','Generate a dome, wave or bevelled relief from closed vectors. Subtract-role polygons form recesses.',z.object({mode:z.enum(['dome','wave','from-vectors']).default('dome'),resolution:z.number().int().min(64).max(256).optional(),bevel:positive.optional()}),false],
 ['calculate_toolpath','Calculate centreline engraving, preview raster, or experimental raster roughing/finishing with a conservative flat/ballnose envelope. No machine/holder simulation.',z.object({mode:z.enum(['centreline','relief-preview','roughing','finishing']).default('centreline'),toolType:z.enum(['flat','ballnose']).optional(),allowance:num.min(0).optional()}),false],
 ['set_view','Switch the live application view.',z.object({view:z.enum(['2d','3d','path'])}),false],
 ['export_model','Export DXF, closed STL, JSON or experimental centreline G-code. Writes only a new file inside application data/exports; never drives a CNC machine.',z.object({format:z.enum(['dxf','stl','json','nc'])}),false]
];
for(const [name,description,inputSchema,readOnlyHint]of definitions)server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint,destructiveHint:['new_model','update_vector','delete_vector','set_parameters','create_relief'].includes(name),idempotentHint:readOnlyHint,openWorldHint:false}},async args=>{
 try{const response=await fetch('http://127.0.0.1:4318/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:name,args}),signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Application request failed');return {content:[{type:'text',text:JSON.stringify(data)}]};}catch(e){return {isError:true,content:[{type:'text',text:`${e.message}. The Classic application must be running on 127.0.0.1:4318.`}]};}
});
await server.connect(new StdioServerTransport());

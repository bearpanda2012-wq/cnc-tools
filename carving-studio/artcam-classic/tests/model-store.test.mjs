import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ModelStore} from '../bridge.mjs';
test('model commands validate atomically and invalidate old toolpaths',async()=>{
 const store=new ModelStore({persist:false});await store.command('add_vector',{shape:{type:'rect',x:10,y:10,w:50,h:40}});await store.command('calculate_toolpath',{});assert.equal(store.state.paths.length,3);const revision=store.state.revision;
 await assert.rejects(store.command('set_parameters',{params:{width:20}}));assert.equal(store.state.revision,revision);assert.equal(store.state.project.params.width,200);
 await assert.rejects(store.command('new_model',{}));assert.equal(store.state.project.shapes.length,1);
 await store.command('update_vector',{index:0,shape:{type:'circle',x:50,y:50,r:20}});assert.equal(store.state.paths.length,0);assert.equal(store.state.project.shapes[0].type,'circle');
});
test('concurrent MCP additions serialize without losing either vector',async()=>{
 const store=new ModelStore({persist:false});await Promise.all([store.command('add_vector',{shape:{type:'circle',x:30,y:30,r:10}}),store.command('add_vector',{shape:{type:'rect',x:50,y:50,w:20,h:20}})]);assert.equal(store.state.project.shapes.length,2);assert.equal(store.state.revision,2);
});
test('relief generation contains bounded samples; no unsupported machining',async()=>{
 const store=new ModelStore({persist:false});await store.command('create_relief',{mode:'dome'});assert.equal(store.state.project.relief.heights.length,4225);assert.ok(store.state.project.relief.heights.every(x=>x>=0&&x<=3));await assert.rejects(store.command('export_model',{format:'nc'}));await store.command('calculate_toolpath',{mode:'relief-preview'});assert.equal(store.state.pathKind,'relief');await assert.rejects(store.command('export_model',{format:'nc'}));
});

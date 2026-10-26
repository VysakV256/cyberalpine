import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=new URL('../public/',import.meta.url);
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(new URL(path,base))).toString('base64'));
const THREE=await load('vendor/three.core.js');
const {createDataLandmarks}=await load('assets/data-landmarks.js');
const manifest=JSON.parse(fs.readFileSync(new URL('assets/universe.json',base),'utf8'));
const create=()=>createDataLandmarks(THREE,{manifest,ground:()=>8});

test('actual manifest counts and dated filters retain exact source records',()=>{
 const layer=create(),full=layer.getStats();
 assert.equal(full.observations,22);assert.equal(full.retainedRecordPoints,139);assert.equal(full.graphNodes,347);assert.equal(full.graphEdges,329);assert.equal(full.omittedGraphNodes,0);assert.equal(full.omittedGraphEdges,0);
 const early=layer.setTime('2025-10-24');assert.equal(early.visibleObservations,0);assert.equal(early.visibleRecordPoints,0);assert.equal(early.visibleGraphEdges,0);
 const expected=manifest.datasets.filter(d=>d.structure==='tabular').flatMap(d=>d.records).filter(r=>r.dateInterval.end<='2026-01-31').length;
 assert.equal(layer.setTime('2026-01-31').visibleObservations,expected);
 layer.setTime(manifest.window.end);const columns=layer.pickables.find(o=>o.name.includes('bls-cpi /'));
 const selected=layer.resolveHit({object:columns,instanceId:0});assert.equal(selected.recordId,manifest.datasets[0].records[0].id);assert.equal(selected.value,manifest.datasets[0].records[0].value);assert.ok(selected.unit);assert.ok(Number.isFinite(selected.numericBaseline));
 layer.dispose();
});

test('unknown DOI targets have literal identifiers and no invented fetched metadata',()=>{
 const layer=create(),nodes=layer.pickables.find(o=>o.name==='Actual deposited DOI reference graph');
 const external=nodes.userData.instances.find(d=>!d.metadataFetched);assert.ok(external);assert.equal(external.label,external.doi);assert.equal(external.record,null);
 const lines=layer.pickables.find(o=>o.isLineSegments),second=layer.resolveHit({object:lines,index:2});assert.equal(second.recordId,lines.userData.edges[1].recordId);
 layer.setVisible(false);assert.equal(layer.pickables.length,0);assert.equal(layer.resolveHit({object:nodes,instanceId:0}),null);
 layer.setVisible(true);assert.ok(layer.pickables.length);layer.dispose();
});

test('interpretation emphasis accepts exact IDs only and caps each dataset at eight',()=>{
 const layer=create(),d=manifest.datasets[0];
 const result=layer.applyPlan({datasets:[{datasetId:d.id,recordIds:d.records.slice(0,8).map(r=>r.id)},{datasetId:d.id,recordIds:d.records.slice(8).map(r=>r.id)},{datasetId:'fiction',recordIds:['made-up']} ]});
 assert.equal(result.highlightedRecords,8);assert.equal(layer.getStats().highlights,8);
 layer.setTime('2025-10-24');assert.equal(layer.getStats().highlights,0);
 assert.equal(layer.applyPlan({datasets:[{datasetId:d.id,recordIds:['made-up',123]}]}).highlightedRecords,0);
 layer.update(1);layer.dispose();
});

test('constant-valued series has finite heights and explicit truncated baseline',()=>{
 const m={window:{end:'2026-01-31'},datasets:[{id:'flat',name:'Flat series',structure:'tabular',anchor:{x:0,z:0},radius:10,records:[{id:'one',title:'One',value:7,unit:'kg',dateInterval:{end:'2026-01-31'}}]}]};
 const layer=createDataLandmarks(THREE,{manifest:m,ground:()=>2}),mesh=layer.pickables.find(o=>o.isInstancedMesh);
 const data=layer.resolveHit({object:mesh,instanceId:0});assert.equal(data.numericBaseline,7);assert.equal(data.numericMaximum,7);assert.ok(Number.isFinite(data.displayHeight));assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
 assert.throws(()=>layer.setTime('2026-02-30'),/valid ISO date/);layer.dispose();
});

test('selected-only layers retain fetched DOI metadata from the source catalogue',()=>{
 const edges=manifest.datasets.find(d=>d.id==='crossref-reference-edges');
 const layer=createDataLandmarks(THREE,{manifest:{...manifest,datasets:[edges]},sourceManifest:manifest,ground:()=>8});
 const stats=layer.getStats();assert.equal(stats.datasets,1);assert.equal(stats.observations,0);assert.equal(stats.retainedRecordPoints,0);assert.equal(stats.graphEdges,329);
 const nodes=layer.pickables.find(o=>o.name==='Actual deposited DOI reference graph');
 const known=nodes.userData.instances.find(d=>d.metadataFetched);assert.ok(known);assert.ok(known.record.title);assert.equal(known.snapshotMetadataFetched,true);
 layer.dispose();
});

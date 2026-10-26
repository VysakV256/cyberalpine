// Offline tests: every model response and key below is an explicit test fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compileContext,validatePlan,parseResponse,buildRequest,validateBindings,DATASET_IDS,PROMPT_VERSION} from '../public/assets/gemini-plan.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const raw=fs.readFileSync(path.join(root,'public/assets/universe.json')),manifest=JSON.parse(raw);
const context=compileContext(manifest),sha=v=>createHash('sha256').update(v).digest('hex');
const clone=v=>structuredClone(v);
function fixturePlan(){return {universeTitle:'Offline fixture universe',summary:'Explicit test fixture, not an actual generated artifact.',
  datasets:context.datasets.map(d=>({datasetId:d.datasetId,title:'Fixture title',interpretation:'Fixture interpretation',
    visualEmphasis:d.datasetId==='research-crossref'?'publication-canopy':d.structure==='tabular'?'series':d.structure==='object'?'object-grove':'citation-network',recordIds:d.records.slice(0,1).map(r=>r.recordId)}))};}
function temporary(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'cyberalpine-gemini-test-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
function child(args,extra={}){
  const env={...process.env,...extra};delete env.GOOGLE_API_KEY;if(!extra.GEMINI_API_KEY)delete env.GEMINI_API_KEY;
  return spawnSync(process.execPath,args,{env,encoding:'utf8',timeout:10000});
}
const cli=path.join(root,'scripts/generate-gemini-universe.mjs');

test('bounded context uses all six real dataset IDs, records, and only three derivations',()=>{
  assert.deepEqual(context.datasets.map(d=>d.datasetId),DATASET_IDS);
  assert.equal(context.allowedDerivations.length,3);
  for(const d of context.datasets){
    assert.ok(d.records.length<=8);
    const actual=manifest.datasets.find(actual=>actual.id===d.datasetId);
    assert.equal(d.recordCount,actual.records.length);
    assert.ok(d.records.every(r=>actual.records.some(actual=>actual.id===r.recordId)));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(context))<40000);
});
test('context rejects non-finite source statistics',()=>{
  const bad=clone(manifest);bad.datasets[0].features.relativeStdDev=Infinity;
  assert.throws(()=>compileContext(bad),/Non-finite/);
});
test('valid plan is canonical and never changes acquired data',()=>{
  const before=JSON.stringify(manifest),plan=fixturePlan();plan.datasets.reverse();
  assert.deepEqual(validatePlan(plan,manifest).datasets.map(d=>d.datasetId),DATASET_IDS);
  assert.equal(JSON.stringify(manifest),before);
});
test('unknown, duplicate, and missing datasets fail validation',()=>{
  for(const change of [p=>p.datasets[0].datasetId='invented',p=>p.datasets[0].datasetId=p.datasets[1].datasetId,p=>p.datasets.pop()]){
    const p=fixturePlan();change(p);assert.throws(()=>validatePlan(p,manifest));
  }
});
test('invented and cross-dataset record IDs fail validation',()=>{
  const bad=fixturePlan();bad.datasets[0].recordIds=['invented'];assert.throws(()=>validatePlan(bad,manifest),/record ID/);
  bad.datasets[0].recordIds=[context.datasets[1].records[0].recordId];assert.throws(()=>validatePlan(bad,manifest),/record ID/);
});
test('numeric overrides and excessive text are rejected',()=>{
  const numeric=fixturePlan();numeric.datasets[0].value=999;assert.throws(()=>validatePlan(numeric,manifest),/Unexpected/);
  const text=fixturePlan();text.datasets[0].interpretation='x'.repeat(501);assert.throws(()=>validatePlan(text,manifest),/interpretation/);
  const ids=fixturePlan();ids.datasets[0].recordIds=Array(9).fill(context.datasets[0].records[0].recordId);assert.throws(()=>validatePlan(ids,manifest));
});
test('visual emphasis must match the declared dataset structure',()=>{
  for(const id of DATASET_IDS){
    const plan=fixturePlan(),entry=plan.datasets.find(d=>d.datasetId===id);
    entry.visualEmphasis=entry.visualEmphasis==='series'?'object-grove':'series';
    assert.throws(()=>validatePlan(plan,manifest),/does not match the dataset structure/);
  }
});
test('REST model_output text and SDK output_text parse identically',()=>{
  const plan=fixturePlan(),text=JSON.stringify(plan);
  assert.deepEqual(parseResponse({status:'completed',steps:[{type:'model_output',content:[{type:'text',text}]}]}),plan);
  assert.deepEqual(parseResponse({output_text:text}),plan);
  assert.deepEqual(parseResponse({outputs:[{type:'text',text:'```json\n'+text+'\n```'}]}),plan);
  assert.throws(()=>parseResponse({status:'in_progress',output_text:text}),/did not complete/);
  assert.throws(()=>parseResponse({output_text:'{"x":NaN}'}),/invalid JSON/);
});
test('structured request forbids storage and limits response to the plan schema',()=>{
  const request=buildRequest(context);assert.equal(request.model,'gemini-4-argon');assert.equal(request.store,false);
  assert.equal(request.response_format.mime_type,'application/json');
  assert.equal(request.response_format.schema.additionalProperties,false);
  assert.throws(()=>buildRequest(context,'invalid/model'),/model ID/);
});
test('all three artifact hashes bind to exact inputs',()=>{
  const bindings={sourceSnapshotSha256:manifest.sourceSnapshotSha256,universeManifestSha256:sha(raw),inputContextSha256:sha(JSON.stringify(context))};
  const artifact={status:'generated',promptVersion:PROMPT_VERSION,...bindings};
  assert.equal(validateBindings(artifact,bindings),true);
  for(const key of Object.keys(bindings))assert.throws(()=>validateBindings(artifact,{...bindings,[key]:'0'.repeat(64)}),/binding/);
  assert.throws(()=>validateBindings({...artifact,status:'prepared'},bindings));
});
test('prepare-only needs no credentials, writes no generated artifact, and never leaks environment keys',t=>{
  const dir=temporary(t),output=path.join(dir,'artifact.json'),sentinel='offline-fixture-secret-never-transmit';
  const run=child([cli,'--prepare-only','--prepare-dir',dir,'--output',output],{GEMINI_API_KEY:sentinel});
  assert.equal(run.status,0,run.stderr);assert.equal(fs.existsSync(output),false);
  assert.ok(!run.stdout.includes(sentinel));
  assert.ok(!fs.readFileSync(path.join(dir,'request.json'),'utf8').includes(sentinel));
});
test('missing credentials fail clearly and preserve the previous artifact',t=>{
  const dir=temporary(t),output=path.join(dir,'artifact.json');fs.writeFileSync(output,'existing-artifact');
  const run=child([cli,'--output',output]);assert.equal(run.status,1);assert.match(run.stderr,/Missing API key/);
  assert.equal(fs.readFileSync(output,'utf8'),'existing-artifact');
});
test('mocked HTTP failure never overwrites a valid existing artifact',t=>{
  const dir=temporary(t),output=path.join(dir,'artifact.json');fs.writeFileSync(output,'existing-artifact');
  const preload='data:text/javascript,'+encodeURIComponent('globalThis.fetch=async()=>({ok:false,status:429});');
  const run=child(['--import',preload,cli,'--output',output],{GEMINI_API_KEY:'offline-fixture-key'});
  assert.equal(run.status,1);assert.match(run.stderr,/HTTP 429/);
  assert.equal(fs.readFileSync(output,'utf8'),'existing-artifact');
});
test('--help requires no manifest or credentials',()=>{
  const run=child([cli,'--help','--manifest','/nonexistent-fixture-manifest.json']);
  assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/--secret-name/);
});
test('selected Firebase secret name is passed without logging its value',t=>{
  const dir=temporary(t),argvFile=path.join(dir,'argv.json'),fakeFirebase=path.join(dir,'firebase');
  fs.writeFileSync(fakeFirebase,`#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(process.env.FIXTURE_ARGV_FILE,JSON.stringify(process.argv.slice(2)));process.stdout.write('offline-fixture-secret-value');\n`,{mode:0o755});
  const preload='data:text/javascript,'+encodeURIComponent('globalThis.fetch=async()=>({ok:false,status:429});');
  const run=child(['--import',preload,cli,'--secret-project','fixture-project','--secret-name','CUSTOM_GEMINI_KEY','--output',path.join(dir,'artifact.json')],
    {PATH:dir+path.delimiter+process.env.PATH,FIXTURE_ARGV_FILE:argvFile});
  assert.equal(run.status,1);assert.match(run.stderr,/HTTP 429/);
  assert.deepEqual(JSON.parse(fs.readFileSync(argvFile)),['functions:secrets:access','CUSTOM_GEMINI_KEY','--project','fixture-project']);
  assert.ok(!run.stdout.includes('offline-fixture-secret-value'));assert.ok(!run.stderr.includes('offline-fixture-secret-value'));
});

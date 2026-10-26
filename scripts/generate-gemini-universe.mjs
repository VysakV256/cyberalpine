#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {compileContext,validatePlan,parseResponse,buildRequest,PROMPT_VERSION} from '../public/assets/gemini-plan.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ENDPOINT='https://generativelanguage.googleapis.com/v1beta/interactions';
const sha=value=>createHash('sha256').update(value).digest('hex');
function options(argv){
  const result={model:'gemini-4-argon',manifest:path.join(root,'public/assets/universe.json'),output:path.join(root,'public/assets/gemini-universe.json'),
    prepareDir:path.resolve(root,'../../work/cyberalpine-gemini'),prepareOnly:false,secretName:'GEMINI_API_KEY',help:false};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];if(flag==='--prepare-only'){result.prepareOnly=true;continue;}
    if(flag==='--help'||flag==='-h'){result.help=true;continue;}
    const key={'--model':'model','--manifest':'manifest','--output':'output','--prepare-dir':'prepareDir','--secret-project':'secretProject','--secret-name':'secretName'}[flag];
    if(!key||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Unknown or incomplete CLI option.');
    result[key]=argv[++i];
  }
  return result;
}
function keyFromEnvironmentOrSecret(project,secretName){
  let key=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY||'';
  if(!key&&project){
    if(!/^[a-z][a-z0-9-]{4,62}$/.test(project))throw Error('Invalid Firebase project ID.');
    if(!/^[A-Za-z_][A-Za-z0-9_-]{0,254}$/.test(secretName))throw Error('Invalid Firebase secret name.');
    const result=spawnSync('firebase',['functions:secrets:access',secretName,'--project',project],
      {encoding:'utf8',timeout:30000,maxBuffer:65536,stdio:['ignore','pipe','pipe']});
    if(result.error||result.status!==0)throw Error('Could not access the selected secret in the Firebase project.');
    key=result.stdout.trim();
  }
  key=key.trim();
  if(!key)throw Error('Missing API key. Set GEMINI_API_KEY or GOOGLE_API_KEY, or use --secret-project ID.');
  if(/\s|[\x00-\x1f\x7f]/.test(key)||key.length>4096)throw Error('API key has an invalid format.');
  return key;
}
async function boundedResponse(response){
  const chunks=[];let total=0;
  for await(const chunk of response.body){total+=chunk.byteLength;if(total>1048576)throw Error('Google response exceeded the 1 MiB limit.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Google returned unreadable JSON.');}
}
async function main(){
  const args=options(process.argv.slice(2));
  if(args.help){console.log('Usage: node scripts/generate-gemini-universe.mjs [--prepare-only] [--model ID] [--manifest FILE] [--output FILE] [--prepare-dir DIR] [--secret-project ID] [--secret-name NAME]\nCredentials: GEMINI_API_KEY or GOOGLE_API_KEY; optional Firebase secret (default GEMINI_API_KEY).\nPreparation makes no API call. Generation writes an artifact only after strict validation.');return;}
  const raw=await fs.readFile(args.manifest);
  let manifest;try{manifest=JSON.parse(raw);}catch{throw Error('The universe manifest is not valid JSON.');}
  const context=compileContext(manifest),request=buildRequest(context,args.model);
  const bindings={sourceSnapshotSha256:manifest.sourceSnapshotSha256,universeManifestSha256:sha(raw),inputContextSha256:sha(JSON.stringify(context))};
  if(args.prepareOnly){
    await fs.mkdir(args.prepareDir,{recursive:true});
    await fs.writeFile(path.join(args.prepareDir,'context.json'),JSON.stringify(context,null,2)+'\n');
    await fs.writeFile(path.join(args.prepareDir,'request.json'),JSON.stringify(request,null,2)+'\n');
    await fs.writeFile(path.join(args.prepareDir,'bindings.json'),JSON.stringify({...bindings,promptVersion:PROMPT_VERSION},null,2)+'\n');
    console.log(JSON.stringify({status:'prepared',model:args.model,directory:args.prepareDir,datasets:context.datasets.length}));return;
  }
  const key=keyFromEnvironmentOrSecret(args.secretProject,args.secretName);
  let response;
  try{response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(request),signal:AbortSignal.timeout(120000)});}
  catch{throw Error('Could not complete the Google request. Check connectivity and model access; no artifact was written.');}
  if(!response.ok)throw Error(`Google generation failed (HTTP ${response.status}); no artifact was written.`);
  const data=await boundedResponse(response),plan=validatePlan(parseResponse(data),manifest);
  const artifact={status:'generated',model:args.model,generatedAt:new Date().toISOString(),...bindings,
    plan,promptVersion:PROMPT_VERSION,responseId:typeof data.id==='string'?data.id.slice(0,256):null};
  await fs.mkdir(path.dirname(args.output),{recursive:true});
  const temporary=args.output+`.tmp-${process.pid}`;
  try{await fs.writeFile(temporary,JSON.stringify(artifact,null,2)+'\n');await fs.rename(temporary,args.output);}
  catch{await fs.rm(temporary,{force:true});throw Error('Could not save the validated artifact.');}
  console.log(JSON.stringify({status:'generated',model:args.model,output:args.output,datasets:plan.datasets.length,...bindings}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/assets/beyondscape-audio.js',import.meta.url),'utf8');
const {soundParameters,createBeyondscapeAudio}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

class Param{
 constructor(value=0){this.value=value;this.calls=[];}
 setValueAtTime(value,time){this.value=value;this.calls.push({value,time});}
 setTargetAtTime(value,time){this.value=value;this.calls.push({value,time});}
 linearRampToValueAtTime(value,time){this.value=value;this.calls.push({value,time});}
 exponentialRampToValueAtTime(value,time){this.value=value;this.calls.push({value,time});}
 cancelScheduledValues(){}
}
class AudioNode{
 constructor(){this.frequency=new Param();this.gain=new Param();this.Q=new Param();for(const p of ['threshold','knee','ratio','attack','release'])this[p]=new Param();this.connections=[];this.stopped=false;}
 connect(node){this.connections.push(node);}
 disconnect(){this.disconnected=true;}
 start(time=0){this.started=time;}
 stop(time){if(time===undefined){this.stopped=true;this.onended?.();}else this.end=time;}
}
class FakeContext extends EventTarget{
 constructor(){super();this.state='suspended';this.currentTime=0;this.destination={};this.oscillators=[];FakeContext.instances.push(this);}
 createGain(){return new AudioNode();}
 createBiquadFilter(){return new AudioNode();}
 createDynamicsCompressor(){return new AudioNode();}
 createOscillator(){const node=new AudioNode();this.oscillators.push(node);return node;}
 async resume(){this.state='running';this.dispatchEvent(new Event('statechange'));}
 async suspend(){this.state='suspended';this.dispatchEvent(new Event('statechange'));}
 async close(){this.state='closed';this.dispatchEvent(new Event('statechange'));}
 static instances=[];
}
class FakeDocument extends EventTarget{hidden=false;setHidden(value){this.hidden=value;this.dispatchEvent(new Event('visibilitychange'));}}
function fixture(t,Context=FakeContext){
 const callbacks=new Map();let next=0;
 t.mock.method(globalThis,'setInterval',callback=>{callbacks.set(++next,callback);return next;});
 t.mock.method(globalThis,'clearInterval',id=>callbacks.delete(id));
 const documentRef=new FakeDocument(),states=[];
 const engine=createBeyondscapeAudio({AudioContextClass:Context,documentRef,onState:state=>states.push(state)});
 t.after(()=>engine.dispose());
 return {engine,documentRef,states,callbacks,get context(){return FakeContext.instances.at(-1);}};
}
const flush=()=>new Promise(resolve=>queueMicrotask(resolve));

test('musical mappings are finite, bounded and differ by region without reading raw values',()=>{
 const bad=soundParameters({progress:Infinity,normalizedValue:NaN,rootFrequency:-100,tempo:1e9,brightness:-4,region:'made-up'});
 assert.equal(bad.rootFrequency,110);assert.equal(bad.tempo,104);assert.equal(bad.brightness,.1);
 for(const value of Object.values(bad))if(typeof value==='number')assert.ok(Number.isFinite(value));
 assert.equal(soundParameters({rootFrequency:999}).rootFrequency,440);
 assert.equal(soundParameters({region:'base'}).waveform,'triangle');
 assert.notEqual(soundParameters({region:'forest'}).cutoff,soundParameters({region:'ice'}).cutoff);
 assert.deepEqual(soundParameters({value:1e20}),soundParameters({value:-1e20}));
});

test('sound is off and no context exists until explicit start; real running context is reported',async t=>{
 const before=FakeContext.instances.length,{engine,callbacks}=fixture(t);
 assert.equal(engine.getState().status,'ready');assert.equal(engine.getState().contextState,'not-created');
 assert.equal(FakeContext.instances.length,before);assert.equal(callbacks.size,0);
 const state=await engine.start();assert.equal(state.status,'playing');assert.equal(state.contextState,'running');assert.equal(state.playing,true);
 assert.equal(callbacks.size,1);assert.ok(state.scheduledVoices>0);assert.ok(state.scheduledVoices<=16);
});

test('an autoplay-blocked suspended context is never labelled playing',async t=>{
 class BlockedContext extends FakeContext{async resume(){}}
 const {engine,callbacks}=fixture(t,BlockedContext),state=await engine.start();
 assert.equal(state.status,'paused');assert.equal(state.contextState,'suspended');assert.equal(state.playing,false);assert.equal(state.scheduledVoices,0);assert.equal(callbacks.size,0);
});

test('stop silences all current and future voices and a later start has one scheduler',async t=>{
 const f=fixture(t);await f.engine.start();const oldTick=[...f.callbacks.values()][0],ctx=f.context;
 assert.ok(ctx.oscillators.length);f.engine.stop();await flush();
 assert.equal(f.callbacks.size,0);assert.equal(f.engine.getState().status,'ready');assert.equal(f.engine.getState().scheduledVoices,0);
 assert.ok(ctx.oscillators.every(o=>o.stopped));const count=ctx.oscillators.length;oldTick();assert.equal(ctx.oscillators.length,count);
 await f.engine.start();await f.engine.start();assert.equal(f.callbacks.size,1);
});

test('hidden playback suspends and visible playback resumes only if it was active',async t=>{
 const f=fixture(t);f.documentRef.setHidden(true);f.documentRef.setHidden(false);assert.equal(f.engine.getState().contextState,'not-created');
 await f.engine.start();f.documentRef.setHidden(true);await flush();
 assert.equal(f.engine.getState().status,'paused');assert.equal(f.engine.getState().contextState,'suspended');assert.equal(f.callbacks.size,0);
 f.documentRef.setHidden(false);await flush();assert.equal(f.engine.getState().status,'playing');assert.equal(f.callbacks.size,1);
});

test('a manual stop while hidden prevents a visibility change from restarting sound',async t=>{
 const f=fixture(t);await f.engine.start();f.documentRef.setHidden(true);f.engine.stop();await flush();f.documentRef.setHidden(false);await flush();
 assert.equal(f.engine.getState().status,'ready');assert.equal(f.engine.getState().playing,false);assert.equal(f.callbacks.size,0);
});

test('a quick hide and show waits for pending suspension before resuming',async t=>{
 let completeSuspend;
 class SlowSuspendContext extends FakeContext{
  suspend(){return new Promise(resolve=>{completeSuspend=()=>{this.state='suspended';this.dispatchEvent(new Event('statechange'));resolve();};});}
 }
 const f=fixture(t,SlowSuspendContext);await f.engine.start();f.documentRef.setHidden(true);f.documentRef.setHidden(false);
 assert.equal(f.callbacks.size,0);completeSuspend();await flush();await flush();
 assert.equal(f.engine.getState().status,'playing');assert.equal(f.context.state,'running');assert.equal(f.callbacks.size,1);
});

test('starting on a hidden document stays silent and does not create an autoplay request later',async t=>{
 const f=fixture(t);f.documentRef.setHidden(true);const state=await f.engine.start();
 assert.equal(state.status,'paused');assert.equal(state.contextState,'not-created');f.documentRef.setHidden(false);await flush();assert.equal(f.callbacks.size,0);assert.equal(f.engine.getState().playing,false);
});

test('mute and volume act through bounded output gain while preserving playback intent',async t=>{
 const f=fixture(t);await f.engine.start();assert.equal(f.engine.setMuted(true).status,'muted');assert.equal(f.engine.getState().playing,true);
 assert.equal(f.engine.setMuted(false).status,'playing');assert.equal(f.engine.setVolume(99).volume,1);
 assert.equal(f.engine.setVolume(0).status,'muted');assert.equal(f.engine.setVolume(NaN).volume,.35);
 f.engine.setTelemetry({region:'ice',rootFrequency:220,tempo:104});assert.equal(f.engine.getState().region,'ice');assert.equal(f.engine.getState().rootFrequency,220);
});

test('long clock gaps skip stale notes and keep voices and the scheduling horizon bounded',async t=>{
 const f=fixture(t);await f.engine.start();const tick=[...f.callbacks.values()][0],ctx=f.context;
 for(let i=1;i<200;i++){ctx.currentTime=i*30;tick();assert.ok(f.engine.getState().scheduledVoices<=16);}
 const current=ctx.oscillators.filter(o=>!o.stopped&&o.end>ctx.currentTime);
 assert.ok(current.length<6);assert.ok(current.every(o=>o.started<=ctx.currentTime+.34));
});

test('unsupported audio and disposal produce honest states without listeners restarting sound',async t=>{
 const unsupported=createBeyondscapeAudio({AudioContextClass:null,documentRef:null});assert.equal((await unsupported.start()).status,'unsupported');unsupported.dispose();
 const f=fixture(t);await f.engine.start();f.engine.dispose();await flush();assert.equal(f.engine.getState().disposed,true);assert.equal(f.context.state,'closed');assert.equal(f.callbacks.size,0);
 f.documentRef.setHidden(true);f.documentRef.setHidden(false);await flush();assert.equal(f.callbacks.size,0);assert.equal((await f.engine.start()).status,'error');
});

/* Original procedural soundtrack. Source records choose a display mapping;
 * musical pitch, tempo and timbre are not measurements or importance scores.
 * Audio starts only after start() is called from a user action. No microphone,
 * media files, remote calls, or device permissions are used. */
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const REGIONS=new Set(['base','forest','ice']);
const PENTATONIC=[1,9/8,5/4,3/2,5/3];
const LOOKAHEAD=.34,MAX_VOICES=16;

export function soundParameters(telemetry={}){
 const input=telemetry&&typeof telemetry==='object'?telemetry:{};
 const progress=clamp(finite(input.progress,0),0,1);
 const normalizedValue=clamp(finite(input.normalizedValue,.5),0,1);
 const region=REGIONS.has(input.region)?input.region:progress>.7?'ice':progress>.25?'forest':'base';
 const rootFrequency=clamp(finite(input.rootFrequency,146.83),110,440);
 const tempo=clamp(finite(input.tempo,62+progress*28),56,104);
 const brightness=clamp(finite(input.brightness,.25+normalizedValue*.5),.1,1);
 const cutoff=(region==='ice'?1300:region==='forest'?450:650)+brightness*(region==='ice'?2200:1500);
 return {progress,normalizedValue,region,rootFrequency,tempo,brightness,cutoff,
  waveform:region==='base'?'triangle':'sine',
  noteDuration:region==='ice'?.95:region==='forest'?.72:.5,
  noteGain:region==='ice'?.06:region==='forest'?.075:.065,
  mapping:'Within-series normalized values color a pentatonic score; altitude and tempo are display choices.'};
}

export function createBeyondscapeAudio({onState=()=>{},AudioContextClass=globalThis.AudioContext||globalThis.webkitAudioContext,documentRef=globalThis.document}={}){
 let context=null,master=null,filter=null,compressor=null,drone=null,droneGain=null,timer=null;
 let parameters=soundParameters(),volume=.35,muted=false,status=typeof AudioContextClass==='function'?'ready':'unsupported';
 let desiredPlaying=false,running=false,resumeOnVisible=false,disposed=false,error=null,operation=0,nextNoteTime=0,step=0,pendingSuspension=null;
 const voices=new Set(),isHidden=()=>Boolean(documentRef?.hidden);
 const getState=()=>({status,contextState:context?.state||'not-created',supported:typeof AudioContextClass==='function',
  playing:running&&context?.state==='running'&&!isHidden(),muted,volume,region:parameters.region,
  tempo:parameters.tempo,rootFrequency:parameters.rootFrequency,brightness:parameters.brightness,
  scheduledVoices:voices.size+(drone?1:0),lookaheadSeconds:LOOKAHEAD,error,disposed});
 function emit(){try{onState(getState());}catch{/* A consumer cannot break audio cleanup. */}}
 function actualStatus(){
  if(disposed)return 'ready';
  if(typeof AudioContextClass!=='function')return 'unsupported';
  if(error)return 'error';
  if(running&&context?.state==='running'&&!isHidden())return muted||volume===0?'muted':'playing';
  return desiredPlaying?'paused':'ready';
 }
 function updateStatus(){status=actualStatus();emit();return getState();}
 function setParam(param,value,timeConstant=.06){
  if(!param||!context)return;
  if(typeof param.setTargetAtTime==='function')param.setTargetAtTime(value,context.currentTime,timeConstant);
  else param.value=value;
 }
 function updateGraph(){
  if(!context)return;
  setParam(master?.gain,running&&!muted&&!isHidden()?volume*.18:0,.025);
  setParam(filter?.frequency,parameters.cutoff,.25);
  if(drone){drone.type=parameters.waveform;setParam(drone.frequency,parameters.rootFrequency*.5,.3);}
 }
 function cleanupVoice(voice){
  if(!voices.delete(voice))return;
  try{voice.oscillator.disconnect();}catch{}
  try{voice.gain.disconnect();}catch{}
 }
 function stopVoice(voice){try{voice.oscillator.stop();}catch{}cleanupVoice(voice);}
 function halt(){
  running=false;
  if(timer!==null){clearInterval(timer);timer=null;}
  for(const voice of [...voices])stopVoice(voice);
  if(drone){try{drone.stop();}catch{}try{drone.disconnect();}catch{}drone=null;}
  if(droneGain){try{droneGain.disconnect();}catch{}droneGain=null;}
  if(master&&context){try{master.gain.cancelScheduledValues(context.currentTime);master.gain.setValueAtTime(0,context.currentTime);}catch{master.gain.value=0;}}
 }
 function createGraph(){
  if(context)return;
  context=new AudioContextClass();
  master=context.createGain();master.gain.value=0;
  filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=parameters.cutoff;filter.Q.value=.35;
  compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-12;compressor.knee.value=18;compressor.ratio.value=8;compressor.attack.value=.008;compressor.release.value=.25;
  filter.connect(master);master.connect(compressor);compressor.connect(context.destination);
  context.addEventListener?.('statechange',contextChanged);
 }
 function suspendContext(){
  if(!context||context.state==='closed')return Promise.resolve();
  try{
   const suspension=Promise.resolve(context.suspend()).catch(()=>{});
   pendingSuspension=suspension;
   void suspension.then(()=>{if(pendingSuspension===suspension)pendingSuspension=null;});
   return suspension;
  }catch{return Promise.resolve();}
 }
 function contextChanged(){
  if(disposed)return;
  if(context?.state!=='running'&&running)halt();
  updateStatus();
 }
 function addNote(frequency,gainValue,at,duration,type){
  if(voices.size+(drone?1:0)>=MAX_VOICES)return;
  const oscillator=context.createOscillator(),gain=context.createGain();
  const when=clamp(at,context.currentTime,context.currentTime+LOOKAHEAD);
  oscillator.type=type;oscillator.frequency.setValueAtTime(clamp(frequency,27.5,1760),when);
  gain.gain.setValueAtTime(.0001,when);gain.gain.linearRampToValueAtTime(gainValue,when+.035);
  gain.gain.exponentialRampToValueAtTime(.0001,when+duration);
  oscillator.connect(gain);gain.connect(filter);
  const voice={oscillator,gain,end:when+duration+.03};voices.add(voice);
  oscillator.onended=()=>cleanupVoice(voice);
  oscillator.start(when);oscillator.stop(voice.end);
 }
 function schedule(){
  if(!running||!desiredPlaying||disposed||isHidden()||context?.state!=='running')return;
  for(const voice of [...voices])if(voice.end<context.currentTime)cleanupVoice(voice);
  // A sleeping device skips missed notes rather than bursting on return.
  if(nextNoteTime<context.currentTime-.1)nextNoteTime=context.currentTime+.025;
  let scheduled=0;
  while(nextNoteTime<context.currentTime+LOOKAHEAD&&scheduled++<4){
   const pitch=PENTATONIC[(step+Math.round(parameters.normalizedValue*4))%PENTATONIC.length];
   const octave=parameters.region==='ice'?2:1;
   addNote(parameters.rootFrequency*pitch*octave,parameters.noteGain,nextNoteTime,parameters.noteDuration,parameters.waveform);
   if(step%4===0)addNote(parameters.rootFrequency*.25,.07,nextNoteTime,.14,'sine');
   nextNoteTime+=30/parameters.tempo;step++;
  }
 }
 function begin(){
  halt();running=true;
  drone=context.createOscillator();droneGain=context.createGain();drone.type=parameters.waveform;
  drone.frequency.value=parameters.rootFrequency*.5;droneGain.gain.value=.04;drone.connect(droneGain);droneGain.connect(filter);drone.start();
  nextNoteTime=context.currentTime+.025;updateGraph();schedule();
  timer=setInterval(schedule,150);timer?.unref?.();
 }
 async function start(){
  if(disposed){error='This soundtrack has been disposed.';status='error';emit();return getState();}
  if(typeof AudioContextClass!=='function'){status='unsupported';emit();return getState();}
  desiredPlaying=true;resumeOnVisible=false;error=null;const token=++operation;
  if(isHidden()){status='paused';emit();return getState();}
  try{
   createGraph();
   // A fast app switch can return before the audio thread completes suspend.
   // Finish that operation before resuming, rather than racing its late result.
   if(pendingSuspension)await pendingSuspension;
   if(token!==operation||disposed||!desiredPlaying)return getState();
   if(context.state!=='running')await context.resume();
   if(token!==operation||disposed||!desiredPlaying)return getState();
   if(isHidden()){halt();await suspendContext();return updateStatus();}
   if(context.state!=='running'){halt();return updateStatus();}
   begin();return updateStatus();
  }catch{if(token===operation&&!disposed){halt();desiredPlaying=false;error='Audio could not start. Try Play again.';updateStatus();}return getState();}
 }
 function stop(){
  ++operation;desiredPlaying=false;resumeOnVisible=false;error=null;halt();
  const token=operation;
  void suspendContext().then(()=>{if(token===operation&&!disposed)updateStatus();});
  return updateStatus();
 }
 function setMuted(value){muted=Boolean(value);updateGraph();return updateStatus();}
 function setVolume(value){volume=clamp(finite(value,.35),0,1);updateGraph();return updateStatus();}
 function setTelemetry(value){parameters=soundParameters(value);updateGraph();return updateStatus();}
 function visibilityChanged(){
  if(disposed)return;
  if(isHidden()){
   resumeOnVisible=desiredPlaying&&running&&context?.state==='running';
   ++operation;halt();updateStatus();
   void suspendContext();
  }else if(resumeOnVisible&&desiredPlaying){resumeOnVisible=false;void start();}
 }
 documentRef?.addEventListener?.('visibilitychange',visibilityChanged);
 function dispose(){
  if(disposed)return;
  stop();disposed=true;documentRef?.removeEventListener?.('visibilitychange',visibilityChanged);
  context?.removeEventListener?.('statechange',contextChanged);
  for(const node of [filter,master,compressor])try{node?.disconnect();}catch{}
  if(context&&context.state!=='closed')Promise.resolve(context.close()).catch(()=>{});
  status='ready';emit();
 }
 return {start,stop,setMuted,setVolume,setTelemetry,getState,dispose};
}

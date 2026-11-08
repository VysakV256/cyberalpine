/* Standalone Meta Ray-Ban Display web HUD. No hardware connection is inferred
 * from screen size or browser identity. Also usable as a browser preview. */
import {buildBeyondscapeRoute,routeTelemetry,parseRouteOptions,routeShareURL} from './beyondscape-routes.js';
import {createBeyondscapeAudio} from './beyondscape-audio.js';
import {createRouteMirror} from './beyondscape-session.js';
const $=id=>document.getElementById(id),format=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
let manifest,options,route,index=0,mirror;
const audio=createBeyondscapeAudio({onState:s=>{
 $('hudSound').textContent=['playing','muted'].includes(s.status)?'Stop sound':'Start sound';
 $('hudSound').setAttribute('aria-pressed',String(['playing','muted'].includes(s.status)));
 $('hudSoundStatus').textContent=s.status==='playing'?`${s.region} · ${Math.round(s.tempo)} BPM · Enter: stop`:s.status==='unsupported'?'Audio unavailable':s.status==='paused'?'Audio paused':s.status==='muted'?'Muted':s.status==='error'?'Audio unavailable · try again':'Sound off · Enter: play';
}});
function loadRoute(id,hold=0,publish=true){const dataset=manifest.datasets.find(d=>d.id===id);if(!dataset||!options.selection.includes(id))return;route=buildBeyondscapeRoute(dataset);index=Math.max(0,Math.min(route.holds.length-1,hold));render(publish);}
function advance(delta){if(!route?.holds.length)return;index=Math.max(0,Math.min(route.holds.length-1,index+delta));render();}
function render(publish=true){
 const hold=route.holds[index],t=routeTelemetry(route,index);
 $('hudDataset').textContent=route.title;$('hudRecord').textContent=hold?.label||'No retained records';
 $('hudValue').textContent=Number.isFinite(t.value)?`${format(t.value)} ${t.unit||''}`:hold?.date||'Record metadata';
 $('hudProgress').value=t.progress;$('hudProgressText').textContent=hold?`${index+1} / ${route.holds.length} holds`:'No holds';
 $('hudRegion').textContent=t.region.toUpperCase();$('hudElevation').textContent=`${format(t.elevation)} m · display height`;
 $('hudPrevious').disabled=index<=0;$('hudNext').disabled=!hold||index>=route.holds.length-1;
 $('hudNext').textContent=index>=route.holds.length-1?'Complete':'Next ↑';audio.setTelemetry(t);if(t.silent)audio.stop();$('hudSound').disabled=t.silent;
 $('hudCompanion').href=routeShareURL(new URL('../beyondscape.html',import.meta.url).href,{datasetId:route.datasetId,selection:options.selection,holdIndex:index,session:options.session});
 history.replaceState(null,'',routeShareURL(location.href,{datasetId:route.datasetId,selection:options.selection,holdIndex:index,display:'meta',session:options.session}));
 if(publish)mirror?.publish({datasetId:route.datasetId,holdIndex:index});
}
function cycle(delta){const at=options.selection.indexOf(route.datasetId),next=(at+delta+options.selection.length)%options.selection.length;loadRoute(options.selection[next]);}
async function boot(){try{
 const response=await fetch('assets/universe.json',{cache:'no-cache'});if(!response.ok)throw Error('Source snapshot unavailable.');manifest=await response.json();options=parseRouteOptions(location.search,manifest);options.session=options.session||(crypto.randomUUID?.()||'hud-'+Date.now().toString(36));
 mirror=createRouteMirror({session:options.session,onUpdate:p=>loadRoute(p.datasetId,p.holdIndex,false)});
 $('hudNext').addEventListener('click',()=>advance(1));$('hudPrevious').addEventListener('click',()=>advance(-1));
 $('hudSound').addEventListener('click',async()=>{if(['playing','muted'].includes(audio.getState().status))audio.stop();else await audio.start();});
 document.addEventListener('keydown',event=>{if(event.repeat||event.altKey||event.ctrlKey||event.metaKey)return;if(event.key==='ArrowUp'){event.preventDefault();advance(1);}else if(event.key==='ArrowDown'){event.preventDefault();advance(-1);}else if(event.key==='ArrowLeft'){event.preventDefault();cycle(-1);}else if(event.key==='ArrowRight'){event.preventDefault();cycle(1);}else if(event.key==='Enter'&&event.target===document.body){event.preventDefault();advance(1);}});
 window.addEventListener('pagehide',event=>{audio.stop();if(!event.persisted){audio.dispose();mirror?.close();}});
 loadRoute(options.datasetId,options.holdIndex);$('hudLoading').hidden=true;$('hudSound').focus({preventScroll:true});
}catch(error){$('hudLoading').hidden=true;$('hudError').hidden=false;$('hudError').textContent=error.message||'Could not open the data route.';}}
boot();

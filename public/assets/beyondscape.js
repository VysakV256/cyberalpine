import * as THREE from '../vendor/three.module.js';
import {buildBeyondscapeRoute,routeTelemetry,faceSurface,parseRouteOptions,routeShareURL} from './beyondscape-routes.js';
import {createBeyondscapeAudio} from './beyondscape-audio.js';
import {createRouteMirror} from './beyondscape-session.js';
import {createAlpineForest} from './alpine-vegetation.js';
const $=id=>document.getElementById(id),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const format=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(v);
let manifest,options,route,current=0,gaze=false,mirror,renderer,scene,camera,rockGroup,holdMeshes=[],line,forest,hidden=document.hidden;
let last=0,drag=null,moved=false;
const aim=new THREE.Vector3(0,10,0),targetAim=aim.clone(),targetCamera=new THREE.Vector3(21,16,34),raycaster=new THREE.Raycaster();
const audio=createBeyondscapeAudio({onState:updateSound});
function updateSound(s){
 $('soundStatus').textContent=s.status==='playing'?`${s.region} · ${Math.round(s.tempo)} BPM`:s.status==='muted'?'Soundtrack muted':s.status==='unsupported'?'Audio is unavailable in this browser':s.status==='error'?'Audio could not start; try again':s.status==='paused'?'Soundtrack paused':'Soundtrack off · tap to start';
 $('soundToggle').textContent=['playing','muted'].includes(s.status)?'Stop soundtrack':'Start soundtrack';
 $('soundToggle').setAttribute('aria-pressed',String(['playing','muted'].includes(s.status)));
 $('soundMute').textContent=s.muted?'Unmute':'Mute';$('soundMute').setAttribute('aria-pressed',String(s.muted));
}
function publish(){mirror?.publish({datasetId:route.datasetId,holdIndex:current});}
function selectRoute(id,index=0,broadcast=true){
 const d=manifest.datasets.find(d=>d.id===id);if(!d)return;
 route=buildBeyondscapeRoute(d);current=Math.max(0,Math.min(route.holds.length-1,index));$('routeSelect').value=id;
 buildFace();renderRecord();moveCamera(true);if(broadcast)publish();
}
function renderRecord(){
 const h=route.holds[current],t=routeTelemetry(route,current);
 $('routeTitle').textContent=route.title;$('holdTitle').textContent=h?.label||'No retained records';
 $('holdValue').textContent=Number.isFinite(t.value)?`${format(t.value)} ${t.unit||''}`:route.derived?'Derived record':'Publication metadata';
 $('holdDate').textContent=h?.date||'Date not supplied';$('climbProgress').value=t.progress;
 $('climbProgressText').textContent=route.holds.length?`Hold ${current+1} / ${route.holds.length}`:'No holds';
 $('climbElevation').textContent=`${format(t.elevation)} m`;$('climbRegion').textContent=t.region;
 $('climbTempo').textContent=`${Math.round(t.tempo)} BPM`;
 $('climbPrevious').disabled=current<=0;$('climbNext').disabled=!h||current>=route.holds.length-1;$('mobileClimbPrevious').disabled=current<=0;$('mobileClimbNext').disabled=!h||current>=route.holds.length-1;$('mobileClimbPosition').textContent=route.holds.length?`${current+1} / ${route.holds.length}`:'No holds';
 $('climbNext').textContent=current===route.holds.length-1?'Route complete':'Reach next hold ↑';
 $('holdSource').hidden=!h?.sourceUrl;if(h?.sourceUrl)$('holdSource').href=h.sourceUrl;
 $('routeMapping').textContent=`${route.sourceCount} ${route.derived?'derived':'retained source'} records → ${route.holds.length} sampled holds. Height is route progress in display metres; pitch follows within-series values where available. Position and sound are authored mappings.`;
 $('holdList').replaceChildren(...route.holds.map((hold,i)=>{const b=document.createElement('button');b.type='button';b.className='route-hold'+(i===current?' active':'');b.textContent=String(i+1).padStart(2,'0');b.title=hold.label;b.setAttribute('aria-label',`Inspect hold ${i+1}: ${hold.label}`);if(i===current)b.setAttribute('aria-current','step');b.addEventListener('click',()=>setHold(i));return b;}));
 for(const [i,mesh] of holdMeshes.entries()){mesh.material.color.set(i===current?'#d8ffff':i<current?'#48c98a':'#6babb7');mesh.material.emissive.set(i===current?'#95eaff':i<current?'#12583a':'#102b36');mesh.material.emissiveIntensity=i===current?.8:.25;mesh.scale.setScalar(i===current?1.35:1);}
 audio.setTelemetry(t);if(t.silent)audio.stop();$('soundToggle').disabled=t.silent;
 const share=routeShareURL(new URL('../glasses.html',import.meta.url).href,{datasetId:route.datasetId,selection:options.selection,holdIndex:current,session:options.session});
 $('glassesLink').href=share;
 history.replaceState(null,'',routeShareURL(location.href,{datasetId:route.datasetId,selection:options.selection,holdIndex:current,session:options.session}));
}
function setHold(i,broadcast=true){if(!route?.holds.length)return;current=Math.max(0,Math.min(route.holds.length-1,i));renderRecord();if(gaze)moveCamera();if(broadcast)publish();}
function moveCamera(reset=false){
 if(gaze&&route.holds[current]){const p=route.holds[current].position;targetCamera.set(p.x+3,p.y+2,p.z+10);targetAim.set(p.x,p.y+.3,p.z);}
 else if(reset){targetCamera.set(21,16,34);targetAim.set(0,10,1);}
 if(reduced){camera.position.copy(targetCamera);aim.copy(targetAim);}
}
function disposeGroup(group){if(!group)return;group.userData.dispose?.();group.traverse(o=>{o.geometry?.dispose();for(const m of(Array.isArray(o.material)?o.material:[o.material]))m?.dispose();});group.removeFromParent();}
function rockTexture(){
 const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d'),im=ctx.createImageData(512,512);
 const hash=(x,y)=>{const v=Math.sin(x*127.1+y*311.7)*43758.5453;return v-Math.floor(v);};
 const noise=(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);return (hash(ix,iy)*(1-u)+hash(ix+1,iy)*u)*(1-v)+(hash(ix,iy+1)*(1-u)+hash(ix+1,iy+1)*u)*v;};
 for(let y=0;y<512;y++)for(let x=0;x<512;x++){const n=noise(x/28,y/28)*.48+noise(x/9,y/9)*.27+noise(x/3,y/3)*.17+hash(x,y)*.08;const seam=Math.pow(Math.abs(Math.sin(x*.023+y*.047+noise(x/65,y/65)*7)),22),v=90+n*135-seam*38,i=(y*512+x)*4;im.data[i]=v;im.data[i+1]=v+3;im.data[i+2]=v+6;im.data[i+3]=255;}
 ctx.putImageData(im,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(2,3);t.colorSpace=THREE.SRGBColorSpace;return t;
}
let texture;
function initScene(){
 renderer=new THREE.WebGLRenderer({canvas:$('climbCanvas'),antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 scene=new THREE.Scene();scene.background=new THREE.Color('#aac9d1');scene.fog=new THREE.FogExp2('#aac9d1',.008);camera=new THREE.PerspectiveCamera(43,1,.1,350);camera.position.copy(targetCamera);
 scene.add(new THREE.HemisphereLight('#e1faff','#153a28',2.3));const sun=new THREE.DirectionalLight('#eefcff',3.1);sun.position.set(-20,35,27);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-35;sun.shadow.camera.right=35;sun.shadow.camera.top=35;sun.shadow.camera.bottom=-35;sun.shadow.normalBias=.04;scene.add(sun);const rim=new THREE.DirectionalLight('#76bfa7',1);rim.position.set(20,18,-20);scene.add(rim);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(160,160),new THREE.MeshStandardMaterial({color:'#1c4535',roughness:1}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
 texture=rockTexture();
 const trees=Array.from({length:95},(_,i)=>{const a=i*2.39996,r=22+(i%11)*2.1;return{x:Math.cos(a)*r,y:0,z:Math.sin(a)*r-10,height:4+(i%7)*.5,canopy:1.4+(i%4)*.15,recordId:'decorative-'+i}});
 forest=createAlpineForest(THREE,trees.filter(t=>t.z<-4||Math.abs(t.x)>29));scene.add(forest);
 const resize=()=>{const r=$('climbCanvas').getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();};new ResizeObserver(resize).observe($('climbCanvas'));resize();
 requestAnimationFrame(frame);
}
function buildFace(){
 disposeGroup(rockGroup);rockGroup=new THREE.Group();scene.add(rockGroup);holdMeshes=[];
 const nx=72,ny=96,vertices=[],colors=[],uv=[],indices=[],color=new THREE.Color();
 const faceHeight=24,halfWidth=y=>y<18?7.3-.1*y+.35*Math.sin(y*.57):Math.max(.06,5.25*Math.sqrt(Math.max(0,1-((y-18)/6)**2)));
 for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const y=j/ny*faceHeight,x=(i/nx*2-1)*halfWidth(y),z=faceSurface(x,y);vertices.push(x,y,z);uv.push(i/nx,j/ny);color.set('#536d76');if(y<4)color.lerp(new THREE.Color('#2b5e43'),(4-y)/5);if(y>17)color.lerp(new THREE.Color('#b9e4eb'),(y-17)/6);color.multiplyScalar(.87+Math.sin(x*3.4+y*.8)*.1);colors.push(color.r,color.g,color.b);if(j<ny&&i<nx){const a=j*(nx+1)+i,b=a+nx+1;indices.push(a,a+1,b,a+1,b+1,b);}}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,map:texture,bumpMap:texture,bumpScale:.2,roughness:.9,side:THREE.DoubleSide});const face=new THREE.Mesh(geometry,mat);face.castShadow=true;face.receiveShadow=true;rockGroup.add(face);
 const sideVertices=[],sideIndices=[],sideUV=[];for(const sign of[-1,1])for(let j=0;j<ny;j++){const y=j/ny*faceHeight,yy=(j+1)/ny*faceHeight,x=sign*halfWidth(y),xx=sign*halfWidth(yy),a=sideVertices.length/3;sideVertices.push(x,y,faceSurface(x,y),x,y,-3,xx,yy,-3,xx,yy,faceSurface(xx,yy));sideIndices.push(a,a+1,a+2,a,a+2,a+3);sideUV.push(0,y/faceHeight,1,y/faceHeight,1,yy/faceHeight,0,yy/faceHeight);}
 const sides=new THREE.BufferGeometry();sides.setAttribute('position',new THREE.Float32BufferAttribute(sideVertices,3));sides.setAttribute('uv',new THREE.Float32BufferAttribute(sideUV,2));sides.setIndex(sideIndices);sides.computeVertexNormals();const side=new THREE.Mesh(sides,new THREE.MeshStandardMaterial({color:'#667c83',map:texture,bumpMap:texture,bumpScale:.25,roughness:.95,side:THREE.DoubleSide}));side.castShadow=true;rockGroup.add(side);
 for(const hold of route.holds){const material=new THREE.MeshStandardMaterial({color:'#8ddde5',roughness:.4,emissive:'#173c4c',emissiveIntensity:.3});const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(.25,1),material);mesh.position.set(hold.position.x,hold.position.y,hold.position.z);mesh.geometry.scale(1.3,.65,.7);mesh.userData.index=hold.index;rockGroup.add(mesh);holdMeshes.push(mesh);}
 if(route.holds.length>1){const points=route.holds.map(h=>new THREE.Vector3(h.position.x,h.position.y,h.position.z+.08));line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:'#b6f9f0',dashSize:.2,gapSize:.19,transparent:true,opacity:.45}));line.computeLineDistances();rockGroup.add(line);}
}
function frame(time){requestAnimationFrame(frame);const dt=Math.min(.05,last?(time-last)/1000:.016);last=time;if(hidden)return;const k=reduced?1:Math.min(1,dt*5);camera.position.lerp(targetCamera,k);aim.lerp(targetAim,k);camera.lookAt(aim);renderer.render(scene,camera);}
function bind(){
 audio.setVolume(Number($('soundVolume').value));
 $('mobileClimbNext').addEventListener('click',()=>setHold(current+1));$('mobileClimbPrevious').addEventListener('click',()=>setHold(current-1));
 $('routeSelect').addEventListener('change',()=>selectRoute($('routeSelect').value));$('climbNext').addEventListener('click',()=>setHold(current+1));$('climbPrevious').addEventListener('click',()=>setHold(current-1));$('climbReset').addEventListener('click',()=>setHold(0));
 $('viewToggle').addEventListener('click',()=>{gaze=!gaze;$('viewToggle').textContent=gaze?'Overview':'Explorer gaze';$('viewToggle').setAttribute('aria-pressed',String(gaze));moveCamera(true);});
 $('soundToggle').addEventListener('click',async()=>{const s=audio.getState();if(['playing','muted'].includes(s.status))audio.stop();else await audio.start();});$('soundMute').addEventListener('click',()=>audio.setMuted(!audio.getState().muted));$('soundVolume').addEventListener('input',()=>audio.setVolume(Number($('soundVolume').value)));
 $('shareRoute').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('glassesLink').href);$('shareStatus').textContent='Glasses URL copied with this route and hold.';}catch{$('shareStatus').textContent='Copy the address from Open glasses HUD.';}});
 const canvas=$('climbCanvas');canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,y:e.clientY};moved=false;canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};if(Math.abs(dx)+Math.abs(dy)<2)return;moved=true;gaze=false;$('viewToggle').textContent='Explorer gaze';$('viewToggle').setAttribute('aria-pressed','false');const offset=targetCamera.clone().sub(targetAim),s=new THREE.Spherical().setFromVector3(offset);s.theta=Math.max(-1.1,Math.min(1.1,s.theta-dx*.006));s.phi=Math.max(.25,Math.min(1.65,s.phi+dy*.004));targetCamera.copy(targetAim).add(offset.setFromSpherical(s));});for(const type of['pointerup','pointercancel'])canvas.addEventListener(type,()=>drag=null);
 canvas.addEventListener('click',e=>{if(moved)return;const r=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=raycaster.intersectObjects(holdMeshes)[0];if(hit)setHold(hit.object.userData.index);});
 canvas.addEventListener('wheel',e=>{e.preventDefault();const offset=targetCamera.clone().sub(targetAim);offset.setLength(Math.max(7,Math.min(75,offset.length()*Math.exp(e.deltaY*.001))));targetCamera.copy(targetAim).add(offset);},{passive:false});
 document.addEventListener('keydown',e=>{if(e.repeat||['INPUT','SELECT','TEXTAREA','BUTTON','A'].includes(e.target.tagName)||e.target.isContentEditable||e.altKey||e.ctrlKey||e.metaKey)return;if(e.key==='ArrowUp'||e.key==='Enter'||e.code==='Space'){e.preventDefault();setHold(current+1);}if(e.key==='ArrowDown'){e.preventDefault();setHold(current-1);}if(e.key==='Home'){e.preventDefault();setHold(0);}});
 document.addEventListener('visibilitychange',()=>{hidden=document.hidden;drag=null;});window.addEventListener('pagehide',event=>{audio.stop();if(!event.persisted){audio.dispose();mirror?.close();}});
}
async function boot(){try{const r=await fetch('assets/universe.json',{cache:'no-cache'});if(!r.ok)throw Error('Source snapshot could not be loaded.');manifest=await r.json();options=parseRouteOptions(location.search,manifest);options.session=options.session||(crypto.randomUUID?.()||'route-'+Date.now().toString(36));const chosen=manifest.datasets.filter(d=>options.selection.includes(d.id));$('routeSelect').replaceChildren();for(const d of chosen){const o=document.createElement('option');o.value=d.id;o.textContent=d.name;$('routeSelect').append(o);}initScene();bind();mirror=createRouteMirror({session:options.session,onUpdate:p=>{if(!options.selection.includes(p.datasetId))return;if(p.datasetId===route.datasetId)setHold(p.holdIndex,false);else selectRoute(p.datasetId,p.holdIndex,false);},onStatus:()=>$('glassesNote').textContent='Same-browser HUD mirror active. On glasses, open the route URL as a standalone web app.'});selectRoute(options.datasetId,options.holdIndex);$('climbLoading').hidden=true;updateSound(audio.getState());$('glassesNote').textContent='Meta Ray-Ban Display: add the glasses URL as a Web App in the Meta AI app’s Developer Mode. The URL carries your dataset and hold; different devices run independently.';}
catch(error){$('climbLoading').hidden=true;$('climbError').hidden=false;$('climbError').textContent=error.message||'The route could not be loaded.';}}
boot();

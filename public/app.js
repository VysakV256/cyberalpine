import * as THREE from './vendor/three.module.js';
import './assets/terrain.js';
import {createAlpineForest} from './assets/alpine-vegetation.js';
import {createAlpineWater} from './assets/alpine-water.js';
import {createDataLandmarks} from './assets/data-landmarks.js';
import {createDataInspector} from './assets/data-inspector.js';
import {compileContext,validatePlan,validateBindings} from './assets/gemini-plan.js';
/* Local Three.js concept atlas. Source records stay in the downloaded manifest.
 * No credentials, remote provider calls, or robot kinematics are embedded. */
const $=id=>document.getElementById(id),canvas=$('landscape');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const safeText=(v,n=300)=>typeof v==='string'?v.slice(0,n):'';
const safeURL=v=>{try{const u=new URL(v);return u.protocol==='https:'?u.href:''}catch{return ''}};
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'})}catch(error){$('sceneLoading').textContent='This interactive atlas needs WebGL. The philosophy and source manifest remain available below.';throw error}
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));
renderer.setClearColor('#8faeb8');renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.93;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.fog=new THREE.FogExp2('#8bb0bd',.0031);
const camera=new THREE.PerspectiveCamera(46,1,.1,1500);camera.position.set(88,68,-100);
const aim=new THREE.Vector3(-2,8,-3),targetPosition=camera.position.clone(),targetAim=aim.clone();
scene.add(new THREE.HemisphereLight('#d8f3ff','#092719',1.35));
const sun=new THREE.DirectionalLight('#e7f4ff',3.6);sun.position.set(-62,88,-38);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-90;sun.shadow.camera.right=90;
sun.shadow.camera.top=90;sun.shadow.camera.bottom=-90;sun.shadow.camera.far=260;
sun.shadow.normalBias=.045;sun.shadow.bias=-.00015;sun.shadow.radius=2;scene.add(sun);
const rim=new THREE.DirectionalLight('#81cbbb',.7);rim.position.set(65,35,70);scene.add(rim);
const skyMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
 uniforms:{zenith:{value:new THREE.Color('#2f6f8e')},horizon:{value:new THREE.Color('#c9e9f0')}},
 vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:`uniform vec3 zenith;uniform vec3 horizon;varying vec3 vP;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 void main(){vec3 d=normalize(vP);float h=max(d.y,0.);vec3 c=mix(horizon,zenith,pow(h,.48));
 vec2 p=d.xz/max(.18,d.y+.28)*2.8;float cloud=noise(p)*.58+noise(p*2.1)*.28+noise(p*4.3)*.14;
 float veil=smoothstep(.56,.79,cloud)*smoothstep(.02,.3,d.y)*.42;
 c=mix(c,vec3(.88,.96,1.),veil);gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
const sky=new THREE.Mesh(new THREE.SphereGeometry(600,40,20),skyMaterial);scene.add(sky);
const environmentScene=new THREE.Scene();environmentScene.add(new THREE.Mesh(new THREE.SphereGeometry(300,24,12),skyMaterial));
const pmrem=new THREE.PMREMGenerator(renderer),environmentTarget=pmrem.fromScene(environmentScene,.025,.1,1000);
scene.environment=environmentTarget.texture;scene.environmentIntensity=.55;pmrem.dispose();
const worldGroup=new THREE.Group();scene.add(worldGroup);const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
let world=CyberTerrain.generate({seed:'cyberalpine-2026'}),terrain=world.terrain,sourceDatasets=[],manifest=null,selectedDataset=null,currentView='range',externalGaze=false,transition=false;
let lake={x:45,z:-50,rx:14,rz:14,y:7.4,depth:4};
const boat={active:false,x:lake.x-8,z:lake.z,heading:Math.PI/2,speed:0},keys=new Set(),markers=[],recordTrees=[],buoys=[],flowParticles=[],materials=new Map();
let boatMesh,waterMesh,waterSystem,glacierMaterial,last=0,hidden=false,externalHorizontalFov=65,sceneVisible=true;
let dataLandmarks=null,dataInspector=null,dataLayersEnabled=true,dataCutoff=null,manifestHash=null,geminiPlan=null;
function material(color,options={}){const key=color+JSON.stringify(options);if(!materials.has(key))materials.set(key,new THREE.MeshStandardMaterial({color,roughness:.88,...options}));return materials.get(key)}
function field(x,z){return CyberTerrain.field(terrain,x,z)}
function ground(x,z){let y=field(x,z).height;const q=((x-lake.x)/lake.rx)**2+((z-lake.z)/lake.rz)**2;if(q<1)y-=lake.depth*(1-q)**3;return y}
function lakeBoundaries(){function boundary(level){let minimum=lake.rx;for(let i=0;i<32;i++){const a=i*Math.PI/16;let lo=0,hi=lake.rx;if(ground(lake.x,lake.z)>=level)return 0;for(let j=0;j<32;j++){const mid=(lo+hi)/2;if(ground(lake.x+Math.cos(a)*mid,lake.z+Math.sin(a)*mid)<level)lo=mid;else hi=mid}minimum=Math.min(minimum,lo)}return minimum}lake.shoreRadius=boundary(lake.y);lake.navigationRadius=Math.max(0,boundary(lake.y-.25)-1.6)}
function clearWorld(){if(dataLandmarks){dataLandmarks.dispose();dataLandmarks=null}if(waterSystem){waterSystem.dispose();waterSystem=null}while(worldGroup.children.length){const child=worldGroup.children[0];child.userData.dispose?.();child.traverse(o=>{if(o.geometry)o.geometry.dispose()});worldGroup.remove(child)}markers.length=0;recordTrees.length=0;flowParticles.length=0;buoys.length=0}
function addMesh(geometry,mat,position,shadow=true){const mesh=new THREE.Mesh(geometry,mat);if(position)mesh.position.copy(position);mesh.castShadow=shadow;mesh.receiveShadow=true;worldGroup.add(mesh);return mesh}
// Material-scale detail leaves the shared analytic terrain and lake field intact.
function noise2(x,z){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
 const h=(a,b)=>{const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n)};
 const u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
 return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(ix,iz),h(ix+1,iz),u),THREE.MathUtils.lerp(h(ix,iz+1),h(ix+1,iz+1),u),v)}
function surfaceTexture(kind='rock'){
 const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d'),im=ctx.createImageData(512,512);
 for(let y=0;y<512;y++)for(let x=0;x<512;x++){
  const n=noise2(x/18,y/18)*.5+noise2(x/6,y/6)*.27+noise2(x/1.7,y/1.7)*.15+noise2(x*.8,y*.8)*.08;
  const seam=Math.pow(Math.abs(Math.sin(x*.027+y*.019+noise2(x/44,y/44)*6)),14);
  const v=kind==='ice'?170+n*75-seam*65:116+n*115-seam*36;
  const i=(y*512+x)*4;im.data[i]=v;im.data[i+1]=v;im.data[i+2]=v;im.data[i+3]=255;
 }ctx.putImageData(im,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(kind==='ice'?3:24,kind==='ice'?3:24);t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;
}
const groundTexture=surfaceTexture(),iceTexture=surfaceTexture('ice');
function makeTerrain(){
 const geometry=new THREE.PlaneGeometry(152,152,224,224);geometry.rotateX(-Math.PI/2);
 const position=geometry.attributes.position,colors=[],color=new THREE.Color(),rock=new THREE.Color('#647b83');
 for(let i=0;i<position.count;i++){
  const x=position.getX(i),z=position.getZ(i),f=field(x,z),d=terrain.datasets.find(d=>Math.hypot(x-d.anchor.x,z-d.anchor.z)<d.radius),h=ground(x,z);
  position.setY(i,h);const texture=noise2(x*.27,z*.27)*.55+noise2(x*.8,z*.8)*.3+noise2(x*2,z*2)*.15;
  color.set(d?.form==='valley'?'#164b31':d?.form==='foothill'?'#23563b':'#31583d');
  color.multiplyScalar(.7+texture*.6);
  const slope=Math.hypot(f.gradient.x,f.gradient.z);
  if(d?.form==='peak'){const rel=(f.height-terrain.baseline)/d.relief;color.lerp(rock,clamp((rel-.16)*1.9+slope*.3,0,1));color.multiplyScalar(.76+texture*.48)}
  const dist=Math.hypot(x-lake.x,z-lake.z);
  if(dist<lake.shoreRadius+2.2){color.lerp(new THREE.Color('#446a68'),clamp(1-(dist-lake.shoreRadius)/2.2,0,.8));}
  colors.push(color.r,color.g,color.b);
 }
 geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,map:groundTexture,bumpMap:groundTexture,bumpScale:.38,roughness:.94,envMapIntensity:.35});
 addMesh(geometry,mat,null,false);
 const sides=new THREE.BufferGeometry(),top=terrain.baseline,low=-.5,v=[-76,top,-76,76,top,-76,76,low,-76,-76,low,-76,76,top,-76,76,top,76,76,low,76,76,low,-76,76,top,76,-76,top,76,-76,low,76,76,low,76,-76,top,76,-76,top,-76,-76,low,-76,-76,low,76],ix=[];for(let i=0;i<4;i++){const a=i*4;ix.push(a,a+1,a+2,a,a+2,a+3)}sides.setAttribute('position',new THREE.Float32BufferAttribute(v,3));sides.setIndex(ix);sides.computeVertexNormals();addMesh(sides,material('#0e302b',{side:THREE.DoubleSide}),null,false);
 makeRockDetails();
}
function makeRockDetails(){
 const points=[];let seed=41;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 for(const d of terrain.datasets){const count=d.form==='peak'?75:12;for(let i=0;i<count;i++){
  const a=rand()*Math.PI*2,r=d.radius*(.3+Math.sqrt(rand())*.72),x=d.anchor.x+Math.cos(a)*r,z=d.anchor.z+Math.sin(a)*r;
  if(Math.hypot(x-lake.x,z-lake.z)<lake.shoreRadius+.8)continue;
  points.push({x,z,y:ground(x,z),scale:d.form==='peak'?.3+rand()*.7:.14+rand()*.3,turn:rand()*Math.PI});
 }}
 const geometry=new THREE.IcosahedronGeometry(1,1),pos=geometry.attributes.position;
 for(let i=0;i<pos.count;i++){const p=new THREE.Vector3().fromBufferAttribute(pos,i),n=.84+noise2(p.x*9+3,p.z*12)*.28;pos.setXYZ(i,p.x*n,p.y*n*.7,p.z*n)}geometry.computeVertexNormals();
 const rocks=new THREE.InstancedMesh(geometry,material('#61767a',{map:groundTexture,bumpMap:groundTexture,bumpScale:.15,roughness:.88}),points.length),dummy=new THREE.Object3D();
 points.forEach((p,i)=>{dummy.position.set(p.x,p.y+p.scale*.18,p.z);dummy.scale.set(p.scale,p.scale*(.6+i%3*.16),p.scale);dummy.rotation.set(i*.71,p.turn,i*.3);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);rocks.setColorAt(i,new THREE.Color(i%4?'#71898b':'#a7c7ce'))});rocks.castShadow=true;rocks.receiveShadow=true;worldGroup.add(rocks);
}
function makeForests(){const instances=[];for(const grove of terrain.forests||[]){const raw=sourceDatasets.find(d=>d.id===grove.datasetId);for(const tree of grove.trees||[]){if(Math.hypot((tree.x-lake.x)/lake.rx,(tree.z-lake.z)/lake.rz)<1.18)continue;instances.push({...tree,y:ground(tree.x,tree.z),datasetId:grove.datasetId,record:raw?.records?.find(r=>r.id===tree.recordId)})}}
 const forest=createAlpineForest(THREE,instances);worldGroup.add(forest);
 for(const t of instances)recordTrees.push({position:new THREE.Vector3(t.x,t.y+t.height*.55,t.z),record:t.record,datasetId:t.datasetId});
}
function makeRivers(){for(const r of terrain.rivers||[]){if(!Array.isArray(r.points)||r.points.length<2)continue;const points=r.points.map(p=>new THREE.Vector3(p.x,ground(p.x,p.z)+.19,p.z)),curve=new THREE.CatmullRomCurve3(points,false,'centripetal'),information=r.kind==='information-flow';const mesh=addMesh(new THREE.TubeGeometry(curve,Math.min(350,points.length*3),information?.18:.13,5,false),material(information?'#91dce8':'#3c9c9a',{emissive:information?'#3b9cae':'#145d58',emissiveIntensity:.25,roughness:.22}),null,false);mesh.userData={kind:r.kind,datasetId:r.datasetId};if(information){const bead=addMesh(new THREE.SphereGeometry(.27,8,6),material('#d6f7ff',{emissive:'#7acfe6',emissiveIntensity:.8}),null,false);flowParticles.push({mesh:bead,curve,offset:flowParticles.length*.23})}}}
function makeGlaciers(){glacierMaterial=new THREE.MeshPhysicalMaterial({color:'#b8e5f2',map:iceTexture,bumpMap:iceTexture,bumpScale:.26,roughness:.28,metalness:.05,clearcoat:.65,clearcoatRoughness:.24,envMapIntensity:1.15});for(const d of terrain.datasets.filter(d=>d.form==='peak')){const vertices=[],indices=[],rings=12,segments=48,radius=d.radius*.34;
 for(let ring=0;ring<=rings;ring++)for(let j=0;j<=segments;j++){const angle=j*Math.PI*2/segments,r=radius*ring/rings*(.92+.12*Math.sin(angle*3.0)+.065*Math.sin(angle*7.0)),x=d.anchor.x+Math.cos(angle)*r,z=d.anchor.z+Math.sin(angle)*r;vertices.push(x,ground(x,z)+.16,z);if(ring<rings&&j<segments){const a=ring*(segments+1)+j,b=a+segments+1;indices.push(a,b,a+1,a+1,b,b+1)}}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();const ice=addMesh(g,glacierMaterial,null,false);ice.material.side=THREE.DoubleSide;}}
function makeLake(){
 waterSystem=createAlpineWater(THREE,renderer,scene,camera,{x:lake.x,z:lake.z,y:lake.y,radius:lake.shoreRadius,reducedMotion:reduced});waterMesh=waterSystem.mesh;worldGroup.add(waterMesh);
 const house=new THREE.Group(),hx=lake.x-lake.rx*.92,hz=lake.z-2,hy=Math.max(ground(hx,hz),lake.y);const walls=new THREE.Mesh(new THREE.BoxGeometry(4.4,3.2,4),material('#315448'));walls.position.y=1.6;walls.castShadow=true;house.add(walls);const roof=new THREE.Mesh(new THREE.ConeGeometry(3.4,2,4),material('#112f2c'));roof.rotation.y=Math.PI/4;roof.scale.z=.9;roof.position.y=4;roof.castShadow=true;house.add(roof);const doorway=new THREE.Mesh(new THREE.BoxGeometry(1.6,2.2,.08),material('#071f20'));doorway.position.set(0,1.1,-2.05);house.add(doorway);const window=new THREE.Mesh(new THREE.BoxGeometry(.08,1.2,1.2),material('#a9dce6',{emissive:'#a4deef',emissiveIntensity:.13}));window.position.set(2.23,2,0);house.add(window);const jetty=new THREE.Mesh(new THREE.BoxGeometry(2.9,.18,5),material('#788b83'));jetty.position.set(0,.05,-4);jetty.castShadow=true;house.add(jetty);for(const x of[-1.25,1.25])for(const z of[-2.5,-6]){const post=new THREE.Mesh(new THREE.CylinderGeometry(.11,.13,1.3,6),material('#3d554b'));post.position.set(x,.1,z);house.add(post)}house.position.set(hx,hy,hz);house.rotation.y=-Math.PI/2;worldGroup.add(house);
 // Boats are deliberately simple, legible objects rather than a video effect.
 function createBoat(color){const group=new THREE.Group(),shape=new THREE.Shape();shape.moveTo(-.65,-1.1);shape.lineTo(.65,-1.1);shape.lineTo(.85,.3);shape.lineTo(0,1.65);shape.lineTo(-.85,.3);shape.closePath();const hull=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.35,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.12,bevelThickness:.12}),material(color));hull.rotation.x=Math.PI/2;hull.castShadow=true;group.add(hull);const bench=new THREE.Mesh(new THREE.BoxGeometry(1.1,.15,.35),material('#866b42'));bench.position.set(0,.15,-.1);group.add(bench);const passenger=new THREE.Mesh(new THREE.CapsuleGeometry(.2,.45,3,6),material('#3e6052'));passenger.position.set(0,.55,-.2);group.add(passenger);worldGroup.add(group);return group}boatMesh=createBoat('#bde5eb');const moored=createBoat('#2b6255');moored.position.set(lake.x+lake.rx*.4,lake.y+.2,lake.z+3);moored.rotation.y=-.6;boat.x=lake.x-lake.navigationRadius*.75;boat.z=lake.z-1;boatMesh.position.set(boat.x,lake.y+.2,boat.z);boatMesh.rotation.y=boat.heading;
}
function makeMarkers(){for(const d of terrain.datasets){const marker=addMesh(new THREE.SphereGeometry(.35,9,6),material(d.form==='peak'?'#e8d19b':'#b6d8bd',{emissive:d.form==='peak'?'#b79c57':'#4d956f',emissiveIntensity:.3}),new THREE.Vector3(d.anchor.x,ground(d.anchor.x,d.anchor.z)+1.3,d.anchor.z),false);marker.userData.datasetId=d.id;markers.push(marker)}}
function recordCount(d){return Array.isArray(d.records)?d.records.length:Number.isSafeInteger(d.recordCount)&&d.recordCount>=0?d.recordCount:null}
function setRecordLink(url){const href=safeURL(url);$('recordLink').hidden=!href;if(href)$('recordLink').href=href;else $('recordLink').removeAttribute('href')}
function inspectDataset(id){const d=sourceDatasets.find(s=>s.id===id)||terrain.datasets.find(s=>s.id===id);if(!d)return;selectedDataset=id;dataInspector?.selectDataset(id);$('recordTitle').textContent=safeText(d.name)||id;const count=recordCount(d);$('recordDescription').textContent=(count===null?'Catalogue descriptor; no source records claimed. ':`${count} ${d.derived?'derived':'retained'} records. `)+(d.coverage?.selection||d.explanation||'Provenance and declared mappings remain in the world manifest.');setRecordLink(d.recordSourceUrl||d.sourceDocs||d.sourceUrl)}
function inspectBuoy(i){const b=buoys[i];if(!b)return;document.querySelectorAll('#buoyList button').forEach((button,j)=>button.classList.toggle('active',i===j));if(!b.record){inspectDataset(b.dataset.id);return}const r=b.record;dataInspector?.inspectRecord(b.dataset.id,r.id);$('recordTitle').textContent=safeText(r.title)||safeText(r.id)||'Source record';$('recordDescription').textContent=`${b.dataset.name} · ${r.date||'Date not supplied'}. ${r.value!==undefined?`${r.value} ${r.unit||''}. `:''}${r.doi?'DOI '+r.doi+'. ':''}Retrieval provenance remains in the world manifest.`;setRecordLink(r.url||(r.doi?'https://doi.org/'+r.doi:b.dataset.recordSourceUrl||b.dataset.sourceUrl))}
function makeBuoys(){const samples=[];for(const d of sourceDatasets.filter(d=>!d.derived))for(const record of(d.records||[]).slice(0,1))samples.push({record,dataset:d});if(!samples.length)for(const d of terrain.datasets.slice(0,3))samples.push({record:null,dataset:d});const buttons=[];samples.slice(0,4).forEach((sample,i)=>{const x=lake.x+[-5,4,7,-3][i],z=lake.z+[-4,4,-4,6][i],marker=addMesh(new THREE.CylinderGeometry(.25,.4,1.2,7),material('#a1dfeb'),new THREE.Vector3(x,lake.y+.4,z),false);const flag=addMesh(new THREE.SphereGeometry(.33,8,6),material('#e2f9ff',{emissive:'#6dd8ee',emissiveIntensity:.3}),new THREE.Vector3(x,lake.y+1.1,z),false);marker.userData.buoy=i;flag.userData.buoy=i;buoys.push({...sample,x,z,mesh:marker});const button=document.createElement('button');button.textContent=String(i+1).padStart(2,'0');button.setAttribute('aria-label','Inspect '+(sample.record?.title||sample.dataset.name));button.addEventListener('click',()=>inspectBuoy(i));buttons.push(button)});$('buoyList').replaceChildren(...buttons)}
function rebuild(){clearWorld();lakeBoundaries();makeTerrain();makeForests();makeRivers();makeGlaciers();makeLake();makeMarkers();makeBuoys();if(manifest?.window){dataLandmarks=createDataLandmarks(THREE,{manifest,ground});worldGroup.add(dataLandmarks.group);dataLandmarks.setVisible(dataLayersEnabled);dataLandmarks.setTime(dataCutoff||manifest.window.end);if(geminiPlan)dataLandmarks.applyPlan(geminiPlan)}$('sceneLoading').hidden=true}
function updateSources(raw){manifest=raw;const rows=[];let retained=0,sources=0;for(const d of sourceDatasets){const count=recordCount(d),fetched=['fetched','ok'].includes(d.status);if(fetched&&!d.derived){sources++;retained+=count||0}const tr=document.createElement('tr'),name=document.createElement('td'),form=document.createElement('td'),records=document.createElement('td'),button=document.createElement('button'),status=document.createElement('small');button.textContent=safeText(d.name)||d.id;button.addEventListener('click',()=>{focusDataset(d.id);$('atlas').scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'})});status.textContent=d.derived?'Derived collection · retained source records':fetched?'Fetched snapshot':d.status==='unavailable'?'Unavailable · no substituted records':'Illustrative catalogue descriptor';name.append(button,status);form.textContent=({peak:'Summit',valley:'Valley forest',foothill:'Object forest'})[d.form]||d.structure||'Dataset';records.textContent=count===null?'—':String(count);tr.append(name,form,records);rows.push(tr)}$('sourceRows').replaceChildren(...rows);const w=raw.window||{};$('dateWindow').textContent=w.start&&w.end?`${w.start} → ${w.end} / REPORTING & PUBLICATION WINDOW`:'ILLUSTRATIVE GEOMETRY / NO FETCHED SNAPSHOT';$('snapshotTag').textContent=sources?`${retained} SOURCE RECORDS / SNAPSHOT`:'ILLUSTRATIVE TERRAIN';$('coverageNote').textContent=sources?`${sources} source collections contain ${retained} retained records. Derived objects and reference edges are counted separately below. This bounded sample has source-specific gaps; it is not an exhaustive archive. No provider requests run in this page.`:'The atlas shows illustrative catalogue geometry. Missing data is never filled with invented observations.';$('sourceNote').textContent=(raw.sourceRetrievedAt?'Source retrieval: '+raw.sourceRetrievedAt+'. ':'')+'Record dates describe reporting or publication, not acquisition. Public metadata does not grant rights to underlying works.'}
function focusView(view){externalGaze=false;currentView=view;const peak=terrain.datasets.find(d=>d.form==='peak')||terrain.datasets[0],forest=terrain.datasets.find(d=>d.form==='valley')||terrain.datasets.find(d=>d.form!=='peak')||terrain.datasets[0];const positions={range:[[88,68,-100],[-2,8,-3]],forest:[[forest.anchor.x+40,ground(forest.anchor.x,forest.anchor.z)+31,forest.anchor.z-44],[forest.anchor.x,ground(forest.anchor.x,forest.anchor.z)+2,forest.anchor.z]],glacier:[[peak.anchor.x+36,ground(peak.anchor.x,peak.anchor.z)+25,peak.anchor.z-40],[peak.anchor.x,ground(peak.anchor.x,peak.anchor.z)-1,peak.anchor.z]],lake:[[lake.x+25,lake.y+27,lake.z-35],[lake.x,lake.y,lake.z]]};const p=positions[view]||positions.range;targetPosition.fromArray(p[0]);targetAim.fromArray(p[1]);camera.fov=46;camera.updateProjectionMatrix();transition=true;if(reduced){camera.position.copy(targetPosition);aim.copy(targetAim)}document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});const labels={range:['The information alps','Each summit and basin is a dataset.'],forest:['A forest of relationships','Records gather; their connections remain traceable.'],glacier:['The archive glacier','History is retained in versioned snapshots.'],lake:['Commonwater · the data lake','Launch a boat. Inspect a buoy. Follow a question.']};$('placeLabel').textContent=labels[view][0];$('placeDescription').textContent=labels[view][1];if(view==='forest')inspectDataset(forest.id);if(view==='glacier')inspectDataset(peak.id)}
function adoptManifest(raw){const next=raw.terrain||raw.world?.terrain;if(!next||!Array.isArray(next.datasets)||!next.datasets.length||next.datasets.length>64||!next.datasets.every(d=>d.anchor&&[d.anchor.x,d.anchor.z,d.radius,d.relief].every(Number.isFinite)))throw Error('Invalid mapped terrain');terrain=next;world=raw;manifest=raw;sourceDatasets=raw.datasets||terrain.datasets;dataCutoff=dataCutoff||raw.window.end;const l=raw.lakes?.[0];if(l)lake={x:l.center?.x??45,z:l.center?.z??-50,rx:l.radius??14,rz:l.radius??14,y:l.waterLevel??7.4,depth:l.depth??4};rebuild();updateSources(raw);mountDataInspector();if(!externalGaze)focusView(currentView)}
function launchBoat(){focusView('lake');if(!boat.active){boat.active=true;boat.speed=0;boat.x=lake.x-lake.navigationRadius*.75;boat.z=lake.z-1;boat.heading=Math.PI/2}$('launchBoat').textContent='Boat launched · steer ↑';$('fullscreenBoat').textContent='Dock the boat';$('dockBoat').disabled=false;$('boatControls').hidden=false;$('boatDot').classList.add('sailing');$('boatStatus').textContent='On Commonwater. Steer to a record buoy, or inspect one below.';canvas.focus({preventScroll:true})}
function dockBoat(){externalGaze=false;boat.active=false;boat.speed=0;keys.clear();boat.x=lake.x-lake.navigationRadius*.75;boat.z=lake.z-1;$('launchBoat').textContent='Launch a boat ↗';$('fullscreenBoat').textContent='Launch a boat ↗';$('dockBoat').disabled=true;$('boatControls').hidden=true;$('boatDot').classList.remove('sailing');$('boatStatus').textContent='Back at the boathouse. Your passage is ready when you are.';focusView('lake')}
function setGaze(pose){if(!pose||!pose.position||![pose.position.x,pose.position.y,pose.position.z,pose.yaw,pose.pitch,pose.fov??65].every(Number.isFinite))throw TypeError('Gaze needs finite position, yaw, pitch and optional horizontal fov.');const p=pose.position;externalGaze=true;transition=false;camera.position.set(clamp(p.x,-10000,10000),clamp(p.y,.1,10000),clamp(p.z,-10000,10000));const yaw=pose.yaw,pitch=clamp(pose.pitch,-1.55,1.55),direction=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));camera.lookAt(camera.position.clone().add(direction));keys.clear();externalHorizontalFov=clamp(pose.fov??65,25,120);const horizontal=externalHorizontalFov*Math.PI/180;camera.fov=2*Math.atan(Math.tan(horizontal/2)/camera.aspect)*180/Math.PI;camera.updateProjectionMatrix();$('placeLabel').textContent='External explorer gaze';$('placeDescription').textContent=safeText(pose.source)||'Hyperemergence engine · view and boat controls resume the preview';return{position:{x:camera.position.x,y:camera.position.y,z:camera.position.z},yaw,pitch,fov:externalHorizontalFov,source:pose.source||'external'}}
function moveBoat(dt){if(!boat.active)return;const thrust=keys.has('forward')?1:keys.has('back')?-1:0,turn=(keys.has('right')?1:0)-(keys.has('left')?1:0);boat.heading+=turn*dt*1.5;boat.speed=clamp((boat.speed+thrust*dt*3.2)*Math.exp(-dt*.8),-2,4);boat.x+=Math.sin(boat.heading)*boat.speed*dt;boat.z+=Math.cos(boat.heading)*boat.speed*dt;const dx=boat.x-lake.x,dz=boat.z-lake.z,q=Math.hypot(dx,dz);if(q>lake.navigationRadius){boat.x=lake.x+dx/q*lake.navigationRadius;boat.z=lake.z+dz/q*lake.navigationRadius;boat.speed=0}$('boatPosition').textContent=`E ${boat.x.toFixed(1)} / N ${boat.z.toFixed(1)}`;let nearest=-1,dist=2.6;buoys.forEach((b,i)=>{const d=Math.hypot(boat.x-b.x,boat.z-b.z);if(d<dist){nearest=i;dist=d}});if(nearest>=0)inspectBuoy(nearest)}
const keyMap={ArrowUp:'forward',w:'forward',W:'forward',ArrowDown:'back',s:'back',S:'back',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};canvas.addEventListener('keydown',event=>{if(!boat.active||!keyMap[event.key])return;event.preventDefault();if(externalGaze)focusView('lake');keys.add(keyMap[event.key])});window.addEventListener('keyup',event=>{if(keyMap[event.key])keys.delete(keyMap[event.key])});canvas.addEventListener('blur',()=>keys.clear());window.addEventListener('blur',()=>keys.clear());document.querySelectorAll('[data-steer]').forEach(button=>{button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);if(externalGaze)focusView('lake');keys.add(button.dataset.steer)});for(const type of['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>keys.delete(button.dataset.steer))});document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>focusView(button.dataset.view)));$('launchBoat').addEventListener('click',launchBoat);$('dockBoat').addEventListener('click',dockBoat);$('lakeLink').addEventListener('click',()=>focusView('lake'));
canvas.addEventListener('click',event=>{
 if(dragMoved)return;const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
 raycaster.params.Line.threshold=.16;
 const hits=raycaster.intersectObjects([...(dataLandmarks?.pickables||[]),...markers,...worldGroup.children.filter(o=>o.userData.buoy!==undefined)],false);
 for(const hit of hits){const datum=dataLandmarks?.resolveHit(hit);if(datum){inspectUniverseRecord(datum);return}if(hit.object.userData.datasetId){inspectDataset(hit.object.userData.datasetId);return}if(hit.object.userData.buoy!==undefined){inspectBuoy(hit.object.userData.buoy);return}}
 let nearest=null,distance=16;for(const t of recordTrees){const point=t.position.clone().project(camera);if(point.z>1)continue;const d=Math.hypot((point.x+1)*rect.width*.5-(event.clientX-rect.left),(-point.y+1)*rect.height*.5-(event.clientY-rect.top));if(d<distance){nearest=t;distance=d}}
 if(nearest){if(nearest.record)inspectUniverseRecord({datasetId:nearest.datasetId,recordId:nearest.record.id,record:nearest.record});else inspectDataset(nearest.datasetId)}
});
function focusDataset(id){
 const d=sourceDatasets.find(d=>d.id===id);if(!d)return;
 focusView(d.form==='peak'?'glacier':'forest');const y=ground(d.anchor.x,d.anchor.z);
 targetPosition.set(d.anchor.x+25,y+23,d.anchor.z-32);targetAim.set(d.anchor.x,y+4,d.anchor.z);transition=true;
 $('placeLabel').textContent=d.name;$('placeDescription').textContent=`${d.records.length} ${d.derived?'derived':'source'} records · select a data landmark to inspect`;
 inspectDataset(id);
}
function inspectUniverseRecord(datum){
 const d=sourceDatasets.find(d=>d.id===datum.datasetId);if(!d)return;
 if(datum.kind==='citation-node'&&datum.record&&datum.metadataFetched){const owner=sourceDatasets.find(ds=>ds.records.some(r=>r.id===datum.record.id));if(owner){inspectUniverseRecord({datasetId:owner.id,recordId:datum.record.id,record:datum.record});return}}
 const r=d.records.find(r=>r.id===datum.recordId)||datum.record;
 if(!r){
  if(datum.kind==='citation-node'){$('recordTitle').textContent=datum.doi;$('recordDescription').textContent=datum.dateMeaning||'External DOI identifier; target metadata has not been fetched.';setRecordLink('https://doi.org/'+encodeURIComponent(datum.doi));$('placeLabel').textContent='DOI identifier';$('placeDescription').textContent=datum.doi;return}
  focusDataset(d.id);return;
 }
 dataInspector?.inspectRecord(d.id,r.id);$('recordTitle').textContent=safeText(r.title)||r.id;
 const value=r.value??r.observation?.value,unit=r.unit??r.observation?.unit;
 const measured=Number.isFinite(value)?`${r.date}: ${value} ${unit||''}`:`${r.date||'Unknown date'} · ${r.doi||r.relationship||r.id}`;
 $('recordDescription').textContent=measured+'. Source provenance and mapping are shown in the Data lens.';
 setRecordLink(r.url||(r.doi?'https://doi.org/'+r.doi:r.sourceDoi?'https://doi.org/'+r.sourceDoi:d.sourceDocs||d.sourceUrl));$('placeLabel').textContent=d.name;$('placeDescription').textContent=measured;
}
function mountDataInspector(){
 dataInspector=createDataInspector({manifest,onSelectDataset:id=>focusDataset(id),onLayerChange:enabled=>{dataLayersEnabled=enabled;dataLandmarks?.setVisible(enabled)},onTimeChange:({cutoff})=>{dataCutoff=cutoff;dataLandmarks?.setTime(cutoff)}});
 if(geminiPlan)dataInspector.setGeminiStatus({status:'generated',model:geminiPlanModel,plan:geminiPlan});
}
let geminiPlanModel=null;
async function sha256Text(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')}
async function loadGeminiInterpretation(){
 try{
  const response=await fetch('assets/gemini-universe.json',{cache:'no-cache'});if(!response.ok)throw Error('No interpretation artifact');
  const artifact=await response.json();if(artifact.status!=='generated'){dataInspector?.setGeminiStatus(artifact);return}
  const contextHash=await sha256Text(JSON.stringify(compileContext(manifest)));
  validateBindings(artifact,{sourceSnapshotSha256:manifest.sourceSnapshotSha256,universeManifestSha256:manifestHash,inputContextSha256:contextHash});
  const plan=validatePlan(artifact.plan,manifest);geminiPlan=plan;geminiPlanModel=artifact.model;dataLandmarks?.applyPlan(plan);dataInspector?.setGeminiStatus({...artifact,plan});
 }catch{dataInspector?.setGeminiStatus({status:'pending',message:'Source-driven universe · Gemini interpretation pending'})}
}

function resize(){const rect=canvas.getBoundingClientRect();renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false);camera.aspect=rect.width/Math.max(1,rect.height);if(externalGaze)camera.fov=2*Math.atan(Math.tan(externalHorizontalFov*Math.PI/360)/camera.aspect)*180/Math.PI;camera.updateProjectionMatrix()}new ResizeObserver(resize).observe(canvas);document.addEventListener('visibilitychange',()=>{hidden=document.hidden;keys.clear()});if('IntersectionObserver' in window)new IntersectionObserver(entries=>{sceneVisible=entries[0].isIntersecting;if(!sceneVisible)keys.clear()},{threshold:.01}).observe(canvas);
function animate(time){const dt=Math.min(.05,last?(time-last)/1000:.016);last=time;requestAnimationFrame(animate);if(hidden||!sceneVisible)return;moveBoat(dt);if(!externalGaze){if(transition){const factor=reduced?1:Math.min(1,dt*4);camera.position.lerp(targetPosition,factor);aim.lerp(targetAim,factor);if(camera.position.distanceTo(targetPosition)<.02&&aim.distanceTo(targetAim)<.02)transition=false}camera.lookAt(aim)}if(boatMesh){boatMesh.position.set(boat.x,lake.y+.23+(reduced?0:Math.sin(time*.0014)*.035),boat.z);boatMesh.rotation.y=boat.heading}if(!reduced){for(const f of flowParticles)f.mesh.position.copy(f.curve.getPointAt((time*.000035+f.offset)%1));}if(dataLandmarks)dataLandmarks.update(reduced?0:time*.001);if(waterSystem)waterSystem.update(time);renderer.render(scene,camera)}
sourceDatasets=terrain.datasets;rebuild();updateSources({datasets:sourceDatasets});resize();requestAnimationFrame(animate);fetch('assets/universe.json',{cache:'no-cache'}).then(async r=>{if(!r.ok)throw Error('Snapshot unavailable');const text=await r.text();manifestHash=await sha256Text(text);return JSON.parse(text)}).then(raw=>{adoptManifest(raw);loadGeminiInterpretation()}).catch(error=>{$('snapshotTag').textContent='ILLUSTRATIVE TERRAIN';$('dateWindow').textContent='SOURCE SNAPSHOT UNAVAILABLE / CATALOGUE PREVIEW';$('coverageNote').textContent='The source snapshot could not be loaded. Illustrative geometry is shown; no observations have been substituted.';console.warn('Cyberalpine manifest:',error.message)});
window.Cyberalpine=Object.freeze({getState:()=>({view:currentView,externalGaze,boat:{...boat},lake:{...lake},datasetCount:terrain.datasets.length,hasSnapshot:Boolean(manifest?.window),sourceRecordCount:manifest?.dataSummary?.sourceRecords??sourceDatasets.filter(d=>!d.derived).reduce((s,d)=>s+(recordCount(d)||0),0),treeCount:recordTrees.length,dataLayer:dataLandmarks?.getStats()||null,gemini:{status:geminiPlan?'generated':'pending',model:geminiPlanModel},camera:{position:{x:camera.position.x,y:camera.position.y,z:camera.position.z},fov:camera.fov}}),focusView,launchBoat,dockBoat,setGaze});
window.addEventListener('cyberalpine:gaze',event=>{try{setGaze(event.detail)}catch(error){$('boatStatus').textContent='Gaze rejected: '+error.message}});

// Explicit preview navigation always releases the external gaze override.
let orbitDrag=null,dragMoved=false;
canvas.style.touchAction='none';
canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;orbitDrag={x:event.clientX,y:event.clientY};dragMoved=false;canvas.setPointerCapture(event.pointerId)});
canvas.addEventListener('pointermove',event=>{if(!orbitDrag)return;const dx=event.clientX-orbitDrag.x,dy=event.clientY-orbitDrag.y;orbitDrag={x:event.clientX,y:event.clientY};if(Math.abs(dx)+Math.abs(dy)<1)return;dragMoved=true;externalGaze=false;transition=false;const offset=camera.position.clone().sub(aim),spherical=new THREE.Spherical().setFromVector3(offset);spherical.theta-=dx*.006;spherical.phi=clamp(spherical.phi+dy*.005,.12,Math.PI*.48);offset.setFromSpherical(spherical);camera.position.copy(aim).add(offset);targetPosition.copy(camera.position);targetAim.copy(aim)});
for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>{orbitDrag=null});
canvas.addEventListener('wheel',event=>{event.preventDefault();externalGaze=false;transition=false;const offset=camera.position.clone().sub(aim),distance=clamp(offset.length()*Math.exp(event.deltaY*.001),12,270);offset.setLength(distance);camera.position.copy(aim).add(offset);targetPosition.copy(camera.position);targetAim.copy(aim)},{passive:false});
$('expandExplorer').addEventListener('click',async()=>{const atlas=$('atlas');if(document.fullscreenElement){await document.exitFullscreen();return}if(atlas.classList.contains('is-expanded')){atlas.classList.remove('is-expanded');$('expandExplorer').textContent='⛶ Expand explorer';return}try{if(atlas.requestFullscreen)await atlas.requestFullscreen();else{atlas.classList.add('is-expanded');$('expandExplorer').textContent='× Close explorer'}}catch{atlas.classList.add('is-expanded');$('expandExplorer').textContent='× Close explorer'}});
document.addEventListener('fullscreenchange',()=>{$('expandExplorer').textContent=document.fullscreenElement?'× Close explorer':'⛶ Expand explorer'});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('atlas').classList.remove('is-expanded');$('expandExplorer').textContent='⛶ Expand explorer'}});

$('fullscreenBoat').addEventListener('click',()=>boat.active?dockBoat():launchBoat());

/* Actual-record visual layer. No synthetic observations, inferred citations,
 * terrain modifications, or remote requests. All distances are display metres. */
const bounded = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const key = (datasetId, recordId) => `${datasetId}\u0000${recordId}`;
function hash(value) { let h=2166136261;for(const c of String(value)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0)/4294967296; }
function endDate(record) {
  const value=record?.dateInterval?.end || record?.date;
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '9999-12-31';
}
function cutoffDate(value) {
  const date=String(value).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('Timeline cutoff must be a valid ISO date.');
  return date;
}
export function createDataLandmarks(THREE,{manifest,sourceManifest=manifest,ground,onInspect}={}) {
  if(!manifest || !Array.isArray(manifest.datasets) || typeof ground!=='function')throw Error('A source manifest and ground(x,z) function are required.');
  const group=new THREE.Group();group.name='Traceable record landmarks';
  const pickables=[],resources=new Set(),batches=[],labels=[],recordsByKey=new Map(),positions=new Map(),datasetById=new Map(),knownDois=new Map();
  let cutoff=cutoffDate(manifest.window?.end || '9999-12-31'),visible=true,disposed=false,planSelection=[],graph=null,activeGraphRecords=[];
  const datasets=manifest.datasets.filter(d=>d&&typeof d.id==='string'&&d.anchor&&[d.anchor.x,d.anchor.z,d.radius].every(Number.isFinite)).slice(0,64);
  for(const d of sourceManifest.datasets||[])for(const r of d.records||[])if(typeof r.doi==='string')knownDois.set(r.doi,{datasetId:d.id,record:r});
  for(const d of datasets){datasetById.set(d.id,d);for(const r of d.records||[])if(typeof r.id==='string')recordsByKey.set(key(d.id,r.id),r);}
  const keep=value=>(resources.add(value),value);
  const material=(color,extra={})=>keep(new THREE.MeshStandardMaterial({color,roughness:.35,metalness:.15,emissive:color,emissiveIntensity:.24,...extra}));
  const columnMaterial=material('#b8efff',{transparent:true,opacity:.88});
  const pointMaterial=material('#63b68b',{roughness:.7,metalness:.05});
  const nodeMaterial=material('#a6dfe7',{roughness:.65,metalness:.05});
  const haloMaterial=material('#c3f7ff',{emissiveIntensity:.8,transparent:true,opacity:.85,depthWrite:false});
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  const floor=(x,z)=>{const h=ground(x,z);return Number.isFinite(h)?h:0;};
  function datum(d,r,kind,extra={}){return{datasetId:d.id,recordId:r.id,label:r.title||r.id,kind,record:r,dateEnd:endDate(r),...extra};}
  function batch(name,geometry,mat,entries,capacity=entries.length){
    const mesh=new THREE.InstancedMesh(keep(geometry),mat,Math.max(1,capacity));mesh.name=name;mesh.castShadow=false;mesh.frustumCulled=false;
    mesh.userData={kind:'record-instances',instances:[]};group.add(mesh);const b={mesh,entries};batches.push(b);return b;
  }
  function labelSprite(d,title){
    if(typeof document==='undefined')return null;
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=104;const c=canvas.getContext('2d');if(!c)return null;
    c.clearRect(0,0,768,104);c.fillStyle='#072f29d9';c.fillRect(0,4,768,90);c.fillStyle='#bceef1';c.fillRect(0,4,4,90);
    c.font='500 24px Helvetica, Arial, sans-serif';c.textBaseline='middle';c.fillStyle='#e0fbff';
    let text=String(title||d.name||d.id).slice(0,100);while(c.measureText(text).width>710&&text.length>4)text=text.slice(0,-2);if(text!==String(title||d.name||d.id))text+='…';c.fillText(text,24,49);
    const texture=keep(new THREE.CanvasTexture(canvas));texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(keep(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,depthTest:false})));sprite.scale.set(13.8,1.87,1);
    sprite.position.set(d.anchor.x,floor(d.anchor.x,d.anchor.z)+5.6,d.anchor.z);sprite.userData={datasetId:d.id,kind:'dataset-label',label:d.name||d.id};group.add(sprite);labels.push(sprite);return sprite;
  }
  for(const d of datasets){
    const records=(d.records||[]).filter(r=>r&&typeof r.id==='string');
    if(d.structure==='tabular'){
      const ordered=records.filter(r=>Number.isFinite(r.value)).sort((a,b)=>endDate(a).localeCompare(endDate(b))||a.id.localeCompare(b.id));
      const values=ordered.map(r=>r.value),min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):0;
      const entries=ordered.map((r,i)=>{
        const a=-Math.PI*.8+(ordered.length===1?.5:i/(ordered.length-1))*Math.PI*1.6,radius=Math.min(5.8,d.radius*.43);
        const x=d.anchor.x+Math.sin(a)*radius,z=d.anchor.z+Math.cos(a)*radius,h=1.2+(max===min?.5:(r.value-min)/(max-min))*5.2,base=floor(x,z)+.22;
        const data=datum(d,r,'series-observation',{value:r.value,unit:r.unit||'',numericBaseline:min,numericMaximum:max,
          normalization:'Within-series min/max; 1.2–6.4 m display columns with a truncated numeric baseline. Different units are never pooled.',displayHeight:h,groundBaseline:base});
        const position=new THREE.Vector3(x,base+h/2,z);positions.set(key(d.id,r.id),{position:new THREE.Vector3(x,base+h+.25,z),data,end:endDate(r)});
        return{position,scale:new THREE.Vector3(.4,h,.4),color:i%2?'#b4eafb':'#e0faff',data,end:endDate(r)};
      });
      batch(`${d.id} / dated observations`,new THREE.BoxGeometry(1,1,1),columnMaterial,entries);
    }else if(d.id!=='crossref-reference-edges'){
      const entries=records.map((r,i)=>{
        const a=i*2.399963+hash(r.id)*.24,rad=Math.min(6.1,d.radius*.46)*Math.sqrt((i+.5)/Math.max(1,records.length));
        const x=d.anchor.x+Math.cos(a)*rad,z=d.anchor.z+Math.sin(a)*rad,y=floor(x,z)+1.1+hash(r.id+':height')*2.4;
        const data=datum(d,r,'retained-record',{metadataFetched:true});const position=new THREE.Vector3(x,y,z);
        positions.set(key(d.id,r.id),{position:position.clone(),data,end:endDate(r)});
        return{position,scale:new THREE.Vector3(.13,.13,.13),color:d.structure==='object'?'#8dcf9f':'#5ba888',data,end:endDate(r)};
      });
      batch(`${d.id} / record constellation`,new THREE.IcosahedronGeometry(1,1),pointMaterial,entries);
    }
    const marker=new THREE.Mesh(keep(new THREE.TorusGeometry(.62,.025,5,40)),haloMaterial);marker.rotation.x=-Math.PI/2;marker.position.set(d.anchor.x,floor(d.anchor.x,d.anchor.z)+.24,d.anchor.z);marker.userData={datasetId:d.id,kind:'dataset-beacon',label:d.name||d.id};group.add(marker);
    labelSprite(d,d.name);
  }
  const edgeDataset=datasets.find(d=>d.id==='crossref-reference-edges');
  if(edgeDataset){
    const edges=(edgeDataset.records||[]).filter(r=>typeof r.sourceDoi==='string'&&typeof r.targetDoi==='string');
    const allIds=[...new Set(edges.flatMap(r=>[r.sourceDoi,r.targetDoi]))].sort(),ids=allIds.slice(0,450),retained=new Set(ids);
    const kept=edges.filter(r=>retained.has(r.sourceDoi)&&retained.has(r.targetDoi));
    const nodePositions=new Map();
    const entries=ids.map((doi,i)=>{
      const ring=Math.floor(Math.sqrt(i)),start=ring*ring,count=Math.max(1,2*ring+1),a=(i-start)/count*Math.PI*2+ring*.73;
      const radius=(ring+1)/Math.max(1,Math.ceil(Math.sqrt(ids.length)))*Math.min(edgeDataset.radius*.7,10.5);
      const x=edgeDataset.anchor.x+Math.cos(a)*radius,z=edgeDataset.anchor.z+Math.sin(a)*radius,y=floor(x,z)+2+hash(doi)*2.6;
      const known=knownDois.get(doi),data={datasetId:edgeDataset.id,recordId:doi,doi,label:known?.record.title||doi,kind:'citation-node',
        metadataFetched:Boolean(known),snapshotMetadataFetched:Boolean(known),external:!known,record:known?.record||null,
        dateMeaning:known?'Fetched work metadata; node visibility follows dated retained citation edges.':'External DOI identifier only. Target metadata and publication date have not been fetched.'};
      const position=new THREE.Vector3(x,y,z);nodePositions.set(doi,position);
      return{position,scale:new THREE.Vector3(known?.16:.095,known?.16:.095,known?.16:.095),color:known?'#d5f5f4':'#6a9ba6',data,doi};
    });
    const nodes=batch('Actual deposited DOI reference graph',new THREE.IcosahedronGeometry(1,0),nodeMaterial,entries);
    const geometry=keep(new THREE.BufferGeometry());geometry.setAttribute('position',new THREE.Float32BufferAttribute([],3));
    const lines=new THREE.LineSegments(geometry,keep(new THREE.LineBasicMaterial({color:'#95d1cf',transparent:true,opacity:.27,depthWrite:false})));lines.name=`${kept.length} deposited reference edges (snapshot count)`;lines.frustumCulled=false;lines.userData={kind:'citation-edges',edges:[]};group.add(lines);
    for(const r of kept){const a=nodePositions.get(r.sourceDoi),b=nodePositions.get(r.targetDoi);positions.set(key(edgeDataset.id,r.id),{position:a.clone().lerp(b,.5),data:datum(edgeDataset,r,'deposited-reference',{metadataFetched:true}),end:endDate(r)});}
    graph={dataset:edgeDataset,edges:kept,nodes,nodePositions,lines,allNodeCount:allIds.length,allEdgeCount:edges.length,omittedNodes:Math.max(0,allIds.length-ids.length)};
  }
  const energy=new THREE.InstancedMesh(keep(new THREE.SphereGeometry(.075,6,4)),haloMaterial,12);energy.name='Light along retained citation edges';energy.count=0;energy.frustumCulled=false;group.add(energy);
  const planBatch=batch('Exact-record interpretation highlights',new THREE.TorusGeometry(.42,.045,6,28),haloMaterial,[],512);
  function refresh(){
    if(disposed)return;const activeDois=new Set();
    if(graph){
      const vertices=[],edgeData=[];activeGraphRecords=[];
      for(const r of graph.edges)if(endDate(r)<=cutoff){const a=graph.nodePositions.get(r.sourceDoi),b=graph.nodePositions.get(r.targetDoi);vertices.push(a.x,a.y,a.z,b.x,b.y,b.z);activeDois.add(r.sourceDoi);activeDois.add(r.targetDoi);activeGraphRecords.push(r);edgeData.push(datum(graph.dataset,r,'deposited-reference',{metadataFetched:true}));}
      graph.lines.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));graph.lines.geometry.computeBoundingSphere();graph.lines.userData.edges=edgeData;graph.lines.visible=edgeData.length>0;
      for(const e of graph.nodes.entries){const known=knownDois.get(e.doi),available=known&&endDate(known.record)<=cutoff;e.data.metadataFetched=Boolean(available);e.data.external=!available;e.data.record=available?known.record:null;e.data.label=available?known.record.title||e.doi:e.doi;e.data.dateMeaning=available?'Fetched work metadata; node visibility follows dated retained citation edges.':'DOI identifier only at this cutoff. Metadata or publication date is not inferred from the citing record.';}
    }
    for(const b of batches){
      const active=b.entries.filter(e=>e.doi?activeDois.has(e.doi):e.end<=cutoff);b.mesh.count=active.length;b.mesh.visible=active.length>0;b.mesh.userData.instances=active.map(e=>e.data);
      active.forEach((e,i)=>{dummy.position.copy(e.position);dummy.scale.copy(e.scale);dummy.rotation.set(e.rotationX||0,0,0);dummy.updateMatrix();b.mesh.setMatrixAt(i,dummy.matrix);color.set(e.color||'#c5f7ff');b.mesh.setColorAt(i,color);});
      b.mesh.instanceMatrix.needsUpdate=true;if(b.mesh.instanceColor)b.mesh.instanceColor.needsUpdate=true;
    }
    pickables.splice(0,pickables.length);if(visible){group.traverse(o=>{if(o!==energy&&o.visible&&(o.isSprite||o.userData.kind==='dataset-beacon'||o.isInstancedMesh&&o.count>0||o===graph?.lines&&o.visible))pickables.push(o);});}
  }
  function setTime(value){cutoff=cutoffDate(value??manifest.window?.end??'9999-12-31');refresh();return getStats();}
  function setVisible(value){visible=Boolean(value);group.visible=visible;refresh();}
  function applyPlan(plan){
    planSelection=[];const chosen=new Set(),perDataset=new Map();
    for(const item of (Array.isArray(plan?.datasets)?plan.datasets:[]).slice(0,64)){
      const d=datasetById.get(item.datasetId);if(!d)continue;
      for(const id of [...new Set(Array.isArray(item.recordIds)?item.recordIds:[])].slice(0,8)){
        if(typeof id!=='string'||(perDataset.get(d.id)||0)>=8)continue;
        const k=key(d.id,id),record=recordsByKey.get(k),entry=positions.get(k);if(!record||!entry||chosen.has(k))continue;chosen.add(k);perDataset.set(d.id,(perDataset.get(d.id)||0)+1);
        planSelection.push({...entry,scale:new THREE.Vector3(1,1,1),rotationX:-Math.PI/2,color:'#d9fbff',data:{...entry.data,kind:'plan-emphasis',interpretation:item.interpretation||'',visualEmphasis:item.visualEmphasis||'',sourceRecordId:record.id}});
      }
    }
    planBatch.entries=planSelection;refresh();return{highlightedRecords:planSelection.length};
  }
  function resolveHit(hit){
    if(!visible||!hit?.object?.visible)return null;const data=hit.object.userData;
    if(hit.object.isInstancedMesh)return Number.isInteger(hit.instanceId)?data.instances?.[hit.instanceId]||null:null;
    if(hit.object===graph?.lines)return data.edges?.[Math.floor((hit.index||0)/2)]||null;
    return data.datasetId?data:null;
  }
  function update(time){
    if(disposed||!visible)return;const t=Number.isFinite(time)?time:0;
    haloMaterial.emissiveIntensity=.65+Math.sin(t*1.5)*.15;pointMaterial.emissiveIntensity=.2+Math.sin(t*.8)*.06;
    energy.count=Math.min(12,activeGraphRecords.length);energy.visible=energy.count>0;
    for(let i=0;i<energy.count;i++){
      const r=activeGraphRecords[Math.floor(i*activeGraphRecords.length/energy.count)],a=graph.nodePositions.get(r.sourceDoi),b=graph.nodePositions.get(r.targetDoi);
      dummy.position.copy(a).lerp(b,((t*.16+i*.137)%1+1)%1);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);dummy.updateMatrix();energy.setMatrixAt(i,dummy.matrix);
    }
    energy.instanceMatrix.needsUpdate=true;
  }
  function getStats(){return{cutoff,visible,datasets:datasets.length,observations:datasets.filter(d=>d.structure==='tabular').reduce((n,d)=>n+(d.records||[]).filter(r=>Number.isFinite(r.value)).length,0),
    retainedRecordPoints:batches.filter(b=>b.mesh!==graph?.nodes.mesh&&b.mesh!==planBatch.mesh&&b.mesh.material===pointMaterial).reduce((n,b)=>n+b.entries.length,0),
    graphNodes:graph?.nodes.entries.length||0,graphEdges:graph?.edges.length||0,omittedGraphNodes:graph?.omittedNodes||0,omittedGraphEdges:graph?graph.allEdgeCount-graph.edges.length:0,
    visibleObservations:batches.filter(b=>b.mesh.material===columnMaterial).reduce((n,b)=>n+b.mesh.count,0),visibleGraphEdges:graph?.lines.userData.edges.length||0,
    visibleRecordPoints:batches.filter(b=>b.mesh.material===pointMaterial).reduce((n,b)=>n+b.mesh.count,0),highlights:planBatch.mesh.count};}
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();pickables.length=0;for(const r of resources)r.dispose();group.clear();}
  refresh();
  return{group,pickables,setTime,setVisible,applyPlan,update,resolveHit,inspectHit(hit){const data=resolveHit(hit);if(data&&typeof onInspect==='function')onInspect(data);return data;},dispose,getStats};
}

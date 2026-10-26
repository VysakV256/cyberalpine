#!/usr/bin/env node
'use strict';
// Deterministic, offline compilation of acquired records into a shared world.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Terrain = require('./terrain.cjs');
const root = path.resolve(__dirname, '..');
const input = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'Content/Data/source-records.json');
const output = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'Content/Data/universe.json');
const bytes = fs.readFileSync(input), snapshot = JSON.parse(bytes);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const hashId = (...parts) => crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
const sourceIds = ['bls-cpi', 'bls-unemployment', 'research-crossref', 'books-crossref'];
const byId = new Map(snapshot.datasets.map(d => [d.id, d]));
for (const id of sourceIds) if (!byId.has(id)) throw Error(`Required source descriptor missing: ${id}`);
const sources = sourceIds.map(id => byId.get(id));
for (const dataset of sources) if (!Array.isArray(dataset.records)) throw Error(`Invalid records for ${dataset.id}`);
const provenance = {sourceSnapshotSha256:digest, sourceRetrievedAt:snapshot.fetchedAt};
const observations = sources.filter(d => d.structure === 'tabular').flatMap(d => d.records.map(record => ({
  id:`observation-${hashId(d.id, record.id)}`, title:record.title, date:record.date,
  datePrecision:record.datePrecision, dateInterval:record.dateInterval,
  sourceDatasetId:d.id, sourceRecordId:record.id,
  observation:{seriesId:d.seriesId, value:record.value, unit:record.unit, footnotes:record.footnotes || []},
  derivation:'Lossless wrapping of one acquired monthly observation into a nested object; no interpolation.',
  provenance:{...record.provenance, ...provenance}
})));
const retainedDois = new Set(sources.flatMap(d => d.records.map(r => r.doi).filter(Boolean)));
const edgeMap = new Map();
for (const record of byId.get('research-crossref').records) for (const reference of record.references || []) {
  const from = record.doi || record.id, to = reference.doi;
  if (!to) continue;
  const id = `citation-${hashId(from, to)}`;
  edgeMap.set(id, {id, title:`${from} → ${to}`, sourceDoi:from, targetDoi:to,
    sourceRecordId:record.id, sourceDatasetId:'research-crossref', relationship:'deposited-reference', inferred:false,
    targetMetadataFetched:retainedDois.has(to), date:record.date, datePrecision:record.datePrecision,
    dateInterval:record.dateInterval, dateMeaning:'Publication date of the citing record; target publication date is not asserted.',
    provenance:{...record.provenance, ...provenance}});
}
const references = [...edgeMap.values()].sort((a,b) => a.id.localeCompare(b.id));
function derived(id, name, structure, records, parents, description) {
  return {id,name,structure,status:parents.some(id => byId.get(id).status !== 'fetched') ? 'partial' : 'fetched',
    derived:true, sourceDatasetIds:parents, sourceUrl:byId.get(parents[0]).sourceUrl,
    licenseNote:'Derived exclusively from acquired public observations or bibliographic metadata; underlying work rights remain unchanged.',
    records, coverage:{requestedStart:snapshot.window.start,requestedEnd:snapshot.window.end,
      retainedCount:records.length,selection:description,
      earliest:records.length ? records.reduce((v,r) => r.dateInterval.start < v ? r.dateInterval.start : v, records[0].dateInterval.start) : null,
      latest:records.length ? records.reduce((v,r) => r.dateInterval.end > v ? r.dateInterval.end : v, records[0].dateInterval.end) : null}};
}
const economic = derived('economic-observations','Monthly economic observation objects','object',observations,
  ['bls-cpi','bls-unemployment'],'One nested object per retained BLS source observation. CPI and unemployment remain distinct units and signals.');
const graph = derived('crossref-reference-edges','Deposited research DOI references','relational',references,
  ['research-crossref'],'Distinct citing-DOI → referenced-DOI pairs from the retained research sample. References are capped by the acquisition layer; external targets are identifiers, not fetched target works.');
const ordered = [byId.get('bls-cpi'),byId.get('bls-unemployment'),economic,
  byId.get('research-crossref'),byId.get('books-crossref'),graph];
const clamp = (v,a=0,b=1) => Math.max(a,Math.min(b,v));
function descriptor(dataset) {
  const n = dataset.records.length;
  const values = dataset.structure === 'tabular' ? dataset.records.map(r=>r.value).filter(Number.isFinite) : [];
  const mean = values.length ? values.reduce((s,v)=>s+v,0)/values.length : 0;
  const deviation = values.length ? Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length) : 0;
  const variation = values.length && Math.abs(mean)>1e-12 ? deviation/Math.abs(mean) : null;
  const form = dataset.structure === 'tabular' ? 'peak' : dataset.structure === 'object' ? 'foothill' : 'valley';
  return {...dataset, form, origin:dataset.derived ? 'Deterministic source-record transformation' : dataset.id.startsWith('bls-') ? 'U.S. Bureau of Labor Statistics' : 'Crossref deposited metadata',
    recordCount:n, fixture:false, abundance:clamp(Math.log1p(n)/Math.log1p(3000),.08,1),
    variability:variation===null ? .4 : clamp(variation*8,.12,.95), connectedness:.5, uncertainty:.35,
    metricStatus:'Record count and within-series variability are computed from this acquired snapshot; placement, exaggeration, connectedness and uncertainty are explicit design controls.',
    features:{retainedRecords:n,withinSeriesMean:values.length?mean:null,withinSeriesPopulationStdDev:values.length?deviation:null,
      relativeStdDev:variation,abundanceMapping:'clamp(log(1+n)/log(3001), 0.08, 1)',
      variabilityMapping:variation===null?'0.4 display preset':'clamp(8 × populationStdDev / abs(mean), 0.12, 0.95)',
      normalizedAcrossIncompatibleUnits:false},
    explanation:form==='peak'?'This quantitative source dataset forms a summit. Relief uses a bounded within-series variation mapping; elevation is not a quality or economic ranking.':
      form==='foothill'?'This object dataset forms a high foothill forest. Individual visible trees sample retained object records.':
      'This relationship dataset forms a valley forest. Visible trees sample retained records, with deposited references distinguished from inferred connections.'};
}
const datasets = ordered.map(descriptor);
const world = Terrain.generate({seed:'cyberquest-information-universe-v1',ecosystem:'mixed',datasets});
const terrain = world.terrain;
world.baseline=terrain.baseline;
world.extent=terrain.extent;
world.title='Cyberquest · The Commonwater information universe';
world.generatedAt=snapshot.fetchedAt;
world.provenance='Deterministic geography of acquired public data and explicit derived records; decorative and physical simulation controls remain authored.';
world.sources=sources.map(d=>({name:d.name,url:d.sourceUrl,status:d.status,
  note:`${d.records.length} retained records; see source coverage and acquisition provenance.`}));
terrain.fixtureNotice='Acquired source records and explicit derived collections. Forests use bounded sampling; visual form and force parameters are authored simulation choices.';
for (const d of terrain.datasets) {
  const canonical = datasets.find(source => source.id===d.id);
  d.metricStatus=canonical.metricStatus;
  d.recordCount=canonical.recordCount;
  d.recordCountStatus='Verified from retained source or deterministically derived records by build_universe.cjs.';
  d.features=canonical.features;
  // Flat homes are the native Unreal manifest contract; world.terrain retains
  // the same geometry for browser consumers and the analytic generator.
  Object.assign(canonical,{anchor:{...d.anchor},radius:d.radius,relief:d.relief});
  const node = world.nodes.find(node => node.metadata.dataset.id===d.id);
  node.description=canonical.explanation+' '+canonical.metricStatus;
  node.metadata.dataset.metricStatus=canonical.metricStatus;
}
for (const grove of terrain.forests) {
  const records = datasets.find(d=>d.id===grove.datasetId).records;
  grove.trees=grove.trees.slice(0,Math.min(grove.trees.length,records.length)).map((tree,i,trees)=>({
    ...tree,recordId:records[Math.floor(i*records.length/trees.length)].id,proxy:true}));
  grove.role=`Deterministic, evenly spaced sampling of ${grove.trees.length} of ${records.length} retained records; decorative tree dimensions are not evidence rankings.`;
}
function pipeline(from,to,transformation) {
  const a=terrain.datasets.find(d=>d.id===from),b=terrain.datasets.find(d=>d.id===to), points=[];
  const steps=Math.max(2,Math.ceil(Math.hypot(b.anchor.x-a.anchor.x,b.anchor.z-a.anchor.z)/1.1));
  for(let i=0;i<=steps;i++){
    const t=i/steps,x=a.anchor.x+(b.anchor.x-a.anchor.x)*t,z=a.anchor.z+(b.anchor.z-a.anchor.z)*t;
    points.push({x,y:Terrain.field(terrain,x,z).height,z});
  }
  return {id:`information-${from}-${to}`,datasetId:to,fromDatasetId:from,toDatasetId:to,
    from,to,source:from,target:to,kind:'information-flow',relationship:'declared deterministic derivation',
    transformation,points,width:.65,gravitySupported:false,
    uphill:points.some((p,i)=>i>0&&p.y>points[i-1].y+1e-7),
    note:'A declared information transfer route. It can cross rising terrain and is not a gravity-fluid simulation.'};
}
terrain.rivers=[...terrain.rivers.filter(r=>r.kind!=='information-flow'),
  pipeline('bls-cpi','economic-observations','Wrap each retained CPI observation into a versioned nested observation object.'),
  pipeline('bls-unemployment','economic-observations','Wrap each retained unemployment observation into a versioned nested observation object.'),
  pipeline('research-crossref','crossref-reference-edges','Extract deposited DOI references and deduplicate citing/target pairs. External targets remain identifiers.')];
terrain.rangeLinks=terrain.rangeLinks.map(link=>({...link,interpretation:'Declared grouping of BLS quantitative datasets; no correlation is asserted.'}));
terrain.glaciers=terrain.glaciers.map(glacier=>({...glacier,archive:'Acquired snapshot identity',
  snapshotSha256:digest,retrievedAt:snapshot.fetchedAt,
  retainedCount:byId.get(glacier.datasetId).records.length,
  historyStatus:'Current acquired snapshot. An append-only multi-vintage archive remains a future storage integration.',
  note:'Archive caps identify the acquired snapshot by checksum. Ice is a designed representation of retention, not a measured glacier or a quality score.'}));
const lakes=[{id:'archive-lake',name:'Commonwater',center:{x:45,z:-50},radius:14,depth:4,waterLevel:7.4,
  datasetIds:sourceIds,storageStatus:'Local retained metadata snapshot; cloud storage and personal entitlements are not implemented.',
  boathouses:[{id:'commonwater-house',name:'Field station',access:'public concept preview'}]}];
const sourceRecords=sources.reduce((sum,d)=>sum+d.records.length,0);
const universe={schemaVersion:'cyberquest.universe.v1',id:'cyberquest-commonwater',name:world.title,
  seed:terrain.seed,baseline:terrain.baseline,extent:terrain.extent,window:snapshot.window,rollingWindow:snapshot.window,
  sourceRetrievedAt:snapshot.fetchedAt,sourceSnapshotSha256:digest,
  datasets,world,flows:terrain.rivers.map(r=>({...r,
    from:r.fromDatasetId||r.datasetId,to:r.toDatasetId||r.datasetId,
    source:r.fromDatasetId||r.datasetId,target:r.toDatasetId||r.datasetId})),
  glaciers:terrain.glaciers,lakes,
  avalancheStatus:{status:'simulation-available',observedDataEvent:false,events:[],
    note:'No source correction, migration, or burst event is asserted. Avalanches are authored simulation events and may propagate only along declared dependencies.'},
  dataSummary:{sourceDatasetCount:sources.length,datasetCount:datasets.length,sourceRecords,
    derivedObservationObjects:observations.length,derivedReferenceEdges:references.length,
    sourceRecordCounts:Object.fromEntries(sources.map(d=>[d.id,d.records.length])),
    status:sources.some(d=>d.status!=='fetched')?'partial':'fetched',
    completeness:'Bounded calendar-month-stratified metadata sample and available monthly economic reports; not an exhaustive information universe.',
    derivedRecordsAreAdditionalSourceRecords:false},
  attribution:sources.map(d=>({datasetId:d.id,name:d.name,url:d.sourceUrl,
    sourceDocs:d.sourceDocs,licenseNote:d.licenseNote,status:d.status})),
  design:{physics:'Authored bounded world simulation; information-flow paths are not physical water solvers.',
    gaze:'Supplied by the external hyperemergence engine.',kinematics:'Supplied by the user\u2019s future kinematics architecture.',
    access:'Public concept preview. Real per-record and action authorization requires a backend.',
    determinism:'Identical snapshot bytes and generator version produce identical universe output; stable seed preserves dataset anchors across snapshot updates.'}};
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(universe,null,2)+'\n');
console.log(JSON.stringify({output,sourceRecords,derivedObservationObjects:observations.length,
  derivedReferenceEdges:references.length,datasets:datasets.length,declaredFlows:terrain.rivers.filter(r=>r.kind==='information-flow').length,
  status:universe.dataSummary.status},null,2));

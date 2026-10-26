/* Selected source collections become physical dataset homes. Geometry is a
 * deterministic display mapping; retained records and source metrics stay intact.
 * This module is pure: no network, credentials, globals, or input mutations. */
const FORMS = new Set(['auto', 'peak', 'forest']);
const NATIVE_FORMS = new Set(['peak', 'valley', 'foothill']);
const TREE_BUDGET = 150;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const copy = value => JSON.parse(JSON.stringify(value));

function random(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6D2B79F5;
    let t = Math.imul(h ^ h >>> 15, h | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// The same optional compact alpine kernel as CyberTerrain.field. The returned
// terrain is consumed by that existing field, including collision and roots.
function heightAt(terrain, x, z) {
  let height = finite(terrain.baseline, 8);
  for (const d of terrain.datasets) {
    const dx = x - d.anchor.x, dz = z - d.anchor.z;
    const q = (dx * dx + dz * dz) / (d.radius * d.radius);
    if (q < 1) {
      const a = 1 - q;
      let weight = a * a * a;
      const ruggedness = d.shape === 'alpine-ridge' ? clamp(finite(d.ruggedness, .75), 0, 1) : 0;
      if (ruggedness > 0) {
        const theta = Math.atan2(dz, dx), sine = Math.sin(3 * theta), angular = sine * sine;
        const sharpness = 2.2 * ruggedness, strength = .85 * ruggedness, denominator = 1 + sharpness * q;
        const profile = weight / denominator, cut = 1 - 4 * strength * q * a * angular;
        weight = profile * cut;
      }
      height += d.relief * weight;
    }
  }
  return height;
}

function selectedForm(source, geometry, requested) {
  const native = NATIVE_FORMS.has(geometry.form) ? geometry.form :
    source.structure === 'tabular' ? 'peak' : source.structure === 'object' ? 'foothill' : 'valley';
  return requested === 'auto' ? native : requested === 'peak' ? 'peak' :
    source.structure === 'relational' ? 'valley' : 'foothill';
}

function selectedRelief(geometry, form, terrain) {
  if (form === geometry.form && Number.isFinite(geometry.relief)) return geometry.relief;
  const variation = clamp(finite(geometry.variability, .4), 0, 1);
  const abundance = clamp(finite(geometry.abundance, .5), 0, 1);
  const scale = clamp(finite(terrain.reliefScale, 1), .5, 2);
  return form === 'peak' ? Math.min(45, (12 + 14 * variation) * scale) :
    form === 'foothill' ? (5 + 5 * variation) * scale : -Math.min(7, (3 + 3 * abundance) * scale);
}

function forestFor(terrain, dataset) {
  // One visible tree per retained record, with an evenly distributed bounded
  // sample above the budget. Small collections form compact, denser groves.
  const records = dataset.records;
  const count = Math.min(TREE_BUDGET, records.length);
  const rng = random(`${terrain.seed}/${dataset.id}/selected-forest-v1`);
  const phase = rng() * Math.PI * 2;
  const footprint = Math.min(.82, .3 + Math.sqrt(count) * .045);
  const trees = [];
  for (let i = 0; i < count; i++) {
    const record = records[Math.floor(i * records.length / count)];
    const angle = phase + i * GOLDEN_ANGLE + (rng() - .5) * .12;
    const radius = dataset.radius * (.08 + footprint * Math.sqrt((i + .5) / count));
    const x = dataset.anchor.x + Math.cos(angle) * radius;
    const z = dataset.anchor.z + Math.sin(angle) * radius;
    trees.push({ x, y: heightAt(terrain, x, z), z, height: 2.2 + rng() * 3.4,
      canopy: .9 + rng() * .85, proxy: true, recordId: record.id });
  }
  return { datasetId: dataset.id, trees, retainedRecordCount: records.length,
    omittedRecordCount: records.length - count, sampleBudget: TREE_BUDGET,
    role: 'One tree per retained record in a deterministic bounded sample. Tree dimensions and positions are display choices, not source measurements.' };
}

function retainedRivers(original, terrain, selectedIds) {
  const homes = new Map(terrain.datasets.map(d => [d.id, d]));
  return (original.rivers || []).filter(river => {
    if (river.kind === 'information-flow') {
      const from = river.fromDatasetId || river.from || river.source;
      const to = river.toDatasetId || river.to || river.target;
      return selectedIds.has(from) && selectedIds.has(to);
    }
    return river.kind === 'simulated-drainage' && homes.get(river.datasetId)?.form === 'valley';
  }).map(river => {
    const mapped = copy(river);
    mapped.points = (river.points || []).map(point => ({ ...point, y: heightAt(terrain, point.x, point.z) }));
    if (mapped.kind === 'information-flow') {
      mapped.uphill = mapped.points.some((point, i) => i > 0 && point.y > mapped.points[i - 1].y + 1e-7);
      mapped.gravitySupported = false;
    }
    return mapped;
  });
}

/** Build physical terrain for exactly the user's selected datasets.
 * @param {object} manifest Canonical universe, or a wrapper with its raw universe.
 * @param {{datasetId:string,form:'auto'|'peak'|'forest'}[]} selections
 * @returns {{terrain:object,datasets:object[],summary:object}}
 */
export function buildSelectedLandscape(manifest, selections) {
  const raw = manifest?.raw || manifest;
  const original = raw?.world?.terrain || raw?.terrain;
  if (!original || !Array.isArray(original.datasets) || !Array.isArray(raw?.datasets)) {
    throw Error('A source universe with datasets and mapped terrain is required.');
  }
  if (!Array.isArray(selections) || selections.length === 0) {
    throw Error('Select at least one dataset to generate a landscape.');
  }
  const sourceById = new Map(raw.datasets.map(d => [d.id, d]));
  const geometryById = new Map(original.datasets.map(d => [d.id, d]));
  const requested = new Map();
  for (const selection of selections) {
    if (!selection || typeof selection.datasetId !== 'string' || !sourceById.has(selection.datasetId) || !geometryById.has(selection.datasetId)) {
      throw Error('Every selection must identify an existing mapped source dataset.');
    }
    if (!FORMS.has(selection.form)) throw Error('Dataset form must be auto, peak, or forest.');
    if (requested.has(selection.datasetId)) throw Error(`Dataset ${selection.datasetId} is selected more than once.`);
    requested.set(selection.datasetId, selection.form);
  }

  // Canonical source order makes geometry independent of checkbox click order.
  const datasets = raw.datasets.filter(d => requested.has(d.id)).map(source => {
    const geometry = geometryById.get(source.id);
    if (!geometry.anchor || ![geometry.anchor.x, geometry.anchor.z, geometry.radius].every(Number.isFinite) || geometry.radius <= 0) {
      throw Error(`Dataset ${source.id} has invalid terrain geometry.`);
    }
    if (!Array.isArray(source.records) || source.records.some(record => typeof record?.id !== 'string' || !record.id)) {
      throw Error(`Dataset ${source.id} must retain identified source records.`);
    }
    const form = selectedForm(source, geometry, requested.get(source.id));
    const mapped = { ...copy(source), anchor: copy(geometry.anchor), radius: geometry.radius,
      form, relief: selectedRelief(geometry, form, original), nativeForm: geometry.form,
      requestedForm: requested.get(source.id) };
    if (form === 'peak') { mapped.shape = 'alpine-ridge'; mapped.ruggedness = .86; }
    else { delete mapped.shape; delete mapped.ruggedness; }
    return mapped;
  });
  const selectedIds = new Set(datasets.map(d => d.id));
  const terrain = { ...copy(original), ecosystem: 'selected-datasets',
    datasets: datasets.map(d => {
      const mapped = { ...copy(geometryById.get(d.id)), anchor: copy(d.anchor),
        radius: d.radius, relief: d.relief, form: d.form, nativeForm: d.nativeForm, requestedForm: d.requestedForm };
      if (d.form === 'peak') { mapped.shape = d.shape; mapped.ruggedness = d.ruggedness; }
      else { delete mapped.shape; delete mapped.ruggedness; }
      return mapped;
    }),
    forests: [], rivers: [], glaciers: [], rangeLinks: [],
    selectionMapping: 'Selected datasets retain their original nonoverlapping homes. Peak and forest forms are authored display geometry; source records and numeric metrics are unchanged.' };
  terrain.forests = datasets.filter(d => d.form !== 'peak').map(d => forestFor(terrain, d));
  terrain.rivers = retainedRivers(original, terrain, selectedIds);
  terrain.glaciers = (original.glaciers || []).filter(g => terrain.datasets.some(d => d.id === g.datasetId && d.form === 'peak')).map(copy);
  terrain.rangeLinks = (original.rangeLinks || []).filter(link =>
    terrain.datasets.some(d => d.id === link.from && d.form === 'peak') &&
    terrain.datasets.some(d => d.id === link.to && d.form === 'peak')).map(copy);
  terrain.hydrology = { ...copy(original.hydrology || {}),
    status: terrain.rivers.some(r => r.kind === 'simulated-drainage') ? 'simulated-drainage' : 'dry-scenario',
    note: 'Only retained selected-dataset drainage and declared transfers are displayed. All path elevations are resampled against the selected terrain; no relationship is inferred.' };
  const summary = {
    datasetCount: datasets.length,
    peakCount: datasets.filter(d => d.form === 'peak').length,
    forestCount: terrain.forests.length,
    treeCount: terrain.forests.reduce((sum, grove) => sum + grove.trees.length, 0),
    sourceRecordCount: datasets.filter(d => !d.derived).reduce((sum, d) => sum + d.records.length, 0),
    derivedRecordCount: datasets.filter(d => d.derived).reduce((sum, d) => sum + d.records.length, 0),
  };
  return { terrain, datasets, summary };
}

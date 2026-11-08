/* A data route is an authored climb through retained records. Heights, reach,
 * texture and sound are display mappings, never physical or importance scores.
 * Pure module: no provider requests, storage, clock, credentials or input writes. */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const copy = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const datasetID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const sessionID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const SCALE = Object.freeze([0, 2, 4, 7, 9]);
const ROOTS = Object.freeze([130.812783, 146.832384, 164.813778, 174.614116, 195.997718]);
function hash(value) {
 let h = 2166136261;
 for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
 return (h >>> 0) / 4294967296;
}
const text = (value, fallback = '', max = 500) => typeof value === 'string' ? value.slice(0, max) : fallback;
function https(value) {
 try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
 catch { return ''; }
}
function recordURL(dataset, record) {
 const direct = https(record.url) || https(record.sourceUrl);
 if (direct) return direct;
 const doi = text(record.doi || record.sourceDoi, '', 500);
 return (doi ? https('https://doi.org/' + encodeURIComponent(doi)) : '') ||
  https(dataset.recordSourceUrl) || https(dataset.sourceDocs) || https(dataset.sourceUrl);
}
function dated(record) {
 const value = record.dateInterval?.end || record.date || '';
 // Date precision is preserved for display. The existing end-of-period field
 // supplies chronology; unknown dates sort after dated records without a guess.
 return typeof value === 'string' && /^\d{4}-\d{2}(?:-\d{2})?$/.test(value) ? value : '9999';
}
function observation(record) {
 const value = Number.isFinite(record.value) ? record.value : record.observation?.value;
 const unit = text(record.unit || record.observation?.unit);
 const series = text(record.sourceDatasetId || record.observation?.seriesId);
 return { value: Number.isFinite(value) ? value : null, unit,
  group: JSON.stringify([unit, series]) };
}
function regionAt(progress) { return progress < .24 ? 'base' : progress < .72 ? 'forest' : 'ice'; }

/** The shared front surface for the rendered climbing face, in display metres. */
export function faceSurface(x, y) {
 x = clamp(finite(x), -1000, 1000); y = clamp(finite(y), -1000, 1000);
 const outcrop = .45 * Math.exp(-((x / 4) ** 2 + ((y - 10) / 7) ** 2));
 return 3 + .28 * Math.sin(.43 * x + .1 * y) + .16 * Math.cos(.7 * y - .2 * x) + outcrop;
}
export function faceNormal(x, y) {
 x = clamp(finite(x), -1000, 1000); y = clamp(finite(y), -1000, 1000);
 const a = .43 * x + .1 * y, b = .7 * y - .2 * x;
 const outcrop = .45 * Math.exp(-((x / 4) ** 2 + ((y - 10) / 7) ** 2));
 const dx = .1204 * Math.cos(a) + .032 * Math.sin(b) - x * outcrop / 8;
 const dy = .028 * Math.cos(a) - .112 * Math.sin(b) - (y - 10) * outcrop * 2 / 49;
 const length = Math.hypot(dx, dy, 1);
 return { x: -dx / length, y: -dy / length, z: 1 / length };
}

export function buildBeyondscapeRoute(dataset, { maxHolds = 24 } = {}) {
 if (!dataset || !datasetID(dataset.id) || !Array.isArray(dataset.records)) throw TypeError('An identified dataset with retained records is required.');
 const seen = new Set();
 for (const record of dataset.records) {
  if (!record || typeof record.id !== 'string' || !record.id || seen.has(record.id)) throw TypeError('Every route record needs a unique retained record ID.');
  seen.add(record.id);
 }
 const budget = Math.floor(clamp(finite(maxHolds, 24), 1, 48));
 const ordered = dataset.records.map((record, index) => ({ record, index })).sort((a, b) =>
  dated(a.record).localeCompare(dated(b.record)) || a.index - b.index);
 const count = Math.min(budget, ordered.length);
 // Endpoint-inclusive sampling includes the first and last retained record.
 const sampled = Array.from({ length: count }, (_, i) => ordered[count === 1 ? 0 : Math.round(i * (ordered.length - 1) / (count - 1))].record);
 const numericGroups = new Map();
 for (const { record } of ordered) {
  const observed = observation(record);
  if (observed.value === null) continue;
  if (!numericGroups.has(observed.group)) numericGroups.set(observed.group, { unit: observed.unit, min: observed.value, max: observed.value, count: 0 });
  const group = numericGroups.get(observed.group); group.min = Math.min(group.min, observed.value); group.max = Math.max(group.max, observed.value); group.count++;
 }
 const rootFrequency = ROOTS[Math.floor(hash(dataset.id + ':root') * ROOTS.length)];
 const soundProfile = { rootFrequency, scale: [...SCALE], scaleName: 'Major pentatonic',
  mapping: numericGroups.size ? 'Within-series min/max; different units and source series stay separate.' : 'Ordered route phase; no numeric observation inferred.',
  note: 'Pitch, tempo and timbre are authored listening choices, not measured frequencies or dataset rankings.' };
 const holds = sampled.map((record, index) => {
  const progress = count <= 1 ? 0 : index / (count - 1), phase = hash(dataset.id + ':' + record.id);
  const x = clamp(Math.sin(index * 1.49 + hash(dataset.id) * Math.PI) * 2.55 + (phase - .5) * 1.15, -4, 4);
  const y = 1.5 + progress * 17.5, z = faceSurface(x, y) + .18;
  const observed = observation(record), group = numericGroups.get(observed.group);
  const normalizedValue = observed.value === null ? null : group.max === group.min ? .5 : clamp((observed.value - group.min) / (group.max - group.min), 0, 1);
  const tone = normalizedValue ?? progress;
  const scaleIndex = Math.round(tone * (SCALE.length - 1));
  return { id: dataset.id + ':hold:' + index, recordId: record.id, record: copy(record), index,
   position: { x, y, z }, normal: faceNormal(x, y), value: observed.value, unit: observed.unit,
   normalizedValue, frequency: rootFrequency * 2 ** (SCALE[scaleIndex] / 12),
   region: regionAt(progress), label: text(record.title, record.id),
   date: text(record.date || record.dateInterval?.end), sourceUrl: recordURL(dataset, record) };
 });
 return { datasetId: dataset.id, title: text(dataset.name, dataset.id, 300), sourceCount: dataset.records.length,
  derived: dataset.derived === true, structure: text(dataset.structure, 'relational', 80), holds,
  summary: { holdCount: count, omittedRecordCount: dataset.records.length - count,
   recordKind: dataset.derived === true ? 'derived records' : 'source records',
   mapping: 'Chronological retained records become holds on an authored climbing face. Elevation is display metres, not a source measurement. Above the hold budget, the route samples evenly across the ordered records.',
   numericGroups: [...numericGroups.values()].map(group => ({ ...group })) }, soundProfile };
}

/** Read-only state for the meta display and soundtrack. Empty routes stay silent. */
export function routeTelemetry(route, holdIndex = 0) {
 if (!route || !Array.isArray(route.holds)) throw TypeError('A generated data route is required.');
 const index = route.holds.length ? Math.floor(clamp(finite(holdIndex), 0, route.holds.length - 1)) : -1;
 const hold = route.holds[index], progress = route.holds.length <= 1 ? 0 : index / (route.holds.length - 1);
 const normalizedValue = hold?.normalizedValue ?? null;
 return { datasetId: route.datasetId, title: route.title, index, holdCount: route.holds.length,
  progress, elevation: hold?.position.y || 0, elevationUnit: 'display m', recordId: hold?.recordId || null,
  label: hold?.label || 'No retained records', value: hold?.value ?? null, unit: hold?.unit || '',
  date: hold?.date || '', region: hold?.region || 'base', normalizedValue,
  tempo: 62 + Math.round(progress * 24), brightness: .22 + .64 * (normalizedValue ?? progress),
  rootFrequency: finite(route.soundProfile?.rootFrequency, ROOTS[0]),
  frequency: finite(hold?.frequency, ROOTS[0]), derived: route.derived === true,
  sourceCount: finite(route.sourceCount), sourceUrl: hold?.sourceUrl || '', silent: !hold };
}

export function routeShareURL(base, { datasetId, selection = [], holdIndex = 0, display = 'climb', session } = {}) {
 const url = new URL(base);
 const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
 if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password) throw TypeError('Share routes from HTTPS or a local preview.');
 if (!datasetID(datasetId)) throw TypeError('A valid dataset ID is required for a route link.');
 const ids = [...new Set(selection.map(value => typeof value === 'string' ? value : value?.datasetId).filter(datasetID))].slice(0, 64);
 if (!ids.includes(datasetId)) ids.unshift(datasetId);
 url.search = ''; url.hash = ''; url.searchParams.set('dataset', datasetId);
 if (ids.length) url.searchParams.set('selection', ids.slice(0, 64).join(','));
 url.searchParams.set('hold', String(Math.floor(clamp(finite(holdIndex), 0, 47))));
 if (display === 'meta') url.searchParams.set('display', 'meta');
 if (sessionID(session)) url.searchParams.set('session', session);
 return url.href;
}

export function parseRouteOptions(search, manifest) {
 const known = (manifest?.datasets || []).filter(dataset => datasetID(dataset?.id)).map(dataset => dataset.id);
 if (!known.length) throw TypeError('A source dataset catalogue is required.');
 const params = new URLSearchParams(typeof search === 'string' ? search.slice(0, 16384) : '');
 const source = params.get('selection') || params.get('datasets');
 const selected = source ? [...new Set(source.split(',').filter(id => known.includes(id)))].slice(0, 64) : known;
 const selection = selected.length ? selected : [known[0]];
 const requested = params.get('dataset'), datasetId = selection.includes(requested) ? requested : selection[0];
 const rawHold = params.get('hold');
 const holdIndex = rawHold !== null && /^\d{1,3}$/.test(rawHold) ? Math.floor(clamp(Number(rawHold), 0, 47)) : 0;
 return { datasetId, selection: [...selection], holdIndex, display: params.get('display') === 'meta' ? 'meta' : 'climb',
  session: sessionID(params.get('session')) ? params.get('session') : null };
}

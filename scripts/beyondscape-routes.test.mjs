import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../public/', import.meta.url);
const source = fs.readFileSync(new URL('assets/beyondscape-routes.js', root), 'utf8');
const { buildBeyondscapeRoute, faceSurface, faceNormal, routeTelemetry, routeShareURL, parseRouteOptions } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const manifest = JSON.parse(fs.readFileSync(new URL('assets/universe.json', root), 'utf8'));
const byId = id => manifest.datasets.find(dataset => dataset.id === id);

test('all acquired collections map deterministic exact records to ascending reachable display holds', () => {
 const before = JSON.stringify(manifest);
 for (const dataset of manifest.datasets) {
  const route = buildBeyondscapeRoute(dataset);
  assert.deepEqual(route, buildBeyondscapeRoute(dataset));
  assert.equal(route.sourceCount, dataset.records.length);
  assert.equal(route.holds.length, Math.min(24, dataset.records.length));
  assert.equal(new Set(route.holds.map(hold => hold.recordId)).size, route.holds.length);
  assert.equal(route.holds[0].recordId, [...dataset.records].sort((a, b) => a.dateInterval.end.localeCompare(b.dateInterval.end))[0].id);
  let previous = -Infinity;
  for (const hold of route.holds) {
   assert.deepEqual(hold.record, dataset.records.find(record => record.id === hold.recordId));
   assert.ok(hold.position.y > previous); previous = hold.position.y;
   assert.ok(Math.abs(hold.position.x) <= 4);
   assert.equal(hold.position.z, faceSurface(hold.position.x, hold.position.y) + .18);
   assert.ok(Math.abs(Math.hypot(...Object.values(hold.normal)) - 1) < 1e-12);
   assert.ok(Number.isFinite(hold.frequency));
   assert.ok(!hold.sourceUrl || hold.sourceUrl.startsWith('https://'));
  }
 }
 assert.equal(JSON.stringify(manifest), before);
 const changed = buildBeyondscapeRoute(byId('bls-cpi')); changed.holds[0].record.value = -1;
 assert.equal(JSON.stringify(manifest), before);
});

test('hold budget samples endpoints and chronology without duplicate or invented records', () => {
 const dataset = byId('crossref-reference-edges');
 const route = buildBeyondscapeRoute(dataset, { maxHolds: 7 });
 assert.equal(route.holds.length, 7); assert.equal(route.summary.omittedRecordCount, dataset.records.length - 7);
 const ordered = dataset.records.map((record, index) => ({ record, index })).sort((a, b) => a.record.dateInterval.end.localeCompare(b.record.dateInterval.end) || a.index - b.index);
 assert.equal(route.holds.at(-1).recordId, ordered.at(-1).record.id);
 assert.equal(buildBeyondscapeRoute(dataset, { maxHolds: 9000 }).holds.length, 48);
 assert.equal(buildBeyondscapeRoute(dataset, { maxHolds: -20 }).holds.length, 1);
 assert.equal(buildBeyondscapeRoute(dataset, { maxHolds: NaN }).holds.length, 24);
 assert.equal(route.derived, true); assert.equal(route.summary.recordKind, 'derived records');
});

test('numeric sound normalization never pools CPI and unemployment units', () => {
 const dataset = byId('economic-observations'), route = buildBeyondscapeRoute(dataset);
 assert.equal(route.summary.numericGroups.length, 2);
 for (const sourceId of ['bls-cpi', 'bls-unemployment']) {
  const group = route.holds.filter(hold => hold.record.sourceDatasetId === sourceId);
  assert.equal(Math.min(...group.map(hold => hold.normalizedValue)), 0);
  assert.equal(Math.max(...group.map(hold => hold.normalizedValue)), 1);
 }
 const flat = { id: 'flat', name: 'Constant', records: [{ id: 'a', value: 7, unit: 'kg' }, { id: 'b', value: 7, unit: 'kg' }] };
 for (const hold of buildBeyondscapeRoute(flat).holds) assert.equal(hold.normalizedValue, .5);
});

test('missing, non-finite and qualitative records do not gain fabricated numeric values', () => {
 const dataset = { id: 'qualitative', records: [{ id: 'x', date: '2026-01', url: 'javascript:alert(1)' }, { id: 'y', value: Infinity, unit: 'm' }] };
 const route = buildBeyondscapeRoute(dataset);
 assert.equal(route.summary.numericGroups.length, 0);
 for (const hold of route.holds) { assert.equal(hold.value, null); assert.equal(hold.normalizedValue, null); assert.equal(hold.sourceUrl, ''); }
 const blank = buildBeyondscapeRoute({ id: 'empty', records: [] });
 const telemetry = routeTelemetry(blank); assert.equal(telemetry.index, -1); assert.equal(telemetry.silent, true); assert.equal(telemetry.progress, 0); assert.equal(telemetry.recordId, null);
 const single = routeTelemetry(buildBeyondscapeRoute({ id: 'one', records: [{ id: 'single' }] }), Infinity);
 assert.equal(single.progress, 0); assert.equal(single.elevationUnit, 'display m');
 for (const value of Object.values(single)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
 assert.throws(() => buildBeyondscapeRoute({ id: 'broken', records: [{ id: 'a' }, { id: 'a' }] }), /unique retained/);
});

test('telemetry clamps traversal and carries source identity, value and display-only height', () => {
 const route = buildBeyondscapeRoute(byId('bls-cpi'));
 const first = routeTelemetry(route, -8), last = routeTelemetry(route, 999);
 assert.equal(first.index, 0); assert.equal(first.progress, 0); assert.equal(first.region, 'base');
 assert.equal(last.index, route.holds.length - 1); assert.equal(last.progress, 1); assert.equal(last.region, 'ice');
 assert.equal(last.value, route.holds.at(-1).record.value); assert.equal(last.recordId, route.holds.at(-1).recordId);
 assert.equal(last.elevation, route.holds.at(-1).position.y); assert.equal(last.elevationUnit, 'display m');
 assert.ok(last.tempo >= 62 && last.tempo <= 86); assert.ok(last.brightness >= .22 && last.brightness <= .86);
});

test('surface normals match the rendered analytic face and stay finite at extreme inputs', () => {
 for (const x of [-5, 0, 4.2]) for (const y of [0, 11.4, 20]) {
  const n = faceNormal(x, y), step = 1e-5;
  const dx = (faceSurface(x + step, y) - faceSurface(x - step, y)) / (2 * step);
  const dy = (faceSurface(x, y + step) - faceSurface(x, y - step)) / (2 * step);
  assert.ok(Math.abs(-n.x / n.z - dx) < 1e-9); assert.ok(Math.abs(-n.y / n.z - dy) < 1e-9);
 }
 assert.ok(Number.isFinite(faceSurface(NaN, Infinity))); assert.ok(Object.values(faceNormal(Infinity, NaN)).every(Number.isFinite));
});

test('route links retain only route state and remove credentials, unrelated query and fragments', () => {
 const link = routeShareURL('https://cyberalpine.web.app/beyondscape.html?key=private#old', { datasetId: 'bls-cpi', selection: ['bls-cpi', 'research-crossref'], holdIndex: 8, display: 'meta', session: 'session-123' });
 const parsed = new URL(link); assert.equal(parsed.searchParams.has('key'), false); assert.equal(parsed.hash, '');
 assert.deepEqual(parseRouteOptions(parsed.search, manifest), { datasetId: 'bls-cpi', selection: ['bls-cpi', 'research-crossref'], holdIndex: 8, display: 'meta', session: 'session-123' });
 assert.throws(() => routeShareURL('javascript:alert(1)', { datasetId: 'bls-cpi' }), /HTTPS/);
 assert.throws(() => routeShareURL('https://user:secret@example.com/', { datasetId: 'bls-cpi' }), /HTTPS/);
 assert.throws(() => routeShareURL('http://example.com/', { datasetId: 'bls-cpi' }), /HTTPS/);
 assert.ok(routeShareURL('http://127.0.0.1:8768/beyondscape.html', { datasetId: 'bls-cpi' }).startsWith('http://127.0.0.1:8768/'));
});

test('untrusted query state cannot select unknown datasets, unbounded holds or unsafe sessions', () => {
 const options = parseRouteOptions('?dataset=made-up&selection=made-up,research-crossref,research-crossref&hold=999&display=evil&session=<script>', manifest);
 assert.deepEqual(options, { datasetId: 'research-crossref', selection: ['research-crossref'], holdIndex: 47, display: 'climb', session: null });
 const fallback = parseRouteOptions('?dataset=unknown&selection=not-there&hold=NaN', manifest);
 assert.equal(fallback.datasetId, manifest.datasets[0].id); assert.equal(fallback.holdIndex, 0);
 const defaults = parseRouteOptions('', manifest); assert.deepEqual(defaults.selection, manifest.datasets.map(dataset => dataset.id));
 assert.throws(() => parseRouteOptions('', {}), /catalogue/);
});

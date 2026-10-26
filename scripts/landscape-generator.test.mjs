import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const publicRoot = new URL('../public/', import.meta.url);
const source = fs.readFileSync(new URL('assets/landscape-generator.js', publicRoot), 'utf8');
const { buildSelectedLandscape } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { field } = createRequire(import.meta.url)('../public/assets/terrain.js');
const raw = JSON.parse(fs.readFileSync(new URL('assets/universe.json', publicRoot), 'utf8'));
const selections = ids => ids.map(datasetId => ({ datasetId, form: 'auto' }));

test('selected-only terrain and records retain original metric and geometry evidence', () => {
  const result = buildSelectedLandscape(raw, selections(['bls-cpi', 'economic-observations']));
  assert.deepEqual(result.datasets.map(d => d.id), ['bls-cpi', 'economic-observations']);
  assert.deepEqual(result.terrain.datasets.map(d => d.id), result.datasets.map(d => d.id));
  for (const d of result.datasets) {
    const original = raw.datasets.find(other => other.id === d.id);
    assert.deepEqual(d.records, original.records);
    assert.deepEqual(d.features, original.features);
    assert.deepEqual(d.anchor, original.anchor);
    assert.equal(d.radius, original.radius);
    assert.equal(d.recordCount, original.recordCount);
  }
  const omitted = raw.datasets.find(d => d.id === 'research-crossref');
  assert.equal(field(result.terrain, omitted.anchor.x, omitted.anchor.z).height, result.terrain.baseline);
  assert.deepEqual(result.summary, { datasetCount: 2, peakCount: 1, forestCount: 1, treeCount: 22, sourceRecordCount: 11, derivedRecordCount: 22 });
});

test('forest trees identify exact retained records, bounded without duplicate proxies', () => {
  const result = buildSelectedLandscape(raw, selections(['research-crossref', 'crossref-reference-edges']));
  for (const grove of result.terrain.forests) {
    const d = result.datasets.find(d => d.id === grove.datasetId);
    const known = new Set(d.records.map(r => r.id));
    assert.equal(grove.trees.length, Math.min(150, known.size));
    assert.equal(new Set(grove.trees.map(t => t.recordId)).size, grove.trees.length);
    assert.equal(grove.omittedRecordCount, d.records.length - grove.trees.length);
    for (const tree of grove.trees) {
      assert.ok(known.has(tree.recordId));
      assert.ok(Math.hypot(tree.x - d.anchor.x, tree.z - d.anchor.z) < d.radius);
      assert.equal(tree.y, field(result.terrain, tree.x, tree.z).height);
    }
  }
});

test('forced forest maps relational data to valleys and other structures to wooded foothills', () => {
  const requested = raw.datasets.map(d => ({ datasetId: d.id, form: 'forest' }));
  const result = buildSelectedLandscape(raw, requested);
  assert.equal(result.summary.peakCount, 0);
  assert.equal(result.summary.forestCount, 6);
  for (const d of result.datasets) {
    assert.equal(d.form, d.structure === 'relational' ? 'valley' : 'foothill');
    assert.equal(Math.sign(d.relief), d.structure === 'relational' ? -1 : 1);
    assert.equal(field(result.terrain, d.anchor.x, d.anchor.z).height, result.terrain.baseline + d.relief);
  }
  assert.equal(result.terrain.glaciers.length, 0);
});

test('forced peaks are physical positive relief and remove stale forest and drainage', () => {
  const result = buildSelectedLandscape(raw, [{ datasetId: 'research-crossref', form: 'peak' }]);
  const d = result.datasets[0];
  assert.equal(d.form, 'peak');
  assert.ok(d.relief > 12);
  assert.equal(field(result.terrain, d.anchor.x, d.anchor.z).height, result.terrain.baseline + d.relief);
  assert.equal(result.summary.treeCount, 0);
  assert.equal(result.terrain.rivers.length, 0);
});

test('declared transfers require both endpoints and elevations follow changed relief', () => {
  const missing = buildSelectedLandscape(raw, selections(['economic-observations']));
  assert.equal(missing.terrain.rivers.length, 0);
  const result = buildSelectedLandscape(raw, [{ datasetId: 'bls-cpi', form: 'forest' }, { datasetId: 'economic-observations', form: 'peak' }]);
  const flows = result.terrain.rivers.filter(r => r.kind === 'information-flow');
  assert.equal(flows.length, 1);
  assert.equal(flows[0].fromDatasetId, 'bls-cpi');
  assert.equal(flows[0].toDatasetId, 'economic-observations');
  assert.equal(flows[0].relationship, 'declared deterministic derivation');
  for (const point of flows[0].points) assert.equal(point.y, field(result.terrain, point.x, point.z).height);
  const old = raw.world.terrain.rivers.find(r => r.id === flows[0].id);
  assert.ok(flows[0].points.some((p, i) => p.y !== old.points[i].y));
});

test('deterministic geometry is independent of selection order and does not mutate source', () => {
  const before = JSON.stringify(raw);
  const requested = selections(raw.datasets.map(d => d.id));
  const a = buildSelectedLandscape(raw, requested);
  const b = buildSelectedLandscape({ raw }, [...requested].reverse());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(raw), before);
  a.datasets[0].records[0].value = -999;
  a.terrain.datasets[0].anchor.x = 1234;
  assert.equal(JSON.stringify(raw), before);
  for (let i = 0; i < b.datasets.length; i++) {
    const left = b.datasets[i];
    // Existing homes remain disjoint, including the fixed lake footprint.
    assert.ok(Math.hypot(left.anchor.x - 45, left.anchor.z + 50) > left.radius + 14);
    for (const right of b.datasets.slice(i + 1)) assert.ok(Math.hypot(left.anchor.x - right.anchor.x, left.anchor.z - right.anchor.z) > left.radius + right.radius);
  }
  assert.equal(b.summary.sourceRecordCount, 139);
  assert.equal(b.summary.derivedRecordCount, 351);
});

test('invalid and empty selections fail clearly without silently substituting datasets', () => {
  assert.throws(() => buildSelectedLandscape(raw, []), /Select at least one dataset/);
  assert.throws(() => buildSelectedLandscape(raw, null), /Select at least one dataset/);
  assert.throws(() => buildSelectedLandscape(raw, [{ datasetId: 'invented', form: 'auto' }]), /existing mapped source/);
  assert.throws(() => buildSelectedLandscape(raw, [{ datasetId: 'bls-cpi', form: 'ocean' }]), /auto, peak, or forest/);
  assert.throws(() => buildSelectedLandscape(raw, selections(['bls-cpi', 'bls-cpi'])), /more than once/);
  assert.throws(() => buildSelectedLandscape({}, selections(['bls-cpi'])), /source universe/);
});

test('canonical field keeps its exact original smooth-kernel height and gradient', () => {
  const terrain = raw.world.terrain;
  for (let x = -73; x <= 73; x += 7.1) for (let z = -71; z <= 71; z += 6.7) {
    let height = terrain.baseline, gx = 0, gz = 0;
    for (const d of terrain.datasets) {
      const dx = x - d.anchor.x, dz = z - d.anchor.z;
      const q = (dx * dx + dz * dz) / (d.radius * d.radius);
      if (q >= 1) continue;
      const a = 1 - q, weight = a * a * a;
      const derivative = -6 * d.relief * a * a / (d.radius * d.radius);
      height += d.relief * weight;
      gx += derivative * dx; gz += derivative * dz;
    }
    const actual = field(terrain, x, z);
    assert.equal(actual.height, height);
    assert.deepEqual(actual.gradient, { x: gx, z: gz });
  }
});

test('selected peaks have compact ridgelines, deep gullies and an unchanged central maximum', () => {
  const { terrain, datasets } = buildSelectedLandscape(raw, selections(['bls-cpi']));
  const d = datasets[0], center = field(terrain, d.anchor.x, d.anchor.z);
  assert.equal(d.shape, 'alpine-ridge');
  assert.equal(center.height, terrain.baseline + d.relief);
  assert.deepEqual(center.gradient, { x: 0, z: 0 });
  const distance = d.radius * .5;
  const ridge = field(terrain, d.anchor.x + distance, d.anchor.z);
  const gully = field(terrain, d.anchor.x + Math.cos(Math.PI / 6) * distance, d.anchor.z + Math.sin(Math.PI / 6) * distance);
  assert.ok(ridge.height > gully.height + 1, 'same-radius gully is physically lower than its adjacent ridge');
  assert.ok(ridge.height < terrain.baseline + d.relief * .75 ** 3, 'central profile narrows relative to the original mound');
  for (let i = 0; i < 100; i++) {
    const angle = i * .71, radius = d.radius * i / 100;
    const sample = field(terrain, d.anchor.x + Math.cos(angle) * radius, d.anchor.z + Math.sin(angle) * radius);
    assert.ok(sample.height <= center.height && sample.height >= terrain.baseline);
    assert.ok([sample.height, sample.gradient.x, sample.gradient.z].every(Number.isFinite));
  }
  assert.equal(field(terrain, d.anchor.x + d.radius, d.anchor.z).height, terrain.baseline);
  const smooth = structuredClone(terrain); smooth.datasets[0].ruggedness = 0;
  assert.ok(Math.abs(field(smooth, d.anchor.x + distance, d.anchor.z).height - (terrain.baseline + d.relief * .75 ** 3)) < 1e-12);
});

test('alpine analytic gradients agree with finite differences at ridges, gullies and near center', () => {
  const { terrain, datasets } = buildSelectedLandscape(raw, [{ datasetId: 'research-crossref', form: 'peak' }]);
  const d = datasets[0], step = 1e-6;
  for (const fraction of [.0001, .08, .3, .6, .93, .999]) for (const angle of [0, .21, Math.PI / 6, .82, 1.12, 2.7]) {
    const x = d.anchor.x + Math.cos(angle) * d.radius * fraction;
    const z = d.anchor.z + Math.sin(angle) * d.radius * fraction;
    const analytical = field(terrain, x, z).gradient;
    const gx = (field(terrain, x + step, z).height - field(terrain, x - step, z).height) / (2 * step);
    const gz = (field(terrain, x, z + step).height - field(terrain, x, z - step).height) / (2 * step);
    assert.ok(Math.abs(analytical.x - gx) < 2e-7, `x gradient at r=${fraction}, θ=${angle}`);
    assert.ok(Math.abs(analytical.z - gz) < 2e-7, `z gradient at r=${fraction}, θ=${angle}`);
  }
});

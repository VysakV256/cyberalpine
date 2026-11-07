import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from '../public/vendor/three.core.js';
import { createAlpineForest } from '../public/assets/alpine-vegetation.js';
import { buildSelectedLandscape } from '../public/assets/landscape-generator.js';
import { compileContext, loadGeminiArtifact, PROMPT_VERSION } from '../public/assets/gemini-plan.js';

const assets = new URL('../public/assets/', import.meta.url);
const manifestText = readFileSync(new URL('universe.json', assets), 'utf8');
const manifest = JSON.parse(manifestText);
// Use a reproducible selection, independent of future generated interpretations.
const context = compileContext(manifest);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const artifact = {
  status: 'generated', model: 'fixture-model', promptVersion: PROMPT_VERSION, responseId: 'offline-fixture',
  sourceSnapshotSha256: manifest.sourceSnapshotSha256, universeManifestSha256: sha256(manifestText),
  inputContextSha256: sha256(JSON.stringify(context)),
  plan: { universeTitle: 'Fixture', summary: 'Offline forest selection fixture.',
    datasets: context.datasets.map(d => ({ datasetId: d.datasetId, title: d.name, interpretation: 'Fixture interpretation.',
      visualEmphasis: d.requiredVisualEmphasis, recordIds: d.records.map(r => r.recordId) })) },
};
const readArtifact = value => loadGeminiArtifact(manifest, manifestText, async () => Response.json(value));
const verified = await readArtifact(artifact);

function selectedForest(selections) {
  const { terrain } = buildSelectedLandscape(manifest, selections);
  const trees = terrain.forests.flatMap(grove => grove.trees.map(tree => ({ ...tree, datasetId: grove.datasetId })));
  return createAlpineForest(THREE, trees);
}

test('only boughs of the exact dataset and record change, and clearing restores every original color', () => {
  assert.deepEqual(verified, artifact, 'the verified artifact retains its provenance');
  const books = verified.plan.datasets.find(d => d.datasetId === 'books-crossref');
  const tree = { x: 0, y: 2, z: 0, height: 4, canopy: 1, recordId: books.recordIds[0], datasetId: books.datasetId };
  const instances = [tree, { ...tree, datasetId: 'research-crossref', x: 10 }, { ...tree, recordId: 'another-book', x: 20 }];
  const before = structuredClone(instances);
  const forest = createAlpineForest(THREE, instances);
  const [trunks, boughs] = forest.children;
  const matrices = forest.children.map(mesh => mesh.instanceMatrix.array.slice());
  const trunkColors = trunks.instanceColor.array.slice();
  const baseColors = boughs.instanceColor.array.slice();
  const firstTreeBoughs = createAlpineForest(THREE, [tree]).userData.branchCount;
  forest.userData.applyPlan(verified.plan);
  assert.equal(forest.userData.highlightedTrees, 1);
  const color = new THREE.Color();
  for (let i = 0; i < boughs.count; i++) {
    boughs.getColorAt(i, color);
    if (i < firstTreeBoughs) assert.equal(color.getHex(), 0xffc658);
    else assert.deepEqual(color.toArray(), Array.from(baseColors.subarray(i * 3, i * 3 + 3)));
  }
  assert.deepEqual(trunks.instanceColor.array, trunkColors);
  assert.deepEqual(forest.children.map(mesh => mesh.instanceMatrix.array), matrices);
  assert.deepEqual(instances, before);
  forest.userData.applyPlan(null);
  assert.equal(forest.userData.highlightedTrees, 0);
  assert.deepEqual(boughs.instanceColor.array, baseColors);
});

test('a full verified plan follows selected homes and form changes on regeneration', () => {
  const apply = selections => {
    const forest = selectedForest(selections);
    forest.userData.applyPlan?.(verified.plan);
    return [forest.userData.instances.length, forest.userData.highlightedTrees];
  };
  const auto = manifest.datasets.map(d => ({ datasetId: d.id, form: 'auto' }));
  assert.deepEqual(apply(auto), [289, 28]);
  assert.deepEqual(apply([{ datasetId: 'bls-cpi', form: 'peak' }]), [0, 0]);
  assert.deepEqual(apply([{ datasetId: 'bls-cpi', form: 'forest' }]), [11, 8]);
  assert.deepEqual(apply([{ datasetId: 'books-crossref', form: 'auto' }]), [39, 8]);
  assert.deepEqual(apply([...auto].reverse()), [289, 28]);
  assert.deepEqual(manifest, JSON.parse(manifestText));
});

test('valid references outside the bounded tree sample and empty selections clear prior emphasis', async () => {
  const forest = selectedForest([{ datasetId: 'crossref-reference-edges', form: 'forest' }]);
  const trees = forest.userData.instances;
  const treeIds = new Set(trees.map(tree => tree.recordId));
  const boughs = forest.children[1];
  const seededColors = boughs.instanceColor.array.slice();
  const changed = structuredClone(artifact);
  const entry = changed.plan.datasets.find(d => d.datasetId === 'crossref-reference-edges');
  const absent = entry.recordIds.filter(id => !treeIds.has(id));
  assert.equal(absent.length, 4);
  for (const recordIds of [absent, []]) {
    forest.userData.applyPlan(verified.plan);
    assert.equal(forest.userData.highlightedTrees, 4);
    entry.recordIds = recordIds;
    forest.userData.applyPlan((await readArtifact(changed)).plan);
    assert.equal(forest.userData.highlightedTrees, 0);
    assert.deepEqual(boughs.instanceColor.array, seededColors);
    assert.deepEqual(trees.map(tree => tree.recordId), [...treeIds]);
  }
});

test('missing, malformed, unbound, and invalid artifacts restore the seeded forest without partial application', async () => {
  const forest = selectedForest([{ datasetId: 'bls-cpi', form: 'forest' }]);
  const boughs = forest.children[1];
  const seededColors = boughs.instanceColor.array.slice();
  const invalid = change => {
    const value = structuredClone(artifact);
    change(value);
    return () => Response.json(value);
  };
  const failures = [
    () => { throw Error('File unavailable'); }, () => new Response(null, { status: 404 }),
    () => new Response('{'), invalid(a => { a.status = 'pending'; }),
    ...['sourceSnapshotSha256', 'universeManifestSha256', 'inputContextSha256'].map(key =>
      invalid(a => { a[key] = '0'.repeat(64); })),
    invalid(a => { delete a.model; }), invalid(a => { a.promptVersion = 'old'; }),
    invalid(a => { a.plan.datasets[5].datasetId = 'outside-catalogue'; }),
    invalid(a => { a.plan.datasets[5].visualEmphasis = 'series'; }),
    invalid(a => { a.plan.datasets[5].recordIds = ['invented-record']; }),
    invalid(a => { a.plan.datasets[5].recordIds = [a.plan.datasets[0].recordIds[0]]; }),
  ];
  for (const fetchFile of failures) {
    forest.userData.applyPlan(verified.plan);
    assert.equal(forest.userData.highlightedTrees, 8);
    const result = await loadGeminiArtifact(manifest, manifestText, fetchFile);
    assert.equal(result, null);
    forest.userData.applyPlan(result?.plan);
    assert.equal(forest.userData.highlightedTrees, 0);
    assert.deepEqual(boughs.instanceColor.array, seededColors);
  }
});

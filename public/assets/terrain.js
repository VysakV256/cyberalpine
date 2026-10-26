/* Cyberquest dataset terrain: each summit / basin is one dataset.
 * Fixture design controls are illustrative, never claimed source measurements.
 * Browser global and CommonJS; no network, wall-clock time, or robot kinematics. */
(function (root) {
  'use strict';
  const VERSION = 'cyberquest.dataset-terrain.v1';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fallback, lo = -Infinity, hi = Infinity) => Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  const str = (v, fallback = '', limit = 300) => typeof v === 'string' ? v.slice(0, limit) : fallback;
  const url = v => { try { const u = new URL(v); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const FIXTURES = [
    { id: 'sec-facts', name: 'SEC company facts', form: 'peak', origin: 'SEC EDGAR XBRL', sourceUrl: 'https://www.sec.gov/edgar/sec-api-documentation', abundance: .78, variability: .68, connectedness: .7, explanation: 'Comparable quantitative company facts form a mountain. Height is an illustrative variation control, not company value or importance.' },
    { id: 'bls-series', name: 'BLS economic time series', form: 'peak', origin: 'U.S. Bureau of Labor Statistics', sourceUrl: 'https://www.bls.gov/developers/', abundance: .62, variability: .48, connectedness: .64, explanation: 'Repeated economic measurements form a summit in the quantitative range. A later connector can derive relief from normalized within-series change.' },
    { id: 'worldbank', name: 'World Bank indicators', form: 'peak', origin: 'World Bank Indicators API', sourceUrl: 'https://datahelpdesk.worldbank.org/knowledgebase/topics/125589-developer-information', abundance: .88, variability: .8, connectedness: .8, explanation: 'Cross-country indicator tables form another quantitative mountain. Relief does not rank nations or imply financial forecasts.' },
    { id: 'crossref', name: 'Crossref research registry', form: 'valley', origin: 'Crossref REST API', sourceUrl: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/', abundance: .75, variability: .4, connectedness: .85, explanation: 'Research metadata forms a forested basin: many neighboring records can be read together. Depth is a visual grouping decision, not a quality score.' },
    { id: 'openalex', name: 'OpenAlex scholarly graph', form: 'valley', origin: 'OpenAlex', sourceUrl: 'https://docs.openalex.org/', abundance: .9, variability: .55, connectedness: .95, explanation: 'A scholarly relationship graph forms a dense forested valley. Trees are record proxies; actual citations must retain their explicit source edges.' },
    { id: 'gutenberg', name: 'Project Gutenberg literature', form: 'valley', origin: 'Project Gutenberg', sourceUrl: 'https://www.gutenberg.org/help/feeds.html', abundance: .64, variability: .3, connectedness: .6, explanation: 'A textual collection forms a wooded reading basin. Future trees can stand for works, editions, or passages with explicit identifiers.' },
    { id: 'loc', name: 'Library of Congress objects', form: 'foothill', origin: 'Library of Congress JSON/YAML API', sourceUrl: 'https://www.loc.gov/apis/json-and-yaml/', abundance: .7, variability: .45, connectedness: .72, explanation: 'Nested cultural collection objects form a high forested foothill. Canopies can expose object families; no collection items have been fetched in this fixture.' },
  ];
  function random(seed) {
    let h = 2166136261;
    for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ h >>> 15, h | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function descriptors(input, ecosystem) {
    const provided = Array.isArray(input) && input.length > 0;
    const source = provided ? input.slice(0, 12) : FIXTURES;
    const seen = new Set();
    return source.filter(d => d && typeof d === 'object').map((d, i) => {
      let id = str(d.id, `dataset-${i + 1}`, 80).replace(/[^a-zA-Z0-9_-]/g, '-') || `dataset-${i + 1}`;
      if (seen.has(id)) id += `-${i + 1}`;
      seen.add(id);
      const form = ['peak', 'valley', 'foothill'].includes(d.form) ? d.form : d.structure === 'object' ? 'foothill' : ['numeric', 'time-series', 'table'].includes(d.type) || d.structure === 'tabular' ? 'peak' : 'valley';
      const structure = ['tabular', 'relational', 'object'].includes(d.structure) ? d.structure : form === 'peak' ? 'tabular' : form === 'foothill' ? 'object' : 'relational';
      const item = { id, name: str(d.name, `Dataset ${i + 1}`, 100), form, structure, origin: str(d.origin, 'User dataset descriptor', 160),
        sourceUrl: url(d.sourceUrl || d.url), abundance: num(d.abundance, .5, 0, 1), variability: num(d.variability, .5, 0, 1),
        connectedness: num(d.connectedness, .5, 0, 1), explanation: str(d.explanation, form === 'peak' ? 'A quantitative dataset represented as a summit.' : 'A relational or textual dataset represented as a forested basin.', 700),
        fixture: provided ? d.fixture === true : true,
        metricStatus: 'Illustrative normalized design controls; no source statistics inferred.',
        uncertainty: num(d.uncertainty, .35, 0, 1) };
      if (Number.isSafeInteger(d.recordCount) && d.recordCount >= 0) { item.recordCount = d.recordCount; item.recordCountStatus = 'User-supplied; not verified by the terrain generator.'; }
      return item;
    }).filter(d => ecosystem === 'mountains' ? d.form === 'peak' : ecosystem === 'valleys' ? d.form !== 'peak' : true)
      .sort((a, b) => Number(a.form !== 'peak') - Number(b.form !== 'peak'));
  }
  function field(terrain, x, z) {
    x = num(x, 0, -1e6, 1e6); z = num(z, 0, -1e6, 1e6);
    let height = num(terrain?.baseline, 8, 0, 100), gx = 0, gz = 0, density = .06, uncertainty = 0, weights = 0;
    const contributions = [];
    for (const d of terrain?.datasets || []) {
      const radius = num(d.radius, 12, .1, 100), dx = x - num(d.anchor?.x, 0), dz = z - num(d.anchor?.z, 0);
      const q = (dx * dx + dz * dz) / (radius * radius);
      if (q >= 1) continue;
      // Compact C2 radial kernel. Disjoint supports preserve true dataset extrema.
      const a = 1 - q, amplitude = num(d.relief, 0, -100, 100);
      let weight = a * a * a, derivative = -6 * amplitude * a * a / (radius * radius), ridgeGX = 0, ridgeGZ = 0;
      const ruggedness = d.shape === 'alpine-ridge' ? num(d.ruggedness, .75, 0, 1) : 0;
      if (ruggedness > 0) {
        // Six compact ridgelines alternate with gullies. The positive profile
        // stays below its central maximum and vanishes at the original radius.
        // q*sin²(3θ) has a finite first derivative at the center; the angular
        // contribution is explicitly zero at r=0 instead of dividing by zero.
        const theta = Math.atan2(dz, dx), sine = Math.sin(3 * theta), angular = sine * sine;
        const sharpness = 2.2 * ruggedness, strength = .85 * ruggedness, denominator = 1 + sharpness * q;
        const profile = weight / denominator, profileQ = (-3 * a * a * denominator - weight * sharpness) / (denominator * denominator);
        const cut = 1 - 4 * strength * q * a * angular, cutQ = -4 * strength * (1 - 2 * q) * angular;
        const weightQ = profileQ * cut + profile * cutQ;
        const weightTheta = profile * (-12 * strength * q * a * Math.sin(6 * theta));
        const distanceSquared = dx * dx + dz * dz;
        weight = profile * cut;
        derivative = amplitude * weightQ * 2 / (radius * radius);
        if (distanceSquared > 0) {
          ridgeGX = -amplitude * weightTheta * dz / distanceSquared;
          ridgeGZ = amplitude * weightTheta * dx / distanceSquared;
        }
      }
      const heightContribution = amplitude * weight;
      height += heightContribution; gx += derivative * dx + ridgeGX; gz += derivative * dz + ridgeGZ;
      density += num(d.abundance, .5, 0, 1) * weight * .9;
      uncertainty += num(d.uncertainty, .35, 0, 1) * weight; weights += weight;
      contributions.push({ datasetId: d.id, weight, heightContribution });
    }
    contributions.sort((a, b) => b.weight - a.weight);
    const owner = contributions[0] && terrain.datasets.find(d => d.id === contributions[0].datasetId);
    return { height, gradient: { x: gx, z: gz }, density: clamp(density, 0, 1), uncertainty: weights ? uncertainty / weights : 0,
      contributions, biome: owner ? owner.form === 'peak' ? 'alpine' : owner.form === 'foothill' ? 'high-forest' : 'forest' : 'meadow', datasetId: owner?.id || null };
  }
  function forest(terrain, d, rng, treeBudget) {
    const trees = [], count = Math.min(treeBudget, Math.round(20 + 24 * d.abundance));
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963229728653 + rng() * .22;
      const radius = d.radius * (.3 + .57 * Math.sqrt((i + .5) / count));
      const x = d.anchor.x + Math.cos(angle) * radius, z = d.anchor.z + Math.sin(angle) * radius;
      trees.push({ x, y: field(terrain, x, z).height, z, height: 1.5 + rng() * 2.9, canopy: .7 + rng() * .7, proxy: true });
    }
    return { datasetId: d.id, trees, role: 'Illustrative record proxies; not fetched records or one tree per actual record.' };
  }
  function drainage(terrain, d, rng) {
    const angle = rng() * Math.PI * 2;
    let x = d.anchor.x + Math.cos(angle) * d.radius * .91, z = d.anchor.z + Math.sin(angle) * d.radius * .91;
    const points = [{ x, y: field(terrain, x, z).height, z }];
    let termination = 'iteration-limit';
    for (let i = 0; i < 160; i++) {
      const f = field(terrain, x, z), slope = Math.hypot(f.gradient.x, f.gradient.z);
      const distance = Math.hypot(x - d.anchor.x, z - d.anchor.z);
      if (slope < 1e-5 || distance < .1) { termination = 'closed-basin'; break; }
      let step = Math.min(.75, distance * .4), accepted = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const nx = x - f.gradient.x / slope * step, nz = z - f.gradient.z / slope * step, y = field(terrain, nx, nz).height;
        if (y < f.height - 1e-7) { x = nx; z = nz; points.push({ x, y, z }); accepted = true; break; }
        step *= .5;
      }
      if (!accepted) { termination = 'local-sink'; break; }
    }
    return { id: `drainage-${d.id}`, datasetId: d.id, kind: 'simulated-drainage', width: .45 + d.abundance * .45,
      points, termination, note: 'Downhill geometry in a simulated basin; no citation, capital flow, measured river, or causal relationship is implied. Water stops at the closed-basin sink.' };
  }
  function informationFlow(terrain, from, to) {
    // An authored pipeline uses sampled, honest terrain elevations. Across a
    // level meadow it transfers information; it is not a gravity fluid solver.
    const points = [], dx = to.anchor.x - from.anchor.x, dz = to.anchor.z - from.anchor.z;
    const distance = Math.hypot(dx, dz), steps = Math.ceil(distance / 1.1);
    const startOffset = from.radius * .22, endOffset = to.form === 'foothill' ? to.radius * .35 : 0;
    for (let i = 0; i <= steps; i++) {
      const along = startOffset + (distance - startOffset - endOffset) * i / steps;
      const x = from.anchor.x + dx / distance * along, z = from.anchor.z + dz / distance * along;
      points.push({ x, y: field(terrain, x, z).height, z });
    }
    const uphill = points.some((p, i) => i > 0 && p.y > points[i - 1].y + 1e-7);
    return { id: `information-${from.id}-${to.id}`, datasetId: to.id, fromDatasetId: from.id, toDatasetId: to.id,
      kind: 'information-flow', relationship: 'authored illustrative pipeline',
      transformation: to.structure === 'object' ? 'Illustrative table rows → versioned nested objects. No provider data was transformed.' : 'Illustrative table rows → entity and relationship records. No provider data was transformed.',
      points, width: .65, gravitySupported: false, uphill,
      note: uphill ? 'A conceptual transfer route crosses rising terrain; it requires transport energy. It is not a gravity-driven river or a real provider pipeline.' : 'Non-increasing sampled elevations with level reaches. An information transfer route, not a simulated water flow or real provider pipeline.' };
  }
  function generate(options = {}) {
    const seed = str(String(options.seed ?? 'cyberquest-01'), 'cyberquest-01', 100), rng = random(seed);
    const ecosystem = ['mountains', 'valleys'].includes(options.ecosystem) ? options.ecosystem : 'mixed';
    const reliefScale = num(options.relief, 1, .5, 2), datasets = descriptors(options.datasets, ecosystem);
    if (!datasets.length) throw Error('The selected ecosystem needs at least one compatible dataset descriptor.');
    const columns = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(datasets.length)))), rows = Math.ceil(datasets.length / columns);
    datasets.forEach((d, i) => {
      d.anchor = { x: ((i % columns) - (columns - 1) / 2) * 34 + (rng() - .5) * 3,
        z: ((rows - 1) / 2 - Math.floor(i / columns)) * 34 + (rng() - .5) * 3 };
    });
    datasets.forEach(d => {
      const nearest = Math.min(34, ...datasets.filter(o => o !== d).map(o => Math.hypot(o.anchor.x - d.anchor.x, o.anchor.z - d.anchor.z)));
      d.radius = Math.min(12.5 + d.abundance * 2, nearest * .44);
      d.relief = d.form === 'peak' ? Math.min(45, (12 + d.variability * 14) * reliefScale) : d.form === 'foothill' ? (5 + d.variability * 5) * reliefScale : -Math.min(7, (3 + d.abundance * 3) * reliefScale);
    });
    const terrain = { version: VERSION, seed, ecosystem, baseline: 8, extent: 76, reliefScale, datasets,
      forests: [], rivers: [], glaciers: [], rangeLinks: [],
      mapping: 'One dataset = one local summit, basin or high foothill. Tabular data forms peaks; relational data forms valley forests; nested object data forms high foothill forests. Magnitude is an explicit design control. Baseline is an unmapped meadow.',
      fixtureNotice: 'Source catalogue descriptors only. No source records fetched. Size, variation, links and tree populations are illustrative.',
      hydrology: { model: 'Bounded steepest descent on the terrain height field', status: 'dry-scenario', note: 'No basin dataset in this selection; no river invented.' } };
    const peaks = datasets.filter(d => d.form === 'peak'), valleys = datasets.filter(d => d.form === 'valley'), wooded = datasets.filter(d => d.form !== 'peak');
    // A range link is an explicit grouping, not a generated claim of correlation.
    for (let i = 1; i < peaks.length; i++) terrain.rangeLinks.push({ from: peaks[i - 1].id, to: peaks[i].id,
      interpretation: 'Illustrative quantitative-family grouping; not measured correlation.', geometry: 'grouping-only' });
    let budget = 180;
    for (const d of wooded) { const grove = forest(terrain, d, rng, budget); terrain.forests.push(grove); budget -= grove.trees.length; }
    terrain.rivers = valleys.slice(0, 3).map(d => drainage(terrain, d, rng)).filter(r => r.points.length > 2);
    if (terrain.rivers.length) terrain.hydrology = { ...terrain.hydrology, status: 'simulated-drainage', note: 'Paths descend into closed dataset basins; downstream continuation is not assumed.' };
    if (peaks.length) {
      // Choose the nearest tabular home for each authored pipeline. The pairing
      // is explicitly fictional and never added as an evidence/citation edge.
      for (const target of wooded) {
        const source = [...peaks].sort((a, b) => Math.hypot(a.anchor.x - target.anchor.x, a.anchor.z - target.anchor.z) - Math.hypot(b.anchor.x - target.anchor.x, b.anchor.z - target.anchor.z))[0];
        terrain.rivers.push(informationFlow(terrain, source, target));
      }
      terrain.glaciers = peaks.map(d => ({ datasetId: d.id, anchor: { ...d.anchor }, radius: d.radius * .35,
        archive: 'versioned historical snapshots', note: 'Illustrative archive cap. Ice means retained history, not stale or incorrect evidence. No archive snapshots have been fetched.' }));
    }
    const nodes = datasets.map((d, id) => ({ id, name: d.name, description: `${d.explanation} ${d.metricStatus}`,
      x: d.anchor.x, z: d.anchor.z, height: 2, density: d.abundance, uncertainty: d.uncertainty, kind: 'concept', origin: d.origin + (d.fixture ? ' · illustrative fixture' : ' · supplied descriptor'), url: d.sourceUrl,
      metadata: { dataset: { id: d.id, form: d.form, structure: d.structure, anchor: { ...d.anchor }, relief: d.relief, radius: d.radius, explanation: d.explanation,
        sourceUrl: d.sourceUrl, fixture: d.fixture, metricStatus: d.metricStatus, abundance: d.abundance, variability: d.variability, connectedness: d.connectedness } } }));
    return { version: 'cyberquest.environment.v2', title: ecosystem === 'mountains' ? 'The quantitative range' : ecosystem === 'valleys' ? 'The forested archive basins' : 'Dataset ranges and forested basins',
      visualStyle: 'Mineral summits for quantitative datasets; forested basins for text and relationships; downhill simulated streams; a stable meadow between domains.',
      nodes, edges: [], terrain, weather: { windSpeed: 5, windDirection: 245, precipitation: .8, temperature: 16, label: 'Simulated upland weather', source: 'Simulation preset', observedAt: null, url: '' },
      sources: datasets.map(d => ({ name: d.origin, url: d.sourceUrl, status: 'fixture', note: 'Catalogue descriptor; no live records fetched.' })),
      observations: [], generatedAt: '', provenance: 'Deterministic dataset terrain · illustrative fixture controls' };
  }
  const api = { generate, field, VERSION, FIXTURES: FIXTURES.map(d => ({ ...d })) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CyberTerrain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

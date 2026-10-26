/* Deterministic alpine vegetation. Branches are decorative visual proxies;
 * source identity and record selection stay with the supplied tree instance. */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function seeded(value) {
  let state = 2166136261;
  for (const ch of String(value)) { state ^= ch.charCodeAt(0); state = Math.imul(state, 16777619); }
  return () => { state += 0x6D2B79F5; let t = Math.imul(state ^ state >>> 15, state | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function needleTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 512;
  const c = canvas.getContext('2d'); if (!c) return null;
  const random = seeded('cyberalpine-needle-frond-v1');
  c.clearRect(0, 0, 256, 512); c.lineCap = 'round';
  // The central twig and hundreds of short, individually irregular needles
  // produce a broken, light-permeable silhouette instead of a solid cone.
  c.strokeStyle = '#c7c0a1'; c.lineWidth = 2.3;
  c.beginPath(); c.moveTo(128, 506); c.bezierCurveTo(123, 350, 135, 170, 128, 12); c.stroke();
  for (let row = 0; row < 106; row++) {
    const v = (row + .5) / 106, y = 504 - v * 492;
    const spread = Math.pow(Math.sin(Math.PI * v), .68) * (1 - .28 * v) * 112;
    for (const side of [-1, 1]) for (let tuft = 0; tuft < 3; tuft++) {
      const startX = 128 + (random() - .5) * 10, startY = y + (random() - .5) * 8;
      const reach = spread * (.47 + random() * .53), endX = startX + side * reach;
      const endY = startY - reach * (.14 + random() * .38) - random() * 9;
      c.globalAlpha = .58 + random() * .42;
      c.strokeStyle = ['#d7e6ca', '#b7ceaa', '#ecf0db', '#9ebd99'][Math.floor(random() * 4)];
      c.lineWidth = 1.3 + random() * 1.5;
      c.beginPath(); c.moveTo(startX, startY); c.quadraticCurveTo(startX + side * reach * .5, startY - 2, endX, endY); c.stroke();
      // Tiny offshoots make the ends read as needle sprays at closer range.
      if (tuft === 0) {
        c.lineWidth = 1.2; c.beginPath(); c.moveTo(endX - side * 9, endY + 2); c.lineTo(endX + side * 2, endY - 7); c.stroke();
      }
    }
  }
  c.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4; texture.generateMipmaps = true; return texture;
}
function barkTexture(THREE) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 256;
  const c = canvas.getContext('2d'); if (!c) return null;
  const random = seeded('cyberalpine-bark-v1'); c.fillStyle = '#a3977c'; c.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 150; i++) {
    const x = random() * 128, y = random() * 256;
    c.strokeStyle = i % 3 ? '#655f50' : '#c7b69a'; c.lineWidth = .5 + random() * 2;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + (random() - .5) * 5, y + 9 + random() * 65); c.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2, 2); return texture;
}
function branchGeometry(THREE) {
  // Two curved, crossing fronds form one three-dimensional bough. Each frond
  // has four lengthwise sections; its real needles come from the alpha map.
  const positions = [], uv = [], indices = [];
  for (let plane = 0; plane < 2; plane++) {
    const rotation = plane ? 1.18 : 0;
    for (let row = 0; row <= 4; row++) {
      const t = row / 4, width = [.04, .78, .76, .48, .02][row];
      for (const side of [-1, 1]) {
        const x = side * width * .5, y = -.13 * t * t + .035 * Math.sin(t * Math.PI);
        positions.push(x * Math.cos(rotation) - y * Math.sin(rotation), x * Math.sin(rotation) + y * Math.cos(rotation), t);
        uv.push(side < 0 ? 0 : 1, t);
      }
      if (row < 4) { const a = plane * 10 + row * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); return g;
}

export function createAlpineForest(THREE, instances = [], materials = {}) {
  const group = new THREE.Group(); group.name = 'Alpine record forests';
  const trees = instances.filter(t => t && [t.x, t.y, t.z, t.height, t.canopy].every(Number.isFinite)).slice(0, 600);
  group.userData = { kind: 'record-forest', instances: trees, deterministic: true, visualModel: 'Layered irregular evergreen boughs; no botanical measurements inferred.' };
  if (!trees.length) return group;
  const ownMaterials = [], ownTextures = [];
  const trunkGeometry = new THREE.CylinderGeometry(.3, 1, 1, 7, 2);
  const foliageGeometry = branchGeometry(THREE);
  let bark = materials?.bark, foliage = materials?.foliage;
  if (!bark) {
    const map = barkTexture(THREE); if (map) ownTextures.push(map);
    bark = new THREE.MeshStandardMaterial({ color: '#766b51', roughness: 1, map }); ownMaterials.push(bark);
  }
  if (!foliage) {
    const map = needleTexture(THREE); if (map) ownTextures.push(map);
    foliage = new THREE.MeshStandardMaterial({ color: '#ffffff', map, alphaTest: .16, alphaToCoverage: true,
      side: THREE.DoubleSide, roughness: 1, envMapIntensity: .15, metalness: 0 });
    ownMaterials.push(foliage);
  }
  const branches = [], palette = ['#143b2b', '#1c4b32', '#245b3b', '#2f6842', '#3b754b', '#234f37'];
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const trunks = new THREE.InstancedMesh(trunkGeometry, bark, trees.length); trunks.name = 'Textured pine trunks';
  trunks.castShadow = true; trunks.receiveShadow = true;
  trees.forEach((tree, index) => {
    const random = seeded(`${tree.datasetId || ''}:${tree.x.toFixed(4)}:${tree.z.toFixed(4)}`);
    const h = clamp(tree.height, .6, 14), canopy = clamp(tree.canopy, .2, 4), turn = random() * Math.PI * 2;
    const leanX = (random() - .5) * .055, leanZ = (random() - .5) * .055;
    const trunkRadius = .025 + h * .017;
    dummy.position.set(tree.x, tree.y + h * .5, tree.z); dummy.rotation.set(leanX, turn, leanZ);
    dummy.scale.set(trunkRadius, h, trunkRadius); dummy.updateMatrix(); trunks.setMatrixAt(index, dummy.matrix);
    color.set('#a3977c').multiplyScalar(.75 + random() * .38); trunks.setColorAt(index, color);
    const tiers = 8 + Math.floor(random() * 3), baseColor = palette[Math.floor(random() * palette.length)];
    for (let tier = 0; tier < tiers; tier++) {
      const relative = .19 + tier / (tiers - 1) * .75, ring = 5 + Math.floor(random() * 3);
      const tierTurn = turn + tier * 2.399963;
      for (let b = 0; b < ring; b++) {
        // Deliberate gaps, whorls, variable droop, and a gently leaning crown.
        if (tier > 0 && tier < tiers - 2 && random() < .085) continue;
        const azimuth = tierTurn + b / ring * Math.PI * 2 + (random() - .5) * .45;
        const length = canopy * Math.pow(1 - relative, .62) * (1.35 + random() * .22);
        const c = new THREE.Color(baseColor).multiplyScalar(.72 + random() * .45 + tier / tiers * .12);
        branches.push({ x: tree.x + Math.sin(leanZ) * h * relative, y: tree.y + h * relative + (random() - .5) * h * .035,
          z: tree.z - Math.sin(leanX) * h * relative, angle: azimuth, droop: .08 + random() * .24,
          length, breadth: .85 + random() * .33, color: c });
      }
    }
    // A narrow, irregular leader completes the crown without a cone primitive.
    for (let tip = 0; tip < 3; tip++) branches.push({ x: tree.x, y: tree.y + h * .96, z: tree.z,
      angle: turn + tip * Math.PI * 2 / 3, droop: -.95, length: h * .11,
      breadth: .55, color: new THREE.Color(baseColor).multiplyScalar(1.14) });
  });
  const boughs = new THREE.InstancedMesh(foliageGeometry, foliage, branches.length); boughs.name = 'Layered needle boughs';
  boughs.castShadow = true; boughs.receiveShadow = true;
  branches.forEach((b, index) => {
    dummy.position.set(b.x, b.y, b.z); dummy.rotation.set(b.droop, b.angle, 0, 'YXZ');
    dummy.scale.set(b.length * b.breadth, b.length, b.length); dummy.updateMatrix();
    boughs.setMatrixAt(index, dummy.matrix); boughs.setColorAt(index, b.color);
  });
  trunks.instanceMatrix.needsUpdate = true; boughs.instanceMatrix.needsUpdate = true;
  if (trunks.instanceColor) trunks.instanceColor.needsUpdate = true;
  if (boughs.instanceColor) boughs.instanceColor.needsUpdate = true;
  if (trunks.computeBoundingSphere) trunks.computeBoundingSphere(); if (boughs.computeBoundingSphere) boughs.computeBoundingSphere();
  group.add(trunks, boughs);
  group.userData.treeCount = trees.length; group.userData.branchCount = branches.length;
  group.userData.triangleCount = trees.length * trunkGeometry.index.count / 3 + branches.length * foliageGeometry.index.count / 3;
  // Host can call this before removing the group. Passed-in materials stay owned
  // by the host; internally generated maps and materials are released here.
  group.userData.dispose = () => { for (const t of ownTextures) t.dispose(); for (const m of ownMaterials) m.dispose(); };
  return group;
}

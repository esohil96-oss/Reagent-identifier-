/**
 * test.js – Unit tests for SMILES parser and aromatic ring detection
 *
 * Run with: node tests/test.js
 */

'use strict';

const { parseSMILES }          = require('../lib/smiles');
const {
  isAromaticSymbol,
  detectAromaticRings,
  generateBenzeneVertices,
  generateFuranVertices,
  AromaticRing,
  Molecule
} = require('../lib/aromatic');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    console.error(`     Expected: ${JSON.stringify(expected)}`);
    console.error(`     Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── isAromaticSymbol ────────────────────────────────────────────────────────
console.log('\n[isAromaticSymbol]');
assert(isAromaticSymbol('c'),  'c is aromatic');
assert(isAromaticSymbol('n'),  'n is aromatic');
assert(isAromaticSymbol('o'),  'o is aromatic');
assert(isAromaticSymbol('s'),  's is aromatic');
assert(!isAromaticSymbol('C'), 'C is NOT aromatic');
assert(!isAromaticSymbol('N'), 'N is NOT aromatic');
assert(!isAromaticSymbol('O'), 'O is NOT aromatic');

// ── parseSMILES ─────────────────────────────────────────────────────────────
console.log('\n[parseSMILES]');

(function testBenzene() {
  const { atoms, bonds } = parseSMILES('c1ccccc1');
  assert(atoms.length === 6, 'Benzene: 6 atoms');
  assert(bonds.length === 6, 'Benzene: 6 bonds (5 chain + 1 ring closure)');
  assert(atoms.every(a => a.isAromatic), 'Benzene: all atoms aromatic');
  assert(atoms.every(a => a.symbol === 'c'), 'Benzene: all symbols are c');
})();

(function testBenzoicAcid() {
  const { atoms, bonds } = parseSMILES('c1ccccc1C(=O)O');
  assert(atoms.length === 9, 'Benzoic acid: 9 atoms');
  // 6 aromatic C, 1 aliphatic C, 2 O
  const aromaticCount = atoms.filter(a => a.isAromatic).length;
  assert(aromaticCount === 6, 'Benzoic acid: 6 aromatic atoms');
})();

(function testPyridine() {
  const { atoms } = parseSMILES('c1ccncc1');
  assert(atoms.length === 6, 'Pyridine: 6 atoms');
  const n = atoms.find(a => a.symbol === 'n');
  assert(!!n, 'Pyridine: has aromatic N');
})();

(function testFuran() {
  const { atoms } = parseSMILES('c1ccoc1');
  assert(atoms.length === 5, 'Furan: 5 atoms');
  const o = atoms.find(a => a.symbol === 'o');
  assert(!!o, 'Furan: has aromatic O');
})();

// ── detectAromaticRings ─────────────────────────────────────────────────────
console.log('\n[detectAromaticRings]');

(function testBenzeneRing() {
  const { atoms, bonds } = parseSMILES('c1ccccc1');
  const rings = detectAromaticRings(atoms, bonds);
  assert(rings.length === 1, 'Benzene: 1 ring detected');
  assert(rings[0].ringSize === 6, 'Benzene: ring size = 6');
  assert(rings[0].isAromatic, 'Benzene: ring is aromatic');
})();

(function testFuranRing() {
  const { atoms, bonds } = parseSMILES('c1ccoc1');
  const rings = detectAromaticRings(atoms, bonds);
  assert(rings.length === 1, 'Furan: 1 ring detected');
  assert(rings[0].ringSize === 5, 'Furan: ring size = 5');
})();

(function testNoRingForAliphatic() {
  const { atoms, bonds } = parseSMILES('CCCCCC');
  const rings = detectAromaticRings(atoms, bonds);
  assert(rings.length === 0, 'Hexane: no aromatic rings');
})();

(function testKekule_BenzeneRingDetected() {
  // Kekulé benzene: alternating single/double bonds, uppercase C atoms
  const { atoms, bonds } = parseSMILES('C1=CC=CC=C1');
  const rings = detectAromaticRings(atoms, bonds);
  assert(rings.length === 1, 'Kekulé benzene: 1 ring detected');
  assert(rings[0].ringSize === 6, 'Kekulé benzene: ring size = 6');
  assert(rings[0].isAromatic, 'Kekulé benzene: ring is aromatic');
})();

(function testKekule_BenzeneWithSubstituentDetected() {
  // Kekulé benzaldehyde: substituent on Kekulé benzene ring
  const { atoms, bonds } = parseSMILES('O=CC1=CC=CC=C1');
  const rings = detectAromaticRings(atoms, bonds);
  assert(rings.length === 1, 'Kekulé benzaldehyde: 1 ring detected');
  assert(rings[0].ringSize === 6, 'Kekulé benzaldehyde: ring is aromatic');
})();

(function testNoRingForCyclohexane() {
  // Cyclohexane: 6-membered ring but all single bonds → NOT aromatic
  const { atoms, bonds } = parseSMILES('C1CCCCC1');
  const rings = detectAromaticRings(atoms, bonds);
  assert(rings.length === 0, 'Cyclohexane: no aromatic rings (all single bonds)');
})();

(function testNoRingForCyclohexadiene() {
  // Cyclohexadiene: 6-membered ring with 2 double bonds → NOT aromatic
  const { atoms, bonds } = parseSMILES('C1=CCC=CC1');
  const rings = detectAromaticRings(atoms, bonds);
  assert(rings.length === 0, 'Cyclohexadiene: no aromatic rings (only 2 double bonds)');
})();

// ── generateBenzeneVertices ─────────────────────────────────────────────────
console.log('\n[generateBenzeneVertices]');

(function testHexagonVertices() {
  const verts = generateBenzeneVertices(200, 200, 40);
  assert(verts.length === 6, 'Hexagon: 6 vertices');

  // All vertices should be ~40px from center
  verts.forEach((v, i) => {
    const dist = Math.sqrt((v.x - 200) ** 2 + (v.y - 200) ** 2);
    assert(Math.abs(dist - 40) < 0.01, `Vertex ${i} at correct radius`);
  });

  // Adjacent vertices should be equally spaced
  for (let i = 0; i < 6; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % 6];
    const edgeLen = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    assert(Math.abs(edgeLen - 40) < 0.01, `Hexagon edge ${i}-${(i+1)%6} length ≈ 40`);
  }
})();

// ── generateFuranVertices ───────────────────────────────────────────────────
console.log('\n[generateFuranVertices]');

(function testPentagonVertices() {
  const verts = generateFuranVertices(200, 200, 40);
  assert(verts.length === 5, 'Pentagon: 5 vertices');
  verts.forEach((v, i) => {
    const dist = Math.sqrt((v.x - 200) ** 2 + (v.y - 200) ** 2);
    assert(Math.abs(dist - 40) < 0.01, `Pentagon vertex ${i} at correct radius`);
  });
})();

// ── AromaticRing class ──────────────────────────────────────────────────────
console.log('\n[AromaticRing]');

(function testAromaticRingClass() {
  const atomIndices = [0, 1, 2, 3, 4, 5];
  const ring = new AromaticRing(atomIndices, 6, 100, 100, 40);

  assert(ring.vertices.length === 6, 'AromaticRing: 6 vertices for benzene');
  assert(ring.atomToVertex.size === 6, 'AromaticRing: all atoms mapped to vertices');

  // getVertexForAtom should return the correct vertex
  const v0 = ring.getVertexForAtom(0);
  assert(v0 !== null, 'AromaticRing: getVertexForAtom(0) returns vertex');
  assert(v0.index === 0, 'AromaticRing: vertex index matches');

  // getAttachmentPoint should be beyond the vertex (further from center)
  const ap = ring.getAttachmentPoint(0, 1);
  assert(ap !== null, 'AromaticRing: getAttachmentPoint(0) returns point');
  const apDist = Math.sqrt((ap.x - 100) ** 2 + (ap.y - 100) ** 2);
  assert(apDist > 40, 'AromaticRing: attachment point is beyond vertex radius');

  // vertexX/vertexY should match the vertex coords
  assert(Math.abs(ap.vertexX - v0.x) < 0.001, 'AromaticRing: attachment vertexX matches vertex.x');
  assert(Math.abs(ap.vertexY - v0.y) < 0.001, 'AromaticRing: attachment vertexY matches vertex.y');

  // Unknown atom → null
  assert(ring.getVertexForAtom(99) === null, 'AromaticRing: unknown atom returns null');
})();

// ── Molecule class ──────────────────────────────────────────────────────────
console.log('\n[Molecule]');

(function testMoleculeClass() {
  const mol = new Molecule();
  const ring = new AromaticRing([0,1,2,3,4,5], 6, 100, 100, 40);
  mol.registerAromaticRing(ring);

  assert(mol.aromaticRings.length === 1, 'Molecule: 1 ring registered');
  assert(mol.getRingForAtom(0) === ring, 'Molecule: getRingForAtom(0) returns ring');
  assert(mol.getRingForAtom(3) === ring, 'Molecule: getRingForAtom(3) returns ring');
  assert(mol.getRingForAtom(99) === null, 'Molecule: unknown atom returns null');
})();

// ── Substituent attachment (vertex not center) ──────────────────────────────
console.log('\n[Vertex-based substituent attachment]');

(function testVertexNotCenter() {
  const ring = new AromaticRing([0,1,2,3,4,5], 6, 200, 200, 40);

  // For each atom, the attachment vertex coords should NOT equal the center
  for (let i = 0; i < 6; i++) {
    const v = ring.getVertexForAtom(i);
    const isCenter = Math.abs(v.x - 200) < 0.1 && Math.abs(v.y - 200) < 0.1;
    assert(!isCenter, `Atom ${i}: vertex is NOT at ring center`);
  }

  // Attachment point angle should match vertex angle (outward direction)
  const v = ring.getVertexForAtom(0);
  const ap = ring.getAttachmentPoint(0, 1);
  const expectedAngle = Math.atan2(v.y - 200, v.x - 200);
  assert(
    Math.abs(ap.angle - expectedAngle) < 0.01,
    'Attachment angle points outward from center through vertex'
  );
})();

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed! ✅');
}

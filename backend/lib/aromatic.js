/**
 * aromatic.js
 * Aromatic ring detection, vertex generation, and ring geometry
 * for the Reagent Identifier chemical structure renderer.
 */

'use strict';

// ---------------------------------------------------------------------------
// Helper: detect whether an atom symbol is aromatic (SMILES lowercase)
// ---------------------------------------------------------------------------
function isAromaticSymbol(symbol) {
  return /^[cnosbp]$/.test(symbol);
}

// ---------------------------------------------------------------------------
// Part 1 – Aromatic Ring Detection
// ---------------------------------------------------------------------------

/**
 * Detect aromatic rings in a parsed molecule.
 *
 * @param {Array<{index:number, symbol:string, isAromatic:boolean}>} atoms
 * @param {Array<{from:number, to:number, order:number}>} bonds
 * @returns {Array<{atoms:number[], bonds:number[], isAromatic:boolean, ringSize:number, center:{x:number,y:number}}>}
 */
function detectAromaticRings(atoms, bonds) {
  // Build adjacency list
  const adj = Array.from({ length: atoms.length }, () => []);
  bonds.forEach((b, bi) => {
    adj[b.from].push({ neighbor: b.to, bondIdx: bi });
    adj[b.to].push({ neighbor: b.from, bondIdx: bi });
  });

  const rings = [];
  const foundRingKeys = new Set();

  // DFS-based cycle finder limited to rings of size 5 or 6
  function dfs(start, current, path, pathSet) {
    for (const { neighbor, bondIdx } of adj[current]) {
      if (neighbor === start && path.length >= 5 && path.length <= 6) {
        // Found a ring
        const sorted = [...path].sort((a, b) => a - b).join(',');
        if (!foundRingKeys.has(sorted)) {
          foundRingKeys.add(sorted);
          rings.push([...path]);
        }
        continue;
      }
      if (pathSet.has(neighbor) || path.length >= 6) continue;
      pathSet.add(neighbor);
      path.push(neighbor);
      dfs(start, neighbor, path, pathSet);
      path.pop();
      pathSet.delete(neighbor);
    }
  }

  for (let i = 0; i < atoms.length; i++) {
    const pathSet = new Set([i]);
    dfs(i, i, [i], pathSet);
  }

  // Filter to aromatic rings only (all atoms in ring are aromatic)
  return rings
    .filter(ring => ring.every(idx => atoms[idx] && atoms[idx].isAromatic))
    .map(ring => {
      const ringBonds = bonds
        .map((b, bi) => ({ b, bi }))
        .filter(({ b }) => ring.includes(b.from) && ring.includes(b.to))
        .map(({ bi }) => bi);
      return {
        atoms: ring,
        bonds: ringBonds,
        isAromatic: true,
        ringSize: ring.length,
        center: { x: 0, y: 0 } // will be set by layout engine
      };
    });
}

// ---------------------------------------------------------------------------
// Part 2 – Vertex Generation
// ---------------------------------------------------------------------------

/**
 * Generate vertices for a regular hexagon (benzene).
 *
 * Layout (flat-top, starting at top):
 *       V0
 *    V1    V5
 *    V2    V4
 *       V3
 *
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} [radius=40]
 * @returns {Array<{index:number, x:number, y:number, angle:number, distance:number}>}
 */
function generateBenzeneVertices(centerX, centerY, radius = 40) {
  const vertices = [];
  const angleOffset = -Math.PI / 2; // start from top

  for (let i = 0; i < 6; i++) {
    const angle = angleOffset + (i * Math.PI) / 3; // 60° apart
    vertices.push({
      index: i,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      angle,
      distance: radius
    });
  }
  return vertices;
}

/**
 * Generate vertices for a regular pentagon (furan, thiophene, pyrrole).
 *
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} [radius=40]
 * @returns {Array<{index:number, x:number, y:number, angle:number, distance:number}>}
 */
function generateFuranVertices(centerX, centerY, radius = 40) {
  const vertices = [];
  const angleOffset = -Math.PI / 2;

  for (let i = 0; i < 5; i++) {
    const angle = angleOffset + (i * 2 * Math.PI) / 5;
    vertices.push({
      index: i,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      angle,
      distance: radius
    });
  }
  return vertices;
}

// ---------------------------------------------------------------------------
// Part 3 – AromaticRing class
// ---------------------------------------------------------------------------

class AromaticRing {
  /**
   * @param {number[]} atomIndices  – atom indices that form this ring (in order)
   * @param {number}   ringSize     – 5 or 6
   * @param {number}   centerX
   * @param {number}   centerY
   * @param {number}   [radius=40]
   */
  constructor(atomIndices, ringSize, centerX, centerY, radius = 40) {
    this.atoms = atomIndices;
    this.ringSize = ringSize;
    this.centerX = centerX;
    this.centerY = centerY;
    this.radius = radius;

    if (ringSize === 6) {
      this.vertices = generateBenzeneVertices(centerX, centerY, radius);
    } else if (ringSize === 5) {
      this.vertices = generateFuranVertices(centerX, centerY, radius);
    } else {
      this.vertices = [];
    }

    // Map atom index → vertex
    this.atomToVertex = new Map();
    for (let i = 0; i < atomIndices.length; i++) {
      this.atomToVertex.set(atomIndices[i], this.vertices[i]);
    }
  }

  /**
   * Return the vertex object for a given atom index.
   * @param {number} atomIndex
   * @returns {{index:number, x:number, y:number, angle:number, distance:number}|null}
   */
  getVertexForAtom(atomIndex) {
    return this.atomToVertex.get(atomIndex) || null;
  }

  /**
   * Return the attachment point (beyond the vertex) for a substituent.
   * @param {number} atomIndex
   * @param {number} [substituentCount=1]  how many subs on this atom (for distance adj.)
   * @returns {{x:number, y:number, angle:number, vertexX:number, vertexY:number}|null}
   */
  getAttachmentPoint(atomIndex, substituentCount = 1) {
    const vertex = this.getVertexForAtom(atomIndex);
    if (!vertex) return null;

    const adjustedDistance = this.radius + substituentCount * 10;
    return {
      x: this.centerX + adjustedDistance * Math.cos(vertex.angle),
      y: this.centerY + adjustedDistance * Math.sin(vertex.angle),
      angle: vertex.angle,
      vertexX: vertex.x,
      vertexY: vertex.y
    };
  }
}

// ---------------------------------------------------------------------------
// Part 4 – Molecule class
// ---------------------------------------------------------------------------

class Molecule {
  constructor() {
    /** @type {Array<{index:number, symbol:string, isAromatic:boolean, x:number, y:number}>} */
    this.atoms = [];
    /** @type {Array<{from:number, to:number, order:number}>} */
    this.bonds = [];
    /** @type {AromaticRing[]} */
    this.aromaticRings = [];
    /** @type {Map<number, AromaticRing>} */
    this.atomToRing = new Map();
  }

  registerAromaticRing(ring) {
    this.aromaticRings.push(ring);
    ring.atoms.forEach(idx => this.atomToRing.set(idx, ring));
  }

  getRingForAtom(atomIndex) {
    return this.atomToRing.get(atomIndex) || null;
  }
}

// ---------------------------------------------------------------------------
// Exports (for Node.js tests and ES-module bundlers)
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isAromaticSymbol,
    detectAromaticRings,
    generateBenzeneVertices,
    generateFuranVertices,
    AromaticRing,
    Molecule
  };
}

/**
 * renderer.js
 * ChemicalStructureRenderer – draws 2D chemical structures on an HTML5 canvas.
 *
 * Key fix: substituents attach to ring VERTICES, not the ring center.
 */

'use strict';

/* global parseSMILES, detectAromaticRings, AromaticRing, Molecule */

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const BOND_LENGTH = 40;       // px – standard bond length
const RING_RADIUS = 40;       // px – ring vertex distance from center
const ATOM_FONT  = '13px sans-serif';
const ATOM_RADIUS = 8;        // px – clearance circle around atom label

// ---------------------------------------------------------------------------
// Layout engine  (simple 2D coordinate assignment)
// ---------------------------------------------------------------------------

/**
 * Assign (x, y) coordinates to all atoms using a depth-first walk.
 * Aromatic ring atoms are placed on their ring vertices; substituents
 * are grown outward from those vertices.
 *
 * @param {Molecule} molecule
 * @param {number} startX
 * @param {number} startY
 */
function layoutMolecule(molecule, startX, startY) {
  const { atoms, bonds } = molecule;
  if (atoms.length === 0) return;

  // Build adjacency list
  const adj = Array.from({ length: atoms.length }, () => []);
  bonds.forEach(b => {
    adj[b.from].push(b.to);
    adj[b.to].push(b.from);
  });

  // BFS / DFS coordinate assignment
  const placed = new Set();

  // Place ring atoms first
  molecule.aromaticRings.forEach(ring => {
    ring.vertices.forEach((v, vi) => {
      const atomIdx = ring.atoms[vi];
      atoms[atomIdx].x = v.x;
      atoms[atomIdx].y = v.y;
      placed.add(atomIdx);
    });
  });

  // Place remaining atoms via DFS from the first unplaced atom
  function placeNeighbours(atomIdx, parentIdx, angle) {
    const neighbours = adj[atomIdx].filter(n => !placed.has(n));
    // Find ring for current atom to compute outward direction
    const ring = molecule.getRingForAtom(atomIdx);

    const spreadAngles = spreadAround(angle, neighbours.length);
    neighbours.forEach((n, i) => {
      if (placed.has(n)) return;
      let a = spreadAngles[i];
      if (ring) {
        // Grow substituents outward from vertex
        const vertex = ring.getVertexForAtom(atomIdx);
        if (vertex) {
          a = vertex.angle; // outward radial direction
          // If multiple neighbours, spread them
          if (neighbours.length > 1) {
            const spread = (Math.PI / 4);
            a = vertex.angle + ((i - (neighbours.length - 1) / 2) * spread);
          }
        }
      }
      atoms[n].x = atoms[atomIdx].x + BOND_LENGTH * Math.cos(a);
      atoms[n].y = atoms[atomIdx].y + BOND_LENGTH * Math.sin(a);
      placed.add(n);
      placeNeighbours(n, atomIdx, a);
    });
  }

  // Seed: first atom
  if (!placed.has(0)) {
    atoms[0].x = startX;
    atoms[0].y = startY;
    placed.add(0);
  }
  placeNeighbours(0, -1, 0);

  // Place any disconnected atoms
  let orphanX = startX;
  atoms.forEach((atom, idx) => {
    if (!placed.has(idx)) {
      atom.x = orphanX;
      atom.y = startY + BOND_LENGTH * 3;
      orphanX += BOND_LENGTH;
    }
  });
}

/**
 * Generate n evenly-spaced angles around `baseAngle`, avoiding
 * the backward direction (±150°).
 */
function spreadAround(baseAngle, count) {
  if (count === 0) return [];
  if (count === 1) return [baseAngle];
  const step = (Math.PI * 2) / 3 / (count - 1 || 1);
  return Array.from({ length: count }, (_, i) =>
    baseAngle + (i - (count - 1) / 2) * step
  );
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

/**
 * Draw a bond between two atoms.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number,symbol:string}} a1
 * @param {{x:number,y:number,symbol:string}} a2
 * @param {number} order  bond order (1, 1.5, 2, 3)
 */
function drawBond(ctx, a1, a2, order) {
  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  // Shorten line to avoid overlapping atom labels
  const c1 = needsLabel(a1) ? ATOM_RADIUS : 0;
  const c2 = needsLabel(a2) ? ATOM_RADIUS : 0;
  const x1 = a1.x + ux * c1;
  const y1 = a1.y + uy * c1;
  const x2 = a2.x - ux * c2;
  const y2 = a2.y - uy * c2;

  // Perpendicular unit vector for double/triple bonds
  const px = -uy;
  const py =  ux;
  const offset = 3; // px

  ctx.strokeStyle = elementColor(a1.symbol);
  ctx.lineWidth = 1.5;

  if (order === 1 || order === 1.5) {
    line(ctx, x1, y1, x2, y2);
  } else if (order === 2) {
    line(ctx, x1 + px * offset, y1 + py * offset,
              x2 + px * offset, y2 + py * offset);
    line(ctx, x1 - px * offset, y1 - py * offset,
              x2 - px * offset, y2 - py * offset);
  } else if (order === 3) {
    line(ctx, x1, y1, x2, y2);
    line(ctx, x1 + px * offset * 1.5, y1 + py * offset * 1.5,
              x2 + px * offset * 1.5, y2 + py * offset * 1.5);
    line(ctx, x1 - px * offset * 1.5, y1 - py * offset * 1.5,
              x2 - px * offset * 1.5, y2 - py * offset * 1.5);
  }
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/**
 * Draw the aromatic ring: hexagon/pentagon outline + inner circle.
 * @param {CanvasRenderingContext2D} ctx
 * @param {AromaticRing} ring
 */
function drawAromaticRing(ctx, ring) {
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.8;

  // Outer polygon
  ctx.beginPath();
  ctx.moveTo(ring.vertices[0].x, ring.vertices[0].y);
  for (let i = 1; i < ring.vertices.length; i++) {
    ctx.lineTo(ring.vertices[i].x, ring.vertices[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // Inner dashed circle (aromatic delocalization indicator)
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(ring.centerX, ring.centerY, ring.radius * 0.6, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * Draw an atom label (non-carbon or terminal carbon).
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number, y:number, symbol:string}} atom
 */
function drawAtomLabel(ctx, atom) {
  if (!needsLabel(atom)) return;

  const label = atom.symbol.charAt(0).toUpperCase() + atom.symbol.slice(1);
  ctx.font = ATOM_FONT;
  ctx.fillStyle = elementColor(atom.symbol);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // White background circle
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(atom.x, atom.y, ATOM_RADIUS + 1, 0, 2 * Math.PI);
  ctx.fill();

  ctx.fillStyle = elementColor(atom.symbol);
  ctx.fillText(label, atom.x, atom.y);
}

/** Returns true if this atom should display a text label. */
function needsLabel(atom) {
  const sym = (atom.symbol || '').toUpperCase();
  return sym !== 'C';
}

/** CPK-style element colours. */
function elementColor(symbol) {
  const colors = {
    C: '#222', N: '#3050f8', O: '#ff0d0d', S: '#ffff30',
    F: '#90e050', Cl: '#1ff01f', Br: '#a62929', I: '#940094',
    P: '#ff8000', H: '#999', B: '#ffb5b5'
  };
  const sym = (symbol || 'C').toUpperCase();
  return colors[sym] || '#222';
}

// ---------------------------------------------------------------------------
// Substituent attachment helpers (Part 4 of spec)
// ---------------------------------------------------------------------------

/**
 * Draw a bond from a ring vertex outward to a substituent atom.
 * ✅ CORRECT: bond starts at vertex, not ring center.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {AromaticRing} ring
 * @param {number} atomIndex        ring atom (attachment point)
 * @param {{x:number,y:number}} substituentAtom
 */
function attachSubstituentToRing(ctx, ring, atomIndex, substituentAtom) {
  const vertex = ring.getVertexForAtom(atomIndex);
  if (!vertex) {
    console.warn(`Atom ${atomIndex} not found in ring`);
    return;
  }

  // ✅ Bond starts at ring VERTEX, not center
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.5;
  line(ctx, vertex.x, vertex.y, substituentAtom.x, substituentAtom.y);
}

/**
 * Space multiple substituents around the outward direction of a vertex.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {AromaticRing} ring
 * @param {number} atomIndex
 * @param {Array} substituents   – opaque items (we just need count for spacing)
 * @returns {Array<{substituent:*, x:number, y:number, angle:number}>}
 */
function attachMultipleSubstituentsToRing(ctx, ring, atomIndex, substituents) {
  const vertex = ring.getVertexForAtom(atomIndex);
  if (!vertex) return [];

  const positions = [];
  substituents.forEach((sub, idx) => {
    const angleOffset =
      (idx - (substituents.length - 1) / 2) * (Math.PI / 4);
    const attachAngle = vertex.angle + angleOffset;
    const attachX = vertex.x + BOND_LENGTH * Math.cos(attachAngle);
    const attachY = vertex.y + BOND_LENGTH * Math.sin(attachAngle);

    // ✅ Bond drawn from vertex, not ring center
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    line(ctx, vertex.x, vertex.y, attachX, attachY);

    positions.push({ substituent: sub, x: attachX, y: attachY, angle: attachAngle });
  });
  return positions;
}

// ---------------------------------------------------------------------------
// Main renderer class (Part 5 of spec)
// ---------------------------------------------------------------------------

class ChemicalStructureRenderer {
  /**
   * @param {string|HTMLCanvasElement} canvasOrId
   */
  constructor(canvasOrId) {
    if (typeof canvasOrId === 'string') {
      this.canvas = document.getElementById(canvasOrId);
    } else {
      this.canvas = canvasOrId;
    }
    if (!this.canvas) throw new Error('Canvas element not found');
    this.ctx = this.canvas.getContext('2d');
    this.molecule = new Molecule();
  }

  /**
   * Parse a SMILES string, detect aromatic rings, and build the molecule model.
   * @param {string} smiles
   */
  parseSMILES(smiles) {
    const { atoms, bonds } = parseSMILES(smiles);

    this.molecule = new Molecule();
    this.molecule.atoms = atoms.map(a => ({ ...a, x: 0, y: 0 }));
    this.molecule.bonds = bonds;

    const cx = this.canvas.width  / 2;
    const cy = this.canvas.height / 2;

    // Detect aromatic rings
    const rawRings = detectAromaticRings(atoms, bonds);

    // Place rings side-by-side if multiple (simple horizontal layout)
    rawRings.forEach((rawRing, ri) => {
      const ringCx = cx + ri * (RING_RADIUS * 2.5);
      const aromaticRing = new AromaticRing(
        rawRing.atoms,
        rawRing.ringSize,
        ringCx,
        cy,
        RING_RADIUS
      );
      this.molecule.registerAromaticRing(aromaticRing);
    });

    // Assign 2D coordinates
    layoutMolecule(this.molecule, cx, cy);
  }

  /**
   * Render the molecule onto the canvas.
   */
  render() {
    const { ctx, canvas, molecule } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw aromatic ring outlines
    molecule.aromaticRings.forEach(ring => drawAromaticRing(ctx, ring));

    // 2. Draw non-ring bonds
    const ringAtomSet = new Set(
      molecule.aromaticRings.flatMap(r => r.atoms)
    );

    // Bonds between ring atoms are drawn as part of the polygon above;
    // draw all other bonds here.
    molecule.bonds.forEach(bond => {
      const fromInRing = ringAtomSet.has(bond.from);
      const toInRing   = ringAtomSet.has(bond.to);

      if (fromInRing && toInRing) {
        // Skip – ring edges already drawn as polygon
        return;
      }

      const a1 = molecule.atoms[bond.from];
      const a2 = molecule.atoms[bond.to];

      if (fromInRing) {
        // Bond from ring vertex to substituent
        const ring = molecule.getRingForAtom(bond.from);
        if (ring) {
          attachSubstituentToRing(ctx, ring, bond.from, a2);
        } else {
          drawBond(ctx, a1, a2, bond.order);
        }
      } else if (toInRing) {
        const ring = molecule.getRingForAtom(bond.to);
        if (ring) {
          attachSubstituentToRing(ctx, ring, bond.to, a1);
        } else {
          drawBond(ctx, a1, a2, bond.order);
        }
      } else {
        drawBond(ctx, a1, a2, bond.order);
      }
    });

    // 3. Draw atom labels
    molecule.atoms.forEach(atom => drawAtomLabel(ctx, atom));
  }

  /**
   * Convenience: parse + render in one call.
   * @param {string} smiles
   */
  draw(smiles) {
    this.parseSMILES(smiles);
    this.render();
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ChemicalStructureRenderer,
    layoutMolecule,
    drawAromaticRing,
    drawBond,
    drawAtomLabel,
    attachSubstituentToRing,
    attachMultipleSubstituentsToRing,
    elementColor
  };
}

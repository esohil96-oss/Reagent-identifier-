/**
 * smiles-generator.js
 * Generate a SMILES string from a molecular graph (atoms + bonds).
 *
 * Used by the Structure Builder to convert drawn molecules to SMILES,
 * and by the reaction engine to serialize modified molecules.
 */

'use strict';

/**
 * Convert a molecular graph to a SMILES string.
 *
 * @param {Array<{index:number, symbol:string, isAromatic:boolean}>} atoms
 * @param {Array<{from:number, to:number, order:number}>}            bonds
 * @returns {string} SMILES notation
 */
function moleculeToSMILES(atoms, bonds) {
  if (atoms.length === 0) return '';

  // ── Build adjacency list ────────────────────────────────────────────────
  const adj = atoms.map(() => []);
  bonds.forEach((b, bi) => {
    adj[b.from].push({ to: b.to, order: b.order, bondIdx: bi });
    adj[b.to].push({ to: b.from, order: b.order, bondIdx: bi });
  });

  // ── Identify ring-closure bonds (back-edges in a DFS spanning tree) ─────
  const visited1 = new Set();
  const inStack  = new Set();
  const ringBondIndices = new Set();

  function findBackEdges(v, parentBondIdx) {
    visited1.add(v);
    inStack.add(v);
    for (const { to, bondIdx } of adj[v]) {
      if (bondIdx === parentBondIdx) continue;
      if (inStack.has(to)) {
        ringBondIndices.add(bondIdx);
      } else if (!visited1.has(to)) {
        findBackEdges(to, bondIdx);
      }
    }
    inStack.delete(v);
  }
  findBackEdges(0, -1);

  // Assign a unique ring-closure digit to each ring-closure bond
  const ringDigits = {};
  let nextDigit = 1;
  ringBondIndices.forEach(bi => {
    ringDigits[bi] = nextDigit++;
  });

  // ── Build SMILES via DFS ────────────────────────────────────────────────
  const visited2 = new Set();
  let smiles = '';

  function atomStr(a) {
    if (a.isAromatic) return a.symbol.toLowerCase();
    // OH group stored as O (oxygen; implicit H handled by valence)
    return a.symbol;
  }

  function bondStr(order) {
    if (order === 2) return '=';
    if (order === 3) return '#';
    return ''; // single bond is implicit
  }

  function dfs(v, parentBondIdx, incomingBondOrder) {
    visited2.add(v);

    // Incoming bond character (skip for first atom)
    if (parentBondIdx !== -1) smiles += bondStr(incomingBondOrder);

    // Atom symbol
    smiles += atomStr(atoms[v]);

    // Ring-closure digits at this atom
    for (const { to, order, bondIdx } of adj[v]) {
      if (!ringBondIndices.has(bondIdx)) continue;
      const digit = ringDigits[bondIdx];
      if (visited2.has(to)) {
        // Closing the ring: write bond order (if non-single) + digit
        smiles += bondStr(order) + digit;
      } else {
        // Opening the ring: just write the digit (bond order written at close)
        smiles += digit;
      }
    }

    // Tree-edge children (non-ring-closure bonds to unvisited atoms)
    const children = adj[v].filter(
      ({ to, bondIdx }) => !ringBondIndices.has(bondIdx) && !visited2.has(to)
    );

    children.forEach(({ to, order, bondIdx }, i) => {
      const isLast = i === children.length - 1;
      if (!isLast) smiles += '(';
      dfs(to, bondIdx, order);
      if (!isLast) smiles += ')';
    });
  }

  dfs(0, -1, 0);
  return smiles;
}

// ---------------------------------------------------------------------------
// Exports (Node.js / browser dual use)
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { moleculeToSMILES };
}

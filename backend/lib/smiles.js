/**
 * smiles.js
 * SMILES parser for the Reagent Identifier.
 *
 * Parses a subset of SMILES sufficient to identify:
 *  - Atoms (aromatic/aliphatic)
 *  - Bonds (single, double, triple, aromatic)
 *  - Ring-closure digits
 *  - Branches (parentheses)
 *
 * Returns a {atoms, bonds} object that the renderer uses.
 */

'use strict';

const ELEMENT_PATTERN = /^(Cl|Br|[A-Z]|[cnosbp])/;
const AROMATIC_ATOMS = new Set(['c', 'n', 'o', 's', 'p', 'b']);

/**
 * Parse a SMILES string into atoms and bonds.
 *
 * @param {string} smiles
 * @returns {{ atoms: Array<{index:number, symbol:string, isAromatic:boolean, charge:number, hCount:number}>,
 *             bonds: Array<{from:number, to:number, order:number}> }}
 */
function parseSMILES(smiles) {
  const atoms = [];
  const bonds = [];

  // Stack for branch management
  const stack = [];
  // Ring-opening map: digit -> atomIndex
  const ringOpens = {};

  let prevAtomIdx = null;
  let pendingBondOrder = 1; // default single bond
  let i = 0;

  function addAtom(symbol) {
    const isAromatic = AROMATIC_ATOMS.has(symbol);
    const idx = atoms.length;
    atoms.push({
      index: idx,
      symbol: isAromatic ? symbol : symbol.charAt(0).toUpperCase() + symbol.slice(1),
      isAromatic,
      charge: 0,
      hCount: 0
    });
    return idx;
  }

  function addBond(from, to, order) {
    bonds.push({ from, to, order });
  }

  while (i < smiles.length) {
    const ch = smiles[i];

    // Branch open
    if (ch === '(') {
      stack.push({ prevAtomIdx, pendingBondOrder });
      i++;
      continue;
    }

    // Branch close
    if (ch === ')') {
      const state = stack.pop();
      prevAtomIdx = state.prevAtomIdx;
      pendingBondOrder = state.pendingBondOrder;
      i++;
      continue;
    }

    // Explicit bond characters
    if (ch === '-') { pendingBondOrder = 1; i++; continue; }
    if (ch === '=') { pendingBondOrder = 2; i++; continue; }
    if (ch === '#') { pendingBondOrder = 3; i++; continue; }
    if (ch === ':') { pendingBondOrder = 1.5; i++; continue; } // aromatic

    // Ring-closure digit
    if (/\d/.test(ch)) {
      const digit = parseInt(ch, 10);
      if (ringOpens[digit] !== undefined) {
        // Close ring
        addBond(ringOpens[digit], prevAtomIdx, pendingBondOrder);
        delete ringOpens[digit];
      } else {
        ringOpens[digit] = prevAtomIdx;
      }
      pendingBondOrder = 1;
      i++;
      continue;
    }

    // Bracketed atom: [NH3+], [OH-], etc.
    if (ch === '[') {
      const end = smiles.indexOf(']', i);
      if (end === -1) throw new Error('Unclosed bracket in SMILES at position ' + i);
      const inner = smiles.slice(i + 1, end);
      // Extract element symbol (first uppercase + optional lowercase)
      const symbolMatch = inner.match(/([A-Z][a-z]?|[cnospbif])/);
      const symbol = symbolMatch ? symbolMatch[1] : 'C';
      const atomIdx = addAtom(symbol);
      if (prevAtomIdx !== null) {
        addBond(prevAtomIdx, atomIdx, pendingBondOrder);
        pendingBondOrder = 1;
      }
      prevAtomIdx = atomIdx;
      i = end + 1;
      continue;
    }

    // Regular atom (element symbol)
    const rest = smiles.slice(i);
    const elemMatch = rest.match(ELEMENT_PATTERN);
    if (elemMatch) {
      const symbol = elemMatch[1];
      const atomIdx = addAtom(symbol);
      if (prevAtomIdx !== null) {
        addBond(prevAtomIdx, atomIdx, pendingBondOrder);
        pendingBondOrder = 1;
      }
      prevAtomIdx = atomIdx;
      i += symbol.length;
      continue;
    }

    // Skip unrecognised characters (e.g. '/', '\\', '.')
    i++;
  }

  return { atoms, bonds };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSMILES };
}

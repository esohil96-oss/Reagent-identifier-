/**
 * reaction-engine.js
 * Applies named reagent reactions to a molecule described by SMILES.
 *
 * Currently supports:
 *   NaBH4 – reduction of carbonyls (aldehydes, ketones, acid chlorides)
 *            C=O  →  C–OH  (delivers hydride to carbonyl carbon; selective for
 *            C=O over C=C — alkene double bonds are left intact because they
 *            require an order-2 bond between two carbons, not C–O)
 *            C(=O)Cl  →  not handled separately (C=O bond is caught first)
 */

'use strict';

/* global parseSMILES, moleculeToSMILES */

// ---------------------------------------------------------------------------
// NaBH4 reaction
// ---------------------------------------------------------------------------

/**
 * Information about the NaBH4 reagent displayed in the UI.
 */
const NABH4_INFO = {
  name:        'NaBH4',
  reactionType: 'Reduction',
  subtitle:    'Carbonyl / Acid Chloride \u2192 Alcohol',
  description: 'NaBH4 donates hydride and reduces aldehydes, ketones, and acid chlorides'
};

/**
 * Apply NaBH4 reduction to a SMILES string.
 *
 * Finds the first C=O bond (aldehyde, ketone, or acid chloride carbonyl),
 * reduces it to C–OH by converting the double bond to a single bond and
 * attaching an explicit hydrogen to the oxygen atom.
 * C=C double bonds are left intact (NaBH4 does not reduce isolated alkenes).
 *
 * @param {string} smiles  Reactant SMILES
 * @returns {{ productSmiles: string, reactionFound: boolean }}
 */
function applyNaBH4(smiles) {
  const parsed = parseSMILES(smiles);

  // Deep clone atoms and bonds so the original parse result is not mutated
  const product = {
    atoms: parsed.atoms.map(a => ({ ...a })),
    bonds: parsed.bonds.map(b => ({ ...b }))
  };

  let reactionFound = false;

  for (const bond of product.bonds) {
    if (bond.order !== 2) continue;

    const atom1 = product.atoms[bond.from];
    const atom2 = product.atoms[bond.to];

    let carbon = null;
    let oxygen = null;

    if (atom1.symbol === 'C' && atom2.symbol === 'O') {
      carbon = atom1;
      oxygen = atom2;
    } else if (atom1.symbol === 'O' && atom2.symbol === 'C') {
      carbon = atom2;
      oxygen = atom1;
    }

    if (!carbon || !oxygen) continue;

    // STEP 1: Convert C=O → C–O
    bond.order = 1;

    // STEP 2: Add explicit hydrogen to oxygen (OH formation)
    const hydrogenO = {
      index: product.atoms.length,
      symbol: 'H',
      isAromatic: false,
      charge: 0,
      hCount: 0
    };
    product.atoms.push(hydrogenO);
    product.bonds.push({
      from: oxygen.index,
      to: hydrogenO.index,
      order: 1
    });

    reactionFound = true;
    break; // Only reduce the first carbonyl group
  }

  const productSmiles = reactionFound
    ? moleculeToSMILES(product.atoms, product.bonds)
    : smiles; // return unchanged if no reducible group found

  return { productSmiles, reactionFound };
}

// ---------------------------------------------------------------------------
// Generic dispatch (extend here for future reagents)
// ---------------------------------------------------------------------------

/**
 * Apply a named reagent to a SMILES string.
 *
 * @param {string} reagentName   e.g. 'NaBH4'
 * @param {string} smiles        Reactant SMILES
 * @returns {{ productSmiles:string, reactionFound:boolean, info:object }}
 */
function applyReagent(reagentName, smiles) {
  switch (reagentName.toUpperCase()) {
    case 'NABH4': {
      const result = applyNaBH4(smiles);
      return { ...result, info: NABH4_INFO };
    }
    default:
      throw new Error(`Unknown reagent: ${reagentName}`);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { applyNaBH4, applyReagent, NABH4_INFO };
}

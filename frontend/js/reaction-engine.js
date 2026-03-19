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
 * Finds every C=O bond (where one atom is oxygen and the other carbon),
 * changes the bond order from 2 to 1, and returns the product SMILES.
 * C=C double bonds are left intact (NaBH4 does not reduce isolated alkenes).
 *
 * @param {string} smiles  Reactant SMILES
 * @returns {{ productSmiles: string, reactionFound: boolean }}
 */
function applyNaBH4(smiles) {
  const { atoms, bonds } = parseSMILES(smiles);

  // Find C=O bonds (aldehydes, ketones, or the carbonyl in acid chlorides)
  let reactionFound = false;
  const modifiedBonds = bonds.map(b => {
    if (b.order !== 2) return b;
    const sym1 = (atoms[b.from].symbol || '').toUpperCase();
    const sym2 = (atoms[b.to].symbol || '').toUpperCase();
    const isCarbonyl = (sym1 === 'O' && sym2 === 'C') ||
                       (sym1 === 'C' && sym2 === 'O');
    if (isCarbonyl) {
      reactionFound = true;
      return { ...b, order: 1 }; // reduce C=O → C–O (alcohol)
    }
    return b;
  });

  const productSmiles = reactionFound
    ? moleculeToSMILES(atoms, modifiedBonds)
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

/**
 * structure-builder.js
 * Interactive canvas-based molecular structure editor.
 *
 * Allows users to:
 *  – Place atoms (C, N, Cl, OH) by clicking on the canvas
 *  – Draw bonds (single, double, triple) by clicking two atoms
 *  – Draw a NaBH4 reaction arrow
 *  – Delete atoms / bonds
 *  – Clear the canvas
 *  – Generate SMILES from the drawn graph
 *  – Optionally display atom indices for debugging
 */

'use strict';

/* global moleculeToSMILES, detectAromaticRings */

// ── Drawing constants ───────────────────────────────────────────────────────
const SB_ATOM_RADIUS   = 14;   // px – hit-test and display radius for atoms
const SB_BOND_LEN      = 50;   // px – default new-bond length (unused for click-to-atom)
const SB_FONT          = 'bold 13px sans-serif';
const SB_CLICK_RADIUS  = 16;   // px – click detection radius for atoms
const SB_BOND_HIT      = 6;    // px – click detection half-width for bonds

// ── Atom display colours (CPK) ──────────────────────────────────────────────
function sbAtomColor(symbol) {
  const MAP = {
    C: '#222', N: '#3050f8', O: '#e00', Cl: '#1f901f',
    F: '#90e050', S: '#ccb800', P: '#ff8000', H: '#888'
  };
  const s = (symbol || 'C').toUpperCase().replace(/^OH$/, 'O');
  return MAP[s] || '#444';
}

// ---------------------------------------------------------------------------
class StructureBuilder {
  /**
   * @param {string}   canvasId   – id of the <canvas> element
   * @param {Function} onChange   – called with (smiles:string) whenever graph changes
   */
  constructor(canvasId, onChange) {
    this.canvas = typeof canvasId === 'string'
      ? document.getElementById(canvasId)
      : canvasId;
    if (!this.canvas) throw new Error('Canvas element not found: ' + canvasId);
    this.ctx      = this.canvas.getContext('2d');
    this.onChange = onChange || (() => {});

    // Molecule graph
    this.atoms          = []; // { id, symbol, x, y }
    this.bonds          = []; // { from, to, order }
    this.reactionArrows = []; // { x1, y1, x2, y2, label }

    // Interaction state
    this.activeTool     = 'C';     // current tool name
    this.pendingAtom    = null;    // atom id waiting for bond partner
    this.draggingArrow  = null;    // { x1, y1 } when dragging reaction arrow
    this._nextId        = 0;

    // Options
    this.debugMode      = false;

    this._setupPointerEvents();
    this.redraw();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setTool(name) {
    this.activeTool = name;
    this.pendingAtom = null;
    this.draggingArrow = null;
    this.redraw();
  }

  setDebugMode(on) {
    this.debugMode = on;
    this.redraw();
  }

  clearCanvas() {
    this.atoms          = [];
    this.bonds          = [];
    this.reactionArrows = [];
    this.pendingAtom    = null;
    this.draggingArrow  = null;
    this._nextId        = 0;
    this.redraw();
    this._notify();
  }

  /** Return the SMILES for the drawn molecule (first connected component). */
  getSmiles() {
    if (this.atoms.length === 0) return '';
    const { graphAtoms, graphBonds } = this._toGraph();
    if (graphAtoms.length === 0) return '';
    try {
      return moleculeToSMILES(graphAtoms, graphBonds);
    } catch (e) {
      return '(invalid)';
    }
  }

  // ── Internal graph helpers ────────────────────────────────────────────────

  _newId() { return this._nextId++; }

  /**
   * Convert the drawn atoms/bonds to the format used by parseSMILES / moleculeToSMILES.
   * Also runs aromatic detection so that ring carbons become lowercase 'c'.
   */
  _toGraph() {
    if (this.atoms.length === 0) return { graphAtoms: [], graphBonds: [] };

    // Re-index atoms to 0..n-1
    const idToIdx = {};
    this.atoms.forEach((a, i) => { idToIdx[a.id] = i; });

    // Build a set of atom IDs that participate in at least one double bond
    // (computed once to avoid O(atoms × bonds) iteration per OH atom)
    const atomsWithDoubleBond = new Set();
    this.bonds.forEach(b => {
      if (b.order === 2) {
        atomsWithDoubleBond.add(b.from);
        atomsWithDoubleBond.add(b.to);
      }
    });

    const graphAtoms = this.atoms.map((a, i) => {
      // OH tool → oxygen; set hCount=1 when connected by single bond only
      // (e.g. alcohol or phenol), but not for carbonyl C=O where the user
      // used the OH tool to represent the oxygen of a double bond.
      if (a.symbol === 'OH') {
        return {
          index: i,
          symbol: 'O',
          isAromatic: false,
          hCount: atomsWithDoubleBond.has(a.id) ? 0 : 1
        };
      }
      return { index: i, symbol: a.symbol, isAromatic: false };
    });

    const graphBonds = [];
    this.bonds.forEach(b => {
      const fi = idToIdx[b.from];
      const ti = idToIdx[b.to];
      if (fi !== undefined && ti !== undefined) {
        graphBonds.push({ from: fi, to: ti, order: b.order });
      }
    });

    // Detect aromatic rings and mark atoms as aromatic
    try {
      const rings = detectAromaticRings(graphAtoms, graphBonds);
      rings.forEach(ring => {
        ring.atoms.forEach(idx => {
          graphAtoms[idx].isAromatic = true;
          graphAtoms[idx].symbol = graphAtoms[idx].symbol.toLowerCase();
        });
      });
    } catch (_) { /* non-critical */ }

    return { graphAtoms, graphBonds };
  }

  _notify() {
    this.onChange(this.getSmiles());
  }

  // ── Hit testing ───────────────────────────────────────────────────────────

  _atomAt(px, py) {
    for (let i = this.atoms.length - 1; i >= 0; i--) {
      const a = this.atoms[i];
      const dx = px - a.x;
      const dy = py - a.y;
      if (dx * dx + dy * dy <= SB_CLICK_RADIUS * SB_CLICK_RADIUS) return a;
    }
    return null;
  }

  _bondAt(px, py) {
    for (let i = this.bonds.length - 1; i >= 0; i--) {
      const b = this.bonds[i];
      const a1 = this.atoms.find(a => a.id === b.from);
      const a2 = this.atoms.find(a => a.id === b.to);
      if (!a1 || !a2) continue;
      if (this._pointNearSegment(px, py, a1.x, a1.y, a2.x, a2.y, SB_BOND_HIT)) {
        return b;
      }
    }
    return null;
  }

  _pointNearSegment(px, py, x1, y1, x2, y2, tol) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return false;
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const nx = x1 + t * dx - px;
    const ny = y1 + t * dy - py;
    return nx * nx + ny * ny <= tol * tol;
  }

  // ── Pointer events ────────────────────────────────────────────────────────

  _setupPointerEvents() {
    const cvs = this.canvas;

    cvs.addEventListener('mousedown', e => this._onMouseDown(e));
    cvs.addEventListener('mousemove', e => this._onMouseMove(e));
    cvs.addEventListener('mouseup',   e => this._onMouseUp(e));

    cvs.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];
      this._onMouseDown(this._touchToMouse(t));
    }, { passive: false });

    cvs.addEventListener('touchmove', e => {
      e.preventDefault();
      const t = e.touches[0];
      this._onMouseMove(this._touchToMouse(t));
    }, { passive: false });

    cvs.addEventListener('touchend', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this._onMouseUp(this._touchToMouse(t));
    }, { passive: false });
  }

  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY
    };
  }

  _touchToMouse(touch) {
    return { clientX: touch.clientX, clientY: touch.clientY };
  }

  _onMouseDown(e) {
    const { x, y } = this._canvasPos(e);
    const tool = this.activeTool;

    if (tool === 'DELETE') {
      // Delete atom (and its bonds) or bond
      const atom = this._atomAt(x, y);
      if (atom) {
        this.bonds  = this.bonds.filter(b => b.from !== atom.id && b.to !== atom.id);
        this.atoms  = this.atoms.filter(a => a.id !== atom.id);
        this.redraw(); this._notify(); return;
      }
      const bond = this._bondAt(x, y);
      if (bond) {
        this.bonds = this.bonds.filter(b => b !== bond);
        this.redraw(); this._notify(); return;
      }
      return;
    }

    if (tool === 'REACTION') {
      this.draggingArrow = { x1: x, y1: y };
      return;
    }

    const bondOrder = { SINGLE: 1, DOUBLE: 2, TRIPLE: 3 }[tool];
    if (bondOrder !== undefined) {
      // Bond tool: click atoms to connect them
      const atom = this._atomAt(x, y);
      if (!atom) { this.pendingAtom = null; return; }
      if (this.pendingAtom === null) {
        this.pendingAtom = atom.id;
        this.redraw();
      } else if (this.pendingAtom !== atom.id) {
        // Check if bond already exists; if so, toggle order
        const existing = this.bonds.find(
          b => (b.from === this.pendingAtom && b.to === atom.id) ||
               (b.to === this.pendingAtom && b.from === atom.id)
        );
        if (existing) {
          existing.order = bondOrder;
        } else {
          this.bonds.push({ from: this.pendingAtom, to: atom.id, order: bondOrder });
        }
        this.pendingAtom = null;
        this.redraw(); this._notify();
      }
      return;
    }

    // Atom placement tool
    const symbol = tool; // 'C', 'N', 'Cl', 'OH'
    const hit = this._atomAt(x, y);
    if (hit) {
      // Click on existing atom → place new atom bonded to it using best angle
      const newAtom = { id: this._newId(), symbol, x, y };
      // Snap to a position not overlapping any existing atom
      const angle = this._bestAngle(hit);
      newAtom.x = hit.x + SB_BOND_LEN * Math.cos(angle);
      newAtom.y = hit.y + SB_BOND_LEN * Math.sin(angle);
      this.atoms.push(newAtom);
      this.bonds.push({ from: hit.id, to: newAtom.id, order: 1 });
    } else {
      // Click on empty space → place standalone atom
      this.atoms.push({ id: this._newId(), symbol, x, y });
    }
    this.pendingAtom = null;
    this.redraw(); this._notify();
  }

  _onMouseMove(e) {
    if (this.draggingArrow) {
      const { x, y } = this._canvasPos(e);
      this._drawPreview(x, y);
    }
  }

  _onMouseUp(e) {
    if (this.draggingArrow) {
      const { x, y } = this._canvasPos(e);
      const dx = x - this.draggingArrow.x1;
      const dy = y - this.draggingArrow.y1;
      if (dx * dx + dy * dy > 400) { // at least 20px
        this.reactionArrows.push({
          x1: this.draggingArrow.x1,
          y1: this.draggingArrow.y1,
          x2: x,
          y2: y,
          label: 'NaBH4'
        });
      }
      this.draggingArrow = null;
      this.redraw();
    }
  }

  /** Choose the least-crowded outgoing angle from an atom. */
  _bestAngle(atom) {
    const usedAngles = this.bonds
      .filter(b => b.from === atom.id || b.to === atom.id)
      .map(b => {
        const other = this.atoms.find(a => a.id === (b.from === atom.id ? b.to : b.from));
        return other ? Math.atan2(other.y - atom.y, other.x - atom.x) : null;
      })
      .filter(Boolean);

    // Try 8 candidate directions, pick the one farthest from all used angles
    const candidates = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
    let best = 0, bestScore = -Infinity;
    candidates.forEach(a => {
      const score = usedAngles.reduce((mn, ua) => {
        const diff = Math.abs(((a - ua + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        return Math.min(mn, diff);
      }, Infinity);
      if (score > bestScore) { bestScore = score; best = a; }
    });
    return best;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  redraw() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this._drawGrid();
    this._drawReactionArrows();
    this._drawBonds();
    this._drawAtoms();

    // Highlight pending atom (bond tool selection)
    if (this.pendingAtom !== null) {
      const a = this.atoms.find(at => at.id === this.pendingAtom);
      if (a) {
        ctx.save();
        ctx.strokeStyle = '#0af';
        ctx.lineWidth   = 3;
        ctx.beginPath();
        ctx.arc(a.x, a.y, SB_ATOM_RADIUS + 4, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  _drawGrid() {
    // Subtle dot grid
    const { ctx, canvas } = this;
    const step = 30;
    ctx.save();
    ctx.fillStyle = '#e8e8e8';
    for (let x = step; x < canvas.width; x += step) {
      for (let y = step; y < canvas.height; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawReactionArrows() {
    const { ctx } = this;
    this.reactionArrows.forEach(ar => {
      const dx = ar.x2 - ar.x1, dy = ar.y2 - ar.y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      const headSize = 12;

      ctx.save();
      ctx.strokeStyle = '#333';
      ctx.fillStyle   = '#333';
      ctx.lineWidth   = 2;

      // Shaft
      ctx.beginPath();
      ctx.moveTo(ar.x1, ar.y1);
      ctx.lineTo(ar.x2 - ux * headSize, ar.y2 - uy * headSize);
      ctx.stroke();

      // Arrowhead
      const px = -uy, py = ux;
      ctx.beginPath();
      ctx.moveTo(ar.x2, ar.y2);
      ctx.lineTo(ar.x2 - ux * headSize + px * headSize * 0.4,
                 ar.y2 - uy * headSize + py * headSize * 0.4);
      ctx.lineTo(ar.x2 - ux * headSize - px * headSize * 0.4,
                 ar.y2 - uy * headSize - py * headSize * 0.4);
      ctx.closePath();
      ctx.fill();

      // Label above midpoint
      if (ar.label) {
        const mx = (ar.x1 + ar.x2) / 2;
        const my = (ar.y1 + ar.y2) / 2;
        ctx.font      = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#333';
        ctx.fillText(ar.label, mx, my - 8);
      }
      ctx.restore();
    });
  }

  _drawBonds() {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = '#333';
    ctx.lineWidth   = 1.8;

    this.bonds.forEach(b => {
      const a1 = this.atoms.find(a => a.id === b.from);
      const a2 = this.atoms.find(a => a.id === b.to);
      if (!a1 || !a2) return;

      const dx = a2.x - a1.x, dy = a2.y - a1.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      // Shorten to not overlap atom circles
      const x1 = a1.x + ux * SB_ATOM_RADIUS;
      const y1 = a1.y + uy * SB_ATOM_RADIUS;
      const x2 = a2.x - ux * SB_ATOM_RADIUS;
      const y2 = a2.y - uy * SB_ATOM_RADIUS;
      const px = -uy, py = ux;
      const off = 3;

      ctx.beginPath();
      if (b.order === 1) {
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      } else if (b.order === 2) {
        ctx.moveTo(x1 + px * off, y1 + py * off);
        ctx.lineTo(x2 + px * off, y2 + py * off);
        ctx.moveTo(x1 - px * off, y1 - py * off);
        ctx.lineTo(x2 - px * off, y2 - py * off);
      } else if (b.order === 3) {
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.moveTo(x1 + px * off * 1.6, y1 + py * off * 1.6);
        ctx.lineTo(x2 + px * off * 1.6, y2 + py * off * 1.6);
        ctx.moveTo(x1 - px * off * 1.6, y1 - py * off * 1.6);
        ctx.lineTo(x2 - px * off * 1.6, y2 - py * off * 1.6);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  _drawAtoms() {
    const { ctx } = this;
    ctx.font = SB_FONT;

    this.atoms.forEach((a, idx) => {
      const label = a.symbol;
      const color = sbAtomColor(a.symbol);

      // White background disc
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(a.x, a.y, SB_ATOM_RADIUS + 1, 0, 2 * Math.PI);
      ctx.fill();

      // Atom label
      ctx.fillStyle   = color;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, a.x, a.y);

      // Debug: atom index
      if (this.debugMode) {
        ctx.font      = '9px sans-serif';
        ctx.fillStyle = '#888';
        ctx.fillText(String(idx), a.x + SB_ATOM_RADIUS, a.y - SB_ATOM_RADIUS);
        ctx.font = SB_FONT;
      }

      ctx.restore();
    });
  }

  _drawPreview(mx, my) {
    this.redraw();
    if (this.draggingArrow) {
      const { ctx } = this;
      ctx.save();
      ctx.strokeStyle = '#aaa';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(this.draggingArrow.x1, this.draggingArrow.y1);
      ctx.lineTo(mx, my);
      ctx.stroke();
      ctx.restore();
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StructureBuilder };
}

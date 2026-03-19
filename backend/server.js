/**
 * server.js – Reagent Identifier backend API
 *
 * Provides endpoints for SMILES parsing and molecule information.
 * Serves the frontend static files in development.
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Rate limiters ───────────────────────────────────────────────────────────

/** General limiter for all routes */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

/** Tighter limiter for the parse API */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded, please try again later.' }
});

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(generalLimiter);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ── API routes ──────────────────────────────────────────────────────────────

/**
 * POST /api/parse
 * Body: { smiles: string }
 * Returns: { atoms, bonds, aromaticRings, formula }
 */
app.post('/api/parse', apiLimiter, (req, res) => {
  const { smiles } = req.body;
  if (typeof smiles !== 'string' || smiles.trim() === '') {
    return res.status(400).json({ error: 'smiles field is required' });
  }

  try {
    const { parseSMILES }       = require('./lib/smiles');
    const { detectAromaticRings } = require('./lib/aromatic');

    const { atoms, bonds } = parseSMILES(smiles.trim());
    const rings = detectAromaticRings(atoms, bonds);

    // Compute molecular formula
    const counts = {};
    atoms.forEach(a => {
      const sym = (a.symbol || 'C').toUpperCase();
      counts[sym] = (counts[sym] || 0) + 1;
    });
    const formula = Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([s, n]) => `${s}${n > 1 ? n : ''}`)
      .join('');

    res.json({
      smiles: smiles.trim(),
      atoms,
      bonds,
      aromaticRings: rings.map(r => ({
        atoms:    r.atoms,
        ringSize: r.ringSize,
        isAromatic: r.isAromatic
      })),
      formula,
      atomCount: atoms.length,
      bondCount: bonds.length
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/health
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Reagent Identifier API' });
});

// ── Catch-all: serve frontend index ────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Reagent Identifier server running on http://localhost:${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`API:      http://localhost:${PORT}/api/health`);
});

module.exports = app; // for testing

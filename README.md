# Reagent Identifier

A web application for parsing and visualizing chemical structures from **SMILES** strings. Enter a SMILES notation and get a 2D structure diagram with atom/bond information and aromatic-ring detection.

## Prerequisites

- [Node.js](https://nodejs.org/) v16 or later
- npm (bundled with Node.js)

## Installation

```bash
cd backend
npm install
```

## Running the Server

```bash
cd backend
npm start
```

The server will start on port **3000** by default. Open your browser at:

- **Frontend UI:** <http://localhost:3000>
- **Health check:** <http://localhost:3000/api/health>

To use a different port set the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## API

### `POST /api/parse`

Parse a SMILES string and return atom/bond data plus molecular formula.

**Request body**

```json
{ "smiles": "c1ccccc1" }
```

**Response**

```json
{
  "smiles": "c1ccccc1",
  "atoms": [...],
  "bonds": [...],
  "aromaticRings": [...],
  "formula": "C6",
  "atomCount": 6,
  "bondCount": 6
}
```

### `GET /api/health`

Returns `{ "status": "ok", "service": "Reagent Identifier API" }`.

## Running the Tests

```bash
cd backend
npm test
```

## Project Structure

```
├── backend/
│   ├── server.js        # Express server entry point
│   ├── package.json
│   ├── lib/
│   │   ├── smiles.js    # SMILES parser
│   │   └── aromatic.js  # Aromatic-ring detection
│   └── tests/
│       └── test.js      # Unit tests
└── frontend/
    ├── index.html
    ├── css/styles.css
    └── js/
        ├── smiles.js    # Client-side SMILES parser
        ├── aromatic.js  # Client-side ring detection
        └── renderer.js  # Canvas 2D renderer
```
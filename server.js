/**
 * server.js
 * Zero-dependency static file server, so `npm start` works on a bare Node
 * install. ES modules require an http:// origin - opening index.html straight
 * from the filesystem will not work.
 *
 * This is also the natural place to grow a real backend. See the notes at the
 * bottom of the file and the contract sketched in js/services/ApiService.js.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // Resolve inside ROOT only - blocks ../ traversal.
  const filePath = path.join(ROOT, path.normalize(pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Search Nine Sudoku running at http://localhost:${PORT}\n`);
});

/* ---------------------------------------------------------------------------
 * GROWING THIS INTO A REAL BACKEND
 * ---------------------------------------------------------------------------
 * The core modules under js/core/ are plain ES modules with no DOM access, so
 * this same process can import them:
 *
 *   import { generatePuzzle, serializePuzzle } from './js/core/Generator.js';
 *   import { isSolved } from './js/core/Solver.js';
 *
 * Sketch of the routes ApiService.js already knows how to call:
 *
 *   GET  /api/daily?date=YYYY-MM-DD
 *        Generate with seed = date, cache it, and return the puzzle WITHOUT
 *        the solution field so the answer never ships to the client.
 *
 *   POST /api/scores  { puzzleId, timeMs, grid }
 *        Re-run isSolved(grid, arrows) server-side before writing the row.
 *        Never trust a client-reported completion.
 *
 *   GET  /api/leaderboard?puzzleId=...
 *
 * Then set API_BASE in js/services/ApiService.js to '/api'.
 * ------------------------------------------------------------------------ */

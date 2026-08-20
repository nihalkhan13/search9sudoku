/**
 * ApiService.js
 * The seam between the client and a future backend.
 *
 * Today every method resolves locally: puzzles are generated in the browser
 * and the leaderboard is a stub. When you stand up an Express server, flip
 * `API_BASE` to its URL and each method will prefer the network, falling back
 * to the local path so the app keeps working offline.
 *
 * ---------------------------------------------------------------------------
 * SUGGESTED BACKEND CONTRACT
 * ---------------------------------------------------------------------------
 *   GET  /api/daily?date=YYYY-MM-DD
 *        -> { id, seed, difficulty, puzzle: "<serialised>" }
 *           Omit `solution` from the payload in production and let the server
 *           grade submissions - otherwise the answer ships to the client.
 *
 *   POST /api/puzzles          { difficulty }        -> same shape as above
 *
 *   POST /api/scores           { puzzleId, timeMs, moves, grid }
 *        -> { accepted, rank, percentile }
 *           The server should re-run GameEngine/Solver against `grid` before
 *           accepting, so a tampered client cannot post a bogus time.
 *
 *   GET  /api/leaderboard?puzzleId=...&limit=50
 *        -> { entries: [{ rank, name, timeMs, at }] }
 * ---------------------------------------------------------------------------
 */

import { generatePuzzle, serializePuzzle, deserializePuzzle, deriveSolution } from '../core/Generator.js';
import { todaySeed } from '../core/rng.js';

/** Set to e.g. 'https://api.example.com' (or '/api') to enable the network. */
export const API_BASE = null;

const DEFAULT_TIMEOUT_MS = 6000;

/** fetch with a timeout; resolves null on any failure so callers can fall back. */
async function tryFetch(path, options = {}) {
  if (!API_BASE) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[ApiService] ${path} failed, using local fallback:`, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalise a server payload into the puzzle object the engine expects. */
function hydrate(payload) {
  const puzzle = deserializePuzzle(payload.puzzle);
  // A production server withholds the solution; recover it locally so that
  // "Check" and "Reveal" still work.
  if (!puzzle.solution?.some(Boolean)) {
    puzzle.solution = deriveSolution(puzzle) ?? puzzle.solution;
  }
  if (payload.id) puzzle.id = payload.id;
  return puzzle;
}

/**
 * The puzzle everyone gets today. Deterministic from the date string, so the
 * local fallback produces exactly the same board the server would.
 * @param {string} dateSeed YYYY-MM-DD
 * @param {string} difficulty
 */
export async function fetchDailyPuzzle(dateSeed = todaySeed(), difficulty = 'medium') {
  const remote = await tryFetch(`/daily?date=${encodeURIComponent(dateSeed)}`);
  if (remote?.puzzle) return hydrate(remote);

  const puzzle = generatePuzzle({ difficulty, seed: dateSeed });
  puzzle.id = `daily-${dateSeed}`;
  puzzle.isDaily = true;
  puzzle.dateSeed = dateSeed;
  return puzzle;
}

/**
 * A fresh practice puzzle.
 * @param {string} difficulty 'easy' | 'medium' | 'hard'
 * @param {string} [seed] omit for a random one
 */
export async function fetchPracticePuzzle(difficulty = 'medium', seed) {
  const remote = await tryFetch('/puzzles', {
    method: 'POST',
    body: JSON.stringify({ difficulty, seed }),
  });
  if (remote?.puzzle) return hydrate(remote);

  return generatePuzzle({
    difficulty,
    seed: seed ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  });
}

/**
 * Post a solve time. No-ops (returns `{ accepted:false, offline:true }`) until
 * a backend exists, so the UI can call it unconditionally.
 *
 * @param {object} entry
 * @param {string} entry.puzzleId
 * @param {number} entry.timeMs
 * @param {string} entry.difficulty
 * @param {Int8Array} [entry.grid] final board, for server-side verification
 */
export async function submitLeaderboardScore(entry) {
  const remote = await tryFetch('/scores', {
    method: 'POST',
    body: JSON.stringify({
      puzzleId: entry.puzzleId,
      timeMs: entry.timeMs,
      difficulty: entry.difficulty,
      grid: entry.grid ? Array.from(entry.grid).join('') : undefined,
    }),
  });
  if (remote) return remote;

  return { accepted: false, offline: true };
}

/** Top times for a puzzle. Returns an empty list until a backend exists. */
export async function fetchLeaderboard(puzzleId, limit = 50) {
  const remote = await tryFetch(`/leaderboard?puzzleId=${encodeURIComponent(puzzleId)}&limit=${limit}`);
  return remote?.entries ?? [];
}

/** Share link for the current puzzle - works today, no backend required. */
export function buildShareUrl(puzzle) {
  const url = new URL(window.location.href);
  url.hash = `p=${encodeURIComponent(serializePuzzle(puzzle))}`;
  return url.toString();
}

/** Read a puzzle out of the URL hash, if one is there. */
export function readPuzzleFromUrl() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash.startsWith('p=')) return null;
  try {
    return deserializePuzzle(decodeURIComponent(hash.slice(2)));
  } catch (err) {
    console.warn('[ApiService] bad puzzle in URL:', err.message);
    return null;
  }
}

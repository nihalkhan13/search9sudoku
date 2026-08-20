/**
 * Generator.js
 * Builds Search Nine puzzles that are guaranteed to have exactly one solution.
 *
 * PIPELINE
 *   1. Randomised backtracking produces a complete, valid Sudoku solution.
 *   2. For every non-9 cell we work out which arrow directions would be
 *      truthful for that solution (a cell holding 4 can carry a RIGHT arrow
 *      only if the row's 9 sits exactly 4 columns to its right).
 *   3. We start from a maximal arrow layout, add a handful of given digits if
 *      the difficulty asks for them, then greedily strip arrows back for as
 *      long as the puzzle stays uniquely solvable.
 *
 * Everything is driven by a seeded RNG, so the same seed always yields the
 * same puzzle - that is what makes Daily Puzzle mode work without a server.
 */

import {
  CELLS,
  SIZE,
  NO_ARROW,
  DIR,
  rowOf,
  colOf,
  indexOf,
} from './constants.js';
import { createRng } from './rng.js';
import { solve, hasUniqueSolution, compileArrows } from './Solver.js';

/**
 * Tuning knobs per difficulty.
 *
 * A random solved board only offers ~17 legal arrow placements on average
 * (for a given row, a RIGHT arrow works at column c only when that cell's
 * digit happens to equal the distance to the row's 9), so we sample many
 * boards and keep the most arrow-rich one. Difficulty is then a matter of how
 * many of those arrows we keep and how many free digits we hand over.
 */
export const DIFFICULTY = Object.freeze({
  easy: {
    label: 'Easy',
    stripArrows: false, // keep the full arrow layout
    extraGivens: 8, // free digits on top of the minimum needed
    boardSamples: 700,
  },
  medium: {
    label: 'Medium',
    stripArrows: true,
    minArrows: 24, // stop stripping once this few remain
    extraGivens: 3,
    boardSamples: 700,
  },
  hard: {
    label: 'Hard',
    stripArrows: true,
    minArrows: 0, // strip as far as uniqueness allows
    // Keep a few seed digits so hard boards remain approachable without
    // relying on Check to recover from an ambiguous-looking start.
    extraGivens: 6,
    boardSamples: 500,
  },
});

/* -------------------------------------------------------------------------
 * Step 1 - a complete Sudoku solution
 * ---------------------------------------------------------------------- */

/** Randomised backtracking fill of an empty 9x9 grid. */
export function generateSolution(rng) {
  const grid = new Int8Array(CELLS);
  const rows = new Uint16Array(SIZE);
  const cols = new Uint16Array(SIZE);
  const boxes = new Uint16Array(SIZE);
  const boxOfCell = (i) => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);

  const fill = (i) => {
    if (i === CELLS) return true;
    const r = rowOf(i);
    const c = colOf(i);
    const b = boxOfCell(i);
    const used = rows[r] | cols[c] | boxes[b];

    const digits = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const d of digits) {
      const m = 1 << (d - 1);
      if (used & m) continue;
      grid[i] = d;
      rows[r] |= m;
      cols[c] |= m;
      boxes[b] |= m;
      if (fill(i + 1)) return true;
      rows[r] &= ~m;
      cols[c] &= ~m;
      boxes[b] &= ~m;
      grid[i] = 0;
    }
    return false;
  };

  fill(0);
  return grid;
}

/* -------------------------------------------------------------------------
 * Step 2 - which arrows are truthful for this solution?
 * ---------------------------------------------------------------------- */

/**
 * For each cell, the directions whose Search Nine claim holds in `solution`.
 * Cells holding a 9 get an empty list - distance 0 is not a digit.
 *
 * @returns {number[][]} indexed by cell, each entry an array of DIR values
 */
export function arrowOptions(solution) {
  // Where does the 9 live in each row / column?
  const nineInRow = new Int8Array(SIZE).fill(-1);
  const nineInCol = new Int8Array(SIZE).fill(-1);
  for (let i = 0; i < CELLS; i++) {
    if (solution[i] === 9) {
      nineInRow[rowOf(i)] = colOf(i);
      nineInCol[colOf(i)] = rowOf(i);
    }
  }

  const options = [];
  for (let i = 0; i < CELLS; i++) {
    const v = solution[i];
    if (v === 9) {
      options.push([]);
      continue;
    }
    const r = rowOf(i);
    const c = colOf(i);
    const dirs = [];
    if (nineInRow[r] === c + v) dirs.push(DIR.RIGHT);
    if (nineInRow[r] === c - v) dirs.push(DIR.LEFT);
    if (nineInCol[c] === r + v) dirs.push(DIR.DOWN);
    if (nineInCol[c] === r - v) dirs.push(DIR.UP);
    options.push(dirs);
  }
  return options;
}

/* -------------------------------------------------------------------------
 * Step 3 - carve a puzzle
 * ---------------------------------------------------------------------- */

/**
 * Generate a complete Search Nine puzzle.
 *
 * @param {object} opts
 * @param {'easy'|'medium'|'hard'} opts.difficulty
 * @param {string} opts.seed        deterministic seed (date string for dailies)
 * @param {number} opts.maxAttempts retries before giving up on a solution board
 * @returns {{
 *   id: string, seed: string, difficulty: string,
 *   grid: Int8Array, arrows: Int8Array, solution: Int8Array,
 *   givens: boolean[], stats: object
 * }}
 */
export function generatePuzzle(opts = {}) {
  const difficulty = opts.difficulty && DIFFICULTY[opts.difficulty] ? opts.difficulty : 'medium';
  const cfg = DIFFICULTY[difficulty];
  const baseSeed = opts.seed ?? `rnd-${Date.now()}-${Math.random()}`;
  const rng = createRng(`${baseSeed}#${difficulty}`);

  // --- Pick an arrow-rich solution board -------------------------------
  const solution = pickArrowRichSolution(rng, opts.boardSamples ?? cfg.boardSamples);
  const arrows = maximalArrows(solution, rng);

  // --- Carve ------------------------------------------------------------
  // Start from the fully revealed board. That is trivially unique, so every
  // step below can only ever *keep* uniqueness - the puzzle we hand back is
  // unique by construction rather than by luck.
  const grid = Int8Array.from(solution);
  const budget = { maxNodes: opts.maxNodes ?? 400000 };
  const unique = () => hasUniqueSolution(grid, arrows, budget);

  // 1. Remove as many given digits as possible, so the arrows carry the
  //    solve rather than the digits.
  const cellOrder = rng.shuffle([...Array(CELLS).keys()]);
  for (const cell of cellOrder) {
    const saved = grid[cell];
    grid[cell] = 0;
    if (!unique()) grid[cell] = saved;
  }

  // 2. Remove redundant arrows (harder difficulties only).
  if (cfg.stripArrows) {
    const arrowCells = [];
    for (let i = 0; i < CELLS; i++) if (arrows[i] !== NO_ARROW) arrowCells.push(i);
    rng.shuffle(arrowCells);
    let remaining = arrowCells.length;
    const floor = cfg.minArrows ?? 0;
    for (const cell of arrowCells) {
      if (remaining <= floor) break;
      const saved = arrows[cell];
      arrows[cell] = NO_ARROW;
      if (unique()) remaining--;
      else arrows[cell] = saved;
    }

    // Dropping arrows can make a previously required given redundant, so
    // sweep the digits once more.
    for (const cell of cellOrder) {
      if (!grid[cell]) continue;
      const saved = grid[cell];
      grid[cell] = 0;
      if (!unique()) grid[cell] = saved;
    }
  }

  // 3. Hand back a few extra digits where configured. Adding information can
  //    never break uniqueness, so no re-check is needed.
  if (cfg.extraGivens > 0) {
    const spare = cellOrder.filter((i) => !grid[i] && arrows[i] === NO_ARROW);
    const fallbackSpare = cellOrder.filter((i) => !grid[i]);
    const pool = spare.length >= cfg.extraGivens ? spare : fallbackSpare;
    for (let k = 0; k < cfg.extraGivens && k < pool.length; k++) {
      grid[pool[k]] = solution[pool[k]];
    }
  }

  return finalise({ solution, arrows, grid, difficulty, seed: baseSeed, stats: {} });
}

/**
 * Sample several solved boards and keep whichever supports the most arrows.
 * Board generation costs ~0.02ms, so this is cheap insurance against the
 * sparse layouts that random boards often produce.
 */
function pickArrowRichSolution(rng, samples) {
  let best = null;
  let bestScore = -1;
  for (let n = 0; n < Math.max(1, samples); n++) {
    const sol = generateSolution(rng);
    const options = arrowOptions(sol);
    let score = 0;
    for (let i = 0; i < CELLS; i++) if (options[i].length) score++;
    if (score > bestScore) {
      bestScore = score;
      best = sol;
    }
  }
  return best;
}

/** Place an arrow on every cell that can legally carry one. */
function maximalArrows(solution, rng) {
  const options = arrowOptions(solution);
  const arrows = new Int8Array(CELLS).fill(NO_ARROW);
  for (let i = 0; i < CELLS; i++) {
    const dirs = options[i];
    if (dirs.length) arrows[i] = dirs.length === 1 ? dirs[0] : rng.pick(dirs);
  }
  return arrows;
}

/** Assemble the public puzzle object. */
function finalise({ solution, arrows, grid, difficulty, seed, stats }) {
  const givens = [];
  let arrowCount = 0;
  let givenCount = 0;
  for (let i = 0; i < CELLS; i++) {
    givens.push(grid[i] > 0);
    if (grid[i] > 0) givenCount++;
    if (arrows[i] !== NO_ARROW) arrowCount++;
  }
  return {
    id: makePuzzleId(seed, difficulty),
    seed: String(seed),
    difficulty,
    grid, // starting position (givens only)
    arrows,
    solution,
    givens,
    stats: { ...stats, arrowCount, givenCount },
  };
}

function makePuzzleId(seed, difficulty) {
  return `${difficulty}-${String(seed).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)}`;
}

/* -------------------------------------------------------------------------
 * Serialisation - lets StorageService persist puzzles and lets a future
 * backend hand puzzles over the wire in a compact form.
 * ---------------------------------------------------------------------- */

const DIR_CHARS = 'urdl'; // matches DIR.UP/RIGHT/DOWN/LEFT ordering

/** Compact string form: "<difficulty>|<seed>|<81 digits>|<81 arrow chars>" */
export function serializePuzzle(puzzle) {
  let gridStr = '';
  let arrowStr = '';
  for (let i = 0; i < CELLS; i++) {
    gridStr += String(puzzle.grid[i] || 0);
    arrowStr += puzzle.arrows[i] === NO_ARROW ? '.' : DIR_CHARS[puzzle.arrows[i]];
  }
  let solStr = '';
  for (let i = 0; i < CELLS; i++) solStr += String(puzzle.solution[i]);
  return [puzzle.difficulty, puzzle.seed, gridStr, arrowStr, solStr].join('|');
}

export function deserializePuzzle(str) {
  const [difficulty, seed, gridStr, arrowStr, solStr] = String(str).split('|');
  if (!gridStr || gridStr.length !== CELLS) throw new Error('Malformed puzzle string');

  const grid = new Int8Array(CELLS);
  const arrows = new Int8Array(CELLS).fill(NO_ARROW);
  const solution = new Int8Array(CELLS);
  const givens = [];
  let arrowCount = 0;
  let givenCount = 0;

  for (let i = 0; i < CELLS; i++) {
    grid[i] = Number(gridStr[i]) || 0;
    givens.push(grid[i] > 0);
    if (grid[i] > 0) givenCount++;
    const ch = arrowStr[i];
    const dir = DIR_CHARS.indexOf(ch);
    arrows[i] = dir >= 0 ? dir : NO_ARROW;
    if (arrows[i] !== NO_ARROW) arrowCount++;
    solution[i] = solStr ? Number(solStr[i]) || 0 : 0;
  }

  return {
    id: makePuzzleId(seed, difficulty),
    seed,
    difficulty,
    grid,
    arrows,
    solution,
    givens,
    // Recomputed rather than carried in the string, so a restored save shows
    // the same clue counts as a freshly generated puzzle.
    stats: { arrowCount, givenCount },
  };
}

/**
 * Recover the solution for a puzzle that arrived without one (e.g. from an
 * API that withholds it). Returns null when the puzzle is not solvable.
 */
export function deriveSolution(puzzle) {
  const res = solve(puzzle.grid, puzzle.arrows, {
    limit: 1,
    compiled: compileArrows(puzzle.arrows),
  });
  return res.solution;
}

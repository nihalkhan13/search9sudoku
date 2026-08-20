/**
 * Solver.js
 * Constraint solver for Search Nine Sudoku.
 *
 * ---------------------------------------------------------------------------
 * THE RULES BEING ENFORCED
 * ---------------------------------------------------------------------------
 * 1. Normal Sudoku: every row, column and 3x3 box holds 1..9 exactly once.
 * 2. Search Nine: a cell carrying an arrow holds a digit `d`, and the digit 9
 *    of the line the arrow points along sits exactly `d` cells away in that
 *    direction.
 *      - LEFT / RIGHT arrows constrain the arrow cell's ROW.
 *      - UP / DOWN arrows constrain the arrow cell's COLUMN.
 *
 * Two useful consequences drive the propagation below:
 *   a) An arrow cell can never be 9 (the distance would be 0, not a digit).
 *   b) Because each line contains exactly one 9, an arrow pointing right from
 *      column c proves that no cell at column <= c in that row is a 9.
 *
 * ---------------------------------------------------------------------------
 * REPRESENTATION
 * ---------------------------------------------------------------------------
 * grid    : Int8Array(81), 0 = empty, else 1..9
 * arrows  : Int8Array(81), -1 = no arrow, else a DIR value
 * cands   : Uint16Array(81) of 9-bit candidate masks
 */

import {
  CELLS,
  SIZE,
  ALL_CANDIDATES,
  BIT9,
  DR,
  DC,
  DIR_IS_HORIZONTAL,
  NO_ARROW,
  PEERS,
  UNITS,
  ROW_CELLS,
  COL_CELLS,
  bit,
  popcount,
  lowestDigit,
  rowOf,
  colOf,
  indexOf,
} from './constants.js';

/**
 * Precompute, for one arrow, everything propagation needs:
 *   cell     - the arrow's own cell index
 *   dir      - DIR value
 *   reach    - mask of distances (as digit bits) that stay on the board
 *   targets  - targets[d] = cell index at distance d, or -1
 *   line     - the 9 cells of the constrained row/column
 *   dist     - dist[cellIndex] = distance from the arrow (1..8) along the
 *              pointing direction, or -1 if that cell is not reachable
 *              (behind the arrow, or off the ray entirely)
 */
export function compileArrow(cell, dir) {
  const r = rowOf(cell);
  const c = colOf(cell);
  const targets = new Int8Array(SIZE).fill(-1);
  const dist = new Int8Array(CELLS).fill(-1);
  let reach = 0;

  for (let d = 1; d <= 8; d++) {
    const rr = r + DR[dir] * d;
    const cc = c + DC[dir] * d;
    if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) break;
    const t = indexOf(rr, cc);
    targets[d] = t;
    dist[t] = d;
    reach |= bit(d);
  }

  const line = DIR_IS_HORIZONTAL[dir] ? ROW_CELLS[r] : COL_CELLS[c];
  return { cell, dir, reach, targets, dist, line };
}

/** Compile a full arrow layout into the list the solver consumes. */
export function compileArrows(arrows) {
  const list = [];
  for (let i = 0; i < CELLS; i++) {
    if (arrows[i] !== NO_ARROW && arrows[i] !== undefined && arrows[i] >= 0) {
      list.push(compileArrow(i, arrows[i]));
    }
  }
  return list;
}

/**
 * Reduce candidate sets until a fixpoint. Mutates `cands`.
 * @returns {boolean} false when a contradiction is found.
 */
function propagate(cands, arrowList) {
  let changed = true;
  while (changed) {
    changed = false;

    // --- Naked singles: a solved cell removes its digit from all peers ---
    for (let i = 0; i < CELLS; i++) {
      const m = cands[i];
      if (m === 0) return false;
      if ((m & (m - 1)) !== 0) continue; // more than one candidate
      const peers = PEERS[i];
      for (let k = 0; k < peers.length; k++) {
        const p = peers[k];
        if (cands[p] & m) {
          cands[p] &= ~m;
          if (cands[p] === 0) return false;
          changed = true;
        }
      }
    }

    // --- Hidden singles: a digit with only one home in a unit ---
    for (let u = 0; u < UNITS.length; u++) {
      const unit = UNITS[u];
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        let count = 0;
        let pos = -1;
        for (let k = 0; k < SIZE; k++) {
          if (cands[unit[k]] & b) {
            count++;
            pos = unit[k];
          }
        }
        if (count === 0) return false;
        if (count === 1 && cands[pos] !== b) {
          cands[pos] = b;
          changed = true;
        }
      }
    }

    // --- Search Nine arrow constraints (bidirectional) ---
    for (let a = 0; a < arrowList.length; a++) {
      const arrow = arrowList[a];

      // Forward: the arrow's own digit is limited to distances where the
      // target cell could still hold a 9.
      let allowed = 0;
      for (let d = 1; d <= 8; d++) {
        const t = arrow.targets[d];
        if (t < 0) break;
        if (cands[t] & BIT9) allowed |= bit(d);
      }
      const nc = cands[arrow.cell] & allowed;
      if (nc === 0) return false;
      if (nc !== cands[arrow.cell]) {
        cands[arrow.cell] = nc;
        changed = true;
      }

      // Backward: on the constrained line, only cells at a still-possible
      // distance may hold the 9. Everything else (including cells behind the
      // arrow and the arrow cell itself) loses its 9.
      const line = arrow.line;
      for (let k = 0; k < SIZE; k++) {
        const t = line[k];
        if (!(cands[t] & BIT9)) continue;
        const d = arrow.dist[t];
        if (d < 0 || !(nc & bit(d))) {
          cands[t] &= ~BIT9;
          if (cands[t] === 0) return false;
          changed = true;
        }
      }
    }
  }
  return true;
}

/** Seed candidate masks from a partially filled grid. */
function initCandidates(grid) {
  const cands = new Uint16Array(CELLS).fill(ALL_CANDIDATES);
  for (let i = 0; i < CELLS; i++) {
    const v = grid[i];
    if (v > 0) cands[i] = bit(v);
  }
  return cands;
}

function extract(cands) {
  const out = new Int8Array(CELLS);
  for (let i = 0; i < CELLS; i++) out[i] = lowestDigit(cands[i]);
  return out;
}

/**
 * Count solutions (up to `limit`) of a Search Nine puzzle.
 *
 * @param {Int8Array} grid   given digits, 0 for empty
 * @param {Int8Array} arrows arrow layout (-1 for none)
 * @param {object}    opts
 * @param {number}    opts.limit    stop after this many solutions (default 2 -
 *                                  enough to answer "is it unique?")
 * @param {number}    opts.maxNodes safety valve against pathological searches
 * @param {Array}     opts.compiled pre-compiled arrow list (perf optimisation)
 * @returns {{count:number, solution:Int8Array|null, exhausted:boolean}}
 *          `exhausted` is true when the node budget ran out, meaning `count`
 *          is a lower bound rather than the truth.
 */
export function solve(grid, arrows, opts = {}) {
  const limit = opts.limit ?? 2;
  const maxNodes = opts.maxNodes ?? 300000;
  const arrowList = opts.compiled ?? compileArrows(arrows);

  const state = { count: 0, solution: null, nodes: 0, exhausted: false };

  const search = (cands) => {
    if (state.count >= limit || state.exhausted) return;
    if (++state.nodes > maxNodes) {
      state.exhausted = true;
      return;
    }
    if (!propagate(cands, arrowList)) return;

    // Pick the most constrained unsolved cell.
    let best = -1;
    let bestCount = 10;
    for (let i = 0; i < CELLS; i++) {
      const n = popcount(cands[i]);
      if (n > 1 && n < bestCount) {
        bestCount = n;
        best = i;
        if (n === 2) break;
      }
    }

    if (best === -1) {
      state.count++;
      if (!state.solution) state.solution = extract(cands);
      return;
    }

    for (let d = 1; d <= 9; d++) {
      const b = bit(d);
      if (!(cands[best] & b)) continue;
      const branch = cands.slice();
      branch[best] = b;
      search(branch);
      if (state.count >= limit || state.exhausted) return;
    }
  };

  search(initCandidates(grid));
  return { count: state.count, solution: state.solution, exhausted: state.exhausted };
}

/** Convenience: does this puzzle have exactly one solution? */
export function hasUniqueSolution(grid, arrows, opts = {}) {
  const res = solve(grid, arrows, { ...opts, limit: 2 });
  return !res.exhausted && res.count === 1;
}

/* ==========================================================================
 * Validation helpers used by the UI's "check" feature
 * ========================================================================== */

/**
 * Find every cell involved in a broken rule.
 *
 * Only *complete* information is judged: an arrow whose target cell is still
 * empty is not reported, so partial progress never shows a false error.
 *
 * @param {Int8Array} grid
 * @param {Int8Array} arrows
 * @returns {{cells:Set<number>, sudoku:Set<number>, arrows:Set<number>}}
 */
export function findConflicts(grid, arrows) {
  const sudoku = new Set();
  const arrowErrors = new Set();

  // Duplicate digits inside a unit.
  for (const unit of UNITS) {
    const seen = new Map();
    for (const c of unit) {
      const v = grid[c];
      if (!v) continue;
      if (seen.has(v)) {
        sudoku.add(c);
        sudoku.add(seen.get(v));
      } else {
        seen.set(v, c);
      }
    }
  }

  // Arrow distance violations.
  for (let i = 0; i < CELLS; i++) {
    const dir = arrows[i];
    if (dir === NO_ARROW || dir < 0) continue;
    const v = grid[i];
    if (!v) continue;

    const r = rowOf(i);
    const c = colOf(i);
    const rr = r + DR[dir] * v;
    const cc = c + DC[dir] * v;

    // Pointing off the board is always wrong, even with the line unfinished.
    if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) {
      arrowErrors.add(i);
      continue;
    }

    const target = grid[indexOf(rr, cc)];
    if (target === 0) continue; // not enough information yet
    if (target !== 9) arrowErrors.add(i);
  }

  const cells = new Set([...sudoku, ...arrowErrors]);
  return { cells, sudoku, arrows: arrowErrors };
}

/** True when the grid is completely filled and breaks no rule. */
export function isSolved(grid, arrows) {
  for (let i = 0; i < CELLS; i++) if (!grid[i]) return false;
  return findConflicts(grid, arrows).cells.size === 0;
}

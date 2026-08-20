/**
 * constants.js
 * Shared grid geometry, bitmask helpers and direction tables.
 *
 * Digits are stored as 1..9. Candidate sets are stored as 9-bit masks where
 * bit (d - 1) means "digit d is still possible".
 */

export const SIZE = 9;
export const CELLS = SIZE * SIZE; // 81
export const ALL_CANDIDATES = 0x1ff; // digits 1..9 all possible

/** Arrow directions. Index into DR/DC. */
export const DIR = Object.freeze({ UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 });
export const DIR_NAMES = Object.freeze(['up', 'right', 'down', 'left']);
export const NO_ARROW = -1;

/** Row delta / column delta per direction. */
export const DR = Object.freeze([-1, 0, 1, 0]);
export const DC = Object.freeze([0, 1, 0, -1]);

/** True when the arrow constrains its row (left/right) rather than its column. */
export const DIR_IS_HORIZONTAL = Object.freeze([false, true, false, true]);

export const rowOf = (i) => (i / SIZE) | 0;
export const colOf = (i) => i % SIZE;
export const boxOf = (i) => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);
export const indexOf = (r, c) => r * SIZE + c;

export const bit = (digit) => 1 << (digit - 1);
export const BIT9 = bit(9);

/** Number of set bits in a 9-bit candidate mask. */
export function popcount(mask) {
  let n = 0;
  while (mask) {
    mask &= mask - 1;
    n++;
  }
  return n;
}

/** Lowest digit (1..9) present in a mask, or 0 when the mask is empty. */
export function lowestDigit(mask) {
  if (!mask) return 0;
  return 32 - Math.clz32(mask & -mask);
}

/** Expand a candidate mask into an array of digits. */
export function maskToDigits(mask) {
  const out = [];
  for (let d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d);
  return out;
}

/** The 27 units: 9 rows, 9 columns, 9 boxes. Each is an array of cell indices. */
export const UNITS = (() => {
  const units = [];
  for (let r = 0; r < SIZE; r++) {
    const u = [];
    for (let c = 0; c < SIZE; c++) u.push(indexOf(r, c));
    units.push(u);
  }
  for (let c = 0; c < SIZE; c++) {
    const u = [];
    for (let r = 0; r < SIZE; r++) u.push(indexOf(r, c));
    units.push(u);
  }
  for (let b = 0; b < SIZE; b++) {
    const u = [];
    const r0 = ((b / 3) | 0) * 3;
    const c0 = (b % 3) * 3;
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) u.push(indexOf(r0 + dr, c0 + dc));
    }
    units.push(u);
  }
  return units.map(Object.freeze);
})();

/** ROW_CELLS[r] / COL_CELLS[c] convenience views onto UNITS. */
export const ROW_CELLS = UNITS.slice(0, 9);
export const COL_CELLS = UNITS.slice(9, 18);

/** PEERS[i] = the 20 cells sharing a row, column or box with cell i. */
export const PEERS = (() => {
  const peers = [];
  for (let i = 0; i < CELLS; i++) {
    const set = new Set();
    for (const u of UNITS) {
      if (u.includes(i)) for (const c of u) if (c !== i) set.add(c);
    }
    peers.push(Int32Array.from(set));
  }
  return peers;
})();

/** UNITS_OF[i] = the three units containing cell i. */
export const UNITS_OF = (() => {
  const out = [];
  for (let i = 0; i < CELLS; i++) out.push(UNITS.filter((u) => u.includes(i)));
  return out;
})();

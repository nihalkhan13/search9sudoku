/**
 * GameEngine.js
 * Owns the board state for one play session: entered digits, pencil marks,
 * cell colours, undo/redo history and rule checking.
 *
 * The engine knows nothing about the DOM. It emits 'change' events and the
 * UIController re-renders in response. That split is what will let the same
 * engine run server-side later (e.g. to validate a leaderboard submission
 * without trusting the client).
 */

import { CELLS, NO_ARROW, bit, maskToDigits } from './constants.js';
import { findConflicts, isSolved } from './Solver.js';
import { DIFFICULTY } from './Generator.js';

/** Entry modes, mirroring the numpad's mode buttons. */
export const MODE = Object.freeze({
  NORMAL: 'normal',
  CORNER: 'corner',
  CENTER: 'center',
  COLOR: 'color',
});

const MAX_HISTORY = 400;

export class GameEngine {
  constructor() {
    /** @type {object|null} the active puzzle definition */
    this.puzzle = null;

    // --- player state ---
    this.values = new Int8Array(CELLS);
    this.corner = new Uint16Array(CELLS); // 9-bit masks
    this.center = new Uint16Array(CELLS);
    this.colors = new Uint16Array(CELLS); // bitmask over the palette

    this.givens = new Uint8Array(CELLS);
    this.arrows = new Int8Array(CELLS).fill(NO_ARROW);

    this.history = [];
    this.future = [];

    this.autoCleanMarks = true;

    this._listeners = new Map();
  }

  /* ---------------------------------------------------------------- events */

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event).delete(fn);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (set) for (const fn of set) fn(payload);
  }

  /* ---------------------------------------------------------------- loading */

  /**
   * Install a puzzle. Optionally restore previously saved player progress.
   * @param {object} puzzle from Generator/ApiService
   * @param {object|null} savedState from StorageService
   */
  loadPuzzle(puzzle, savedState = null) {
    this.puzzle = puzzle;
    this.arrows = puzzle.arrows;
    this.values = new Int8Array(CELLS);
    this.corner = new Uint16Array(CELLS);
    this.center = new Uint16Array(CELLS);
    this.colors = new Uint16Array(CELLS);
    this.givens = new Uint8Array(CELLS);

    for (let i = 0; i < CELLS; i++) {
      if (puzzle.grid[i] > 0) {
        this.values[i] = puzzle.grid[i];
        this.givens[i] = 1;
      }
    }

    this.history = [];
    this.future = [];

    if (savedState) this.applyState(savedState);
    this.emit('change', { reason: 'load' });
    return this;
  }

  get difficultyLabel() {
    return DIFFICULTY[this.puzzle?.difficulty]?.label ?? 'Custom';
  }

  isGiven(i) {
    return this.givens[i] === 1;
  }

  /* --------------------------------------------------------------- history */

  snapshot() {
    return {
      values: Int8Array.from(this.values),
      corner: Uint16Array.from(this.corner),
      center: Uint16Array.from(this.center),
      colors: Uint16Array.from(this.colors),
    };
  }

  restore(snap) {
    this.values = Int8Array.from(snap.values);
    this.corner = Uint16Array.from(snap.corner);
    this.center = Uint16Array.from(snap.center);
    this.colors = Uint16Array.from(snap.colors);
  }

  /** Run `fn`, recording an undo point only if it actually changed something. */
  _transaction(fn) {
    const before = this.snapshot();
    fn();
    if (!this._differs(before)) return false;

    this.history.push(before);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.future.length = 0;
    this.emit('change', { reason: 'move' });
    return true;
  }

  _differs(snap) {
    for (let i = 0; i < CELLS; i++) {
      if (snap.values[i] !== this.values[i]) return true;
      if (snap.corner[i] !== this.corner[i]) return true;
      if (snap.center[i] !== this.center[i]) return true;
      if (snap.colors[i] !== this.colors[i]) return true;
    }
    return false;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    if (!this.canUndo) return false;
    this.future.push(this.snapshot());
    this.restore(this.history.pop());
    this.emit('change', { reason: 'undo' });
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.history.push(this.snapshot());
    this.restore(this.future.pop());
    this.emit('change', { reason: 'redo' });
    return true;
  }

  /* ------------------------------------------------------------ input verbs */

  /** Editable = part of the selection that is not a clue. */
  _editable(cells) {
    return [...cells].filter((i) => !this.givens[i]);
  }

  /**
   * Apply a digit press.
   * @param {Iterable<number>} cells selected cell indices
   * @param {number} digit 1..9
   * @param {string} mode MODE value
   */
  enterDigit(cells, digit, mode = MODE.NORMAL) {
    // Colour is handled first: unlike digits and pencil marks it applies to
    // clue cells too, so it must not go through the editable-only filter.
    // Digit 1 maps to palette index 0, matching the swatch on the button.
    if (mode === MODE.COLOR) return this.applyColor(cells, digit - 1);

    const targets = this._editable(cells);
    if (!targets.length) return false;

    return this._transaction(() => {
      if (mode === MODE.NORMAL) {
        // Pressing the digit already shown clears it, so one key toggles.
        const allSame = targets.every((i) => this.values[i] === digit);
        for (const i of targets) {
          if (allSame) {
            this.values[i] = 0;
          } else {
            this.values[i] = digit;
            this.corner[i] = 0;
            this.center[i] = 0;
          }
        }
        if (!allSame && this.autoCleanMarks) {
          for (const i of targets) this._cleanPeerMarks(i, digit);
        }
      } else if (mode === MODE.CORNER || mode === MODE.CENTER) {
        const store = mode === MODE.CORNER ? this.corner : this.center;
        const b = bit(digit);
        // Only cells without a final digit can hold pencil marks.
        const markable = targets.filter((i) => !this.values[i]);
        if (!markable.length) return;
        const allSet = markable.every((i) => store[i] & b);
        for (const i of markable) {
          if (allSet) store[i] &= ~b;
          else store[i] |= b;
        }
      }
    });
  }

  /** Remove `digit` from the pencil marks of every peer of cell `i`. */
  _cleanPeerMarks(i, digit) {
    const b = bit(digit);
    // PEERS is imported indirectly through Solver's constants; re-derive here
    // to keep the engine's dependency surface small.
    const r = (i / 9) | 0;
    const c = i % 9;
    const seen = new Set();
    for (let k = 0; k < 9; k++) {
      seen.add(r * 9 + k);
      seen.add(k * 9 + c);
    }
    const r0 = ((r / 3) | 0) * 3;
    const c0 = ((c / 3) | 0) * 3;
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) seen.add((r0 + dr) * 9 + c0 + dc);
    }
    for (const p of seen) {
      if (p === i) continue;
      this.corner[p] &= ~b;
      this.center[p] &= ~b;
    }
  }

  /**
   * Apply one palette colour to the selection. Colours apply to given cells
   * too - they are a solver aid, not an answer. A tile has one active colour:
   * choosing a new swatch replaces the previous one, while choosing the
   * current swatch again clears it.
   */
  applyColor(cells, colorIndex) {
    const targets = [...cells];
    if (!targets.length || colorIndex < 0) return false;
    const b = 1 << colorIndex;
    return this._transaction(() => {
      // Keep the interaction predictable for single cells and multi-selects:
      // clicking the active colour clears it; any other click replaces it.
      const allOnlyThis = targets.every((i) => this.colors[i] === b);
      for (const i of targets) {
        this.colors[i] = allOnlyThis ? 0 : b;
      }
    });
  }

  /**
   * Backspace / Delete. In colour mode it wipes colours; otherwise it wipes
   * the digit if there is one, else the pencil marks.
   */
  clear(cells, mode = MODE.NORMAL) {
    const targets = [...cells];
    if (!targets.length) return false;

    return this._transaction(() => {
      if (mode === MODE.COLOR) {
        for (const i of targets) this.colors[i] = 0;
        return;
      }
      const editable = this._editable(targets);
      const anyValue = editable.some((i) => this.values[i]);
      for (const i of editable) {
        if (anyValue) {
          this.values[i] = 0;
        } else {
          this.corner[i] = 0;
          this.center[i] = 0;
        }
      }
    });
  }

  /** Wipe all progress, keeping the puzzle's clues. */
  resetBoard() {
    return this._transaction(() => {
      for (let i = 0; i < CELLS; i++) {
        if (!this.givens[i]) this.values[i] = 0;
        this.corner[i] = 0;
        this.center[i] = 0;
        this.colors[i] = 0;
      }
    });
  }

  /* ------------------------------------------------------------- inspection */

  cornerDigits(i) {
    return maskToDigits(this.corner[i]);
  }

  centerDigits(i) {
    return maskToDigits(this.center[i]);
  }

  colorList(i) {
    const out = [];
    for (let k = 0; k < 16; k++) if (this.colors[i] & (1 << k)) out.push(k);
    return out;
  }

  /** Cells that break a rule right now. See Solver.findConflicts. */
  getConflicts() {
    return findConflicts(this.values, this.arrows);
  }

  /** Every cell filled and no rule broken. */
  isComplete() {
    return isSolved(this.values, this.arrows);
  }

  /** How many cells still need a digit. */
  remainingCells() {
    let n = 0;
    for (let i = 0; i < CELLS; i++) if (!this.values[i]) n++;
    return n;
  }

  /**
   * Compare against the stored solution.
   * @returns {{complete:boolean, wrong:number[], filled:number}}
   */
  checkAgainstSolution() {
    const wrong = [];
    let filled = 0;
    const sol = this.puzzle?.solution;
    for (let i = 0; i < CELLS; i++) {
      if (!this.values[i]) continue;
      filled++;
      if (sol && sol[i] && this.values[i] !== sol[i]) wrong.push(i);
    }
    return { complete: filled === CELLS && wrong.length === 0, wrong, filled };
  }

  /* ---------------------------------------------------------- serialisation */

  /** Plain-JSON player state for StorageService / a future save API. */
  serializeState() {
    return {
      values: Array.from(this.values),
      corner: Array.from(this.corner),
      center: Array.from(this.center),
      colors: Array.from(this.colors),
    };
  }

  applyState(state) {
    if (!state) return;
    const copy = (src, dst) => {
      if (!src) return;
      for (let i = 0; i < CELLS && i < src.length; i++) dst[i] = src[i];
    };
    copy(state.values, this.values);
    copy(state.corner, this.corner);
    copy(state.center, this.center);
    copy(state.colors, this.colors);
    // Givens are authoritative - never let a stale save overwrite a clue.
    for (let i = 0; i < CELLS; i++) {
      if (this.givens[i]) this.values[i] = this.puzzle.grid[i];
    }
  }
}

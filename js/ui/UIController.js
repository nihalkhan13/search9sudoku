/**
 * UIController.js
 * Renders the grid and control panel, and translates every user gesture
 * (mouse, touch, keyboard) into GameEngine calls.
 *
 * The renderer is deliberately dumb: `render()` pushes the whole engine state
 * onto 81 pre-built cell nodes. At this size that is far cheaper than any
 * diffing scheme, and it removes a whole class of stale-view bugs.
 */

import { CELLS, SIZE, NO_ARROW, rowOf, colOf, indexOf } from '../core/constants.js';
import { MODE } from '../core/GameEngine.js';
import { COUNTRIES, DEFAULT_COUNTRY, US_STATES } from '../core/locations.js';
import { formatTime } from './Timer.js';

/** Palette for the colour tool - index matches numpad keys 1..9. */
export const PALETTE = [
  '#f8f9fa', '#c9d1d9', '#8d99ae', '#f4978e', '#ffd166',
  '#a8dadc', '#8ecae6', '#b8bedd', '#c8b6e2',
];

const ARROW_PATH = 'M50 6 L92 48 L68 48 L68 94 L32 94 L32 48 L8 48 Z';

export class UIController {
  /**
   * @param {import('../core/GameEngine.js').GameEngine} engine
   * @param {object} deps  { timer, storage, settings, actions }
   */
  constructor(engine, deps) {
    this.engine = engine;
    this.timer = deps.timer;
    this.storage = deps.storage;
    this.settings = deps.settings;
    this.actions = deps.actions; // { newPuzzle, dailyPuzzle, restart, check, ... }

    this.mode = MODE.NORMAL;
    this.selection = new Set();
    this.cursor = 40; // centre cell, drives keyboard navigation
    this.dragging = false;
    this.dragAdditive = false;
    this.cells = [];
    this.showErrors = false; // set by "Check", cleared on the next edit

    this._cacheDom();
    this._populateLocationChoices();
    this._buildGrid();
    this._bindGrid();
    this._bindControls();
    this._bindKeyboard();
    this._bindTheme();

    this.engine.on('change', ({ reason }) => {
      if (reason === 'move') this.showErrors = false;
      this.render();
    });
  }

  /* ------------------------------------------------------------------ setup */

  _cacheDom() {
    const $ = (id) => document.getElementById(id);
    this.dom = {
      grid: $('grid'),
      gridLines: $('grid-lines'),
      boardWrap: $('board-wrap'),
      title: $('puzzle-title'),
      author: $('puzzle-author'),
      rules: $('rules-text'),
      timer: $('timer-display'),
      timerToggle: $('btn-timer-toggle'),
      status: $('status-line'),
      difficulty: $('difficulty-select'),
      undo: $('btn-undo'),
      redo: $('btn-redo'),
      modeButtons: [...document.querySelectorAll('[data-mode]')],
      digitButtons: [...document.querySelectorAll('[data-digit]')],
      themeBtn: $('btn-theme'),
      colorsBtn: $('btn-colors'),
      statSolved: $('stat-solved'),
      statBest: $('stat-best'),
      statStreak: $('stat-streak'),
      statArrows: $('stat-arrows'),
      statChecks: $('stat-checks'),
      roundChecks: $('round-checks'),
      userBadge: $('user-badge'),
      userButton: $('btn-user'),
      leaderboardButton: $('btn-leaderboard'),
      authForm: $('auth-form'),
      authUsername: $('auth-username'),
      authPassword: $('auth-password'),
      authCountry: $('auth-country'),
      authState: $('auth-state'),
      authStateField: $('auth-state-field'),
      authError: $('auth-error'),
      profileCountry: $('profile-country'),
      profileState: $('profile-state'),
      profileStateField: $('profile-state-field'),
      profileEditFields: $('profile-edit-fields'),
      profileError: $('profile-error'),
      editProfileButton: $('btn-edit-profile'),
      leaderboardBody: $('leaderboard-body'),
      leaderboardMeta: $('leaderboard-meta'),
      friendUsername: $('friend-username'),
      friendStatus: $('friend-status'),
      overlay: $('overlay'),
      overlayText: $('overlay-text'),
      toast: $('toast'),
    };
  }

  /** Build the 81 cell nodes once; render() only mutates their contents. */
  _buildGrid() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < CELLS; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.i = String(i);
      cell.setAttribute('role', 'gridcell');

      const colors = document.createElement('div');
      colors.className = 'cell-colors';

      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      arrow.setAttribute('class', 'cell-arrow');
      arrow.setAttribute('viewBox', '0 0 100 100');
      arrow.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', ARROW_PATH);
      arrow.appendChild(path);

      const value = document.createElement('div');
      value.className = 'cell-value';

      const center = document.createElement('div');
      center.className = 'cell-center';

      const corner = document.createElement('div');
      corner.className = 'cell-corner';
      for (let k = 0; k < 8; k++) corner.appendChild(document.createElement('span'));

      cell.append(colors, arrow, corner, center, value);
      frag.appendChild(cell);
      this.cells.push({ root: cell, colors, arrow, value, center, corner });
    }
    this.dom.grid.appendChild(frag);
    this._drawGridLines();
  }

  /**
   * Grid lines live in an SVG overlay rather than on cell borders, so every
   * cell stays exactly the same size no matter how thick the box lines are.
   */
  _drawGridLines() {
    const svg = this.dom.gridLines;
    svg.setAttribute('viewBox', '0 0 900 900');
    svg.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    for (let i = 0; i <= SIZE; i++) {
      const thick = i % 3 === 0;
      const w = thick ? 7 : 2;
      const p = i * 100;
      // clamp the outer lines so their stroke stays inside the viewBox
      const pos = i === 0 ? w / 2 : i === SIZE ? 900 - w / 2 : p;
      for (const vertical of [true, false]) {
        const line = document.createElementNS(ns, 'line');
        line.setAttribute(vertical ? 'x1' : 'y1', pos);
        line.setAttribute(vertical ? 'x2' : 'y2', pos);
        line.setAttribute(vertical ? 'y1' : 'x1', 0);
        line.setAttribute(vertical ? 'y2' : 'x2', 900);
        line.setAttribute('class', thick ? 'gl gl-thick' : 'gl gl-thin');
        line.setAttribute('stroke-width', w);
        svg.appendChild(line);
      }
    }
  }

  /* ------------------------------------------------------- pointer handling */

  _cellFromEvent(e) {
    const point = e.touches?.[0] ?? e.changedTouches?.[0] ?? e;
    const el = document.elementFromPoint(point.clientX, point.clientY);
    const cell = el?.closest?.('.cell');
    return cell ? Number(cell.dataset.i) : -1;
  }

  _bindGrid() {
    const grid = this.dom.grid;

    const begin = (e) => {
      const i = this._cellFromEvent(e);
      if (i < 0) return;
      e.preventDefault();
      this.dragging = true;

      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!additive) this.selection.clear();
      // Ctrl/Cmd on an already-selected cell removes it.
      if ((e.ctrlKey || e.metaKey) && this.selection.has(i)) {
        this.selection.delete(i);
        this.dragAdditive = false;
      } else {
        this.selection.add(i);
        this.dragAdditive = true;
      }
      this.cursor = i;
      this.render();
    };

    const extend = (e) => {
      if (!this.dragging) return;
      const i = this._cellFromEvent(e);
      if (i < 0) return;
      e.preventDefault();
      if (this.dragAdditive) {
        if (this.selection.has(i)) return;
        this.selection.add(i);
      } else {
        if (!this.selection.has(i)) return;
        this.selection.delete(i);
      }
      this.cursor = i;
      this.render();
    };

    const end = () => {
      this.dragging = false;
    };

    grid.addEventListener('mousedown', begin);
    grid.addEventListener('mousemove', extend);
    window.addEventListener('mouseup', end);

    grid.addEventListener('touchstart', begin, { passive: false });
    grid.addEventListener('touchmove', extend, { passive: false });
    window.addEventListener('touchend', end);

    // Clicking the page outside the board and controls clears the selection.
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('#board-wrap') || e.target.closest('.control-pane')) return;
      if (this.selection.size) {
        this.selection.clear();
        this.render();
      }
    });
  }

  /* ---------------------------------------------------------- control panel */

  _bindControls() {
    const on = (id, fn, event = 'click') => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, fn);
    };

    // Buttons give focus back after a click, otherwise Space/Enter would
    // re-fire the last button instead of reaching the grid shortcuts.
    for (const btn of document.querySelectorAll('.num-btn, .mode-btn, .pill-btn, .icon-btn')) {
      btn.addEventListener('click', () => btn.blur());
    }

    for (const btn of this.dom.digitButtons) {
      btn.addEventListener('click', () => this.pressDigit(Number(btn.dataset.digit)));
      // Hovering a digit previews where it already sits on the board.
      btn.addEventListener('mouseenter', () => {
        this.hoverDigit = Number(btn.dataset.digit);
        this.render();
      });
      btn.addEventListener('mouseleave', () => {
        this.hoverDigit = null;
        this.render();
      });
    }

    for (const btn of this.dom.modeButtons) {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    }

    on('btn-delete', () => this.engine.clear(this.selection, this.mode));
    on('btn-undo', () => this.engine.undo());
    on('btn-redo', () => this.engine.redo());
    on('btn-check', () => this.checkSolution());
    on('btn-restart', () => this.actions.restart());
    on('btn-new', () => this.actions.newPuzzle(this.dom.difficulty.value));
    on('btn-daily', () => this.actions.dailyPuzzle());
    on('btn-share', () => this.actions.share());
    on('btn-timer-toggle', () => {
      this.timer.toggle();
      this.render();
    });
    on('btn-fullscreen', () => this.toggleFullscreen());
    on('btn-rules', () => this.openDialog('dialog-rules'));
    on('btn-settings', () => this.openDialog('dialog-settings'));
    on('btn-stats', () => this.actions.openStats());
    on('btn-user', () => this.openDialog('dialog-auth'));
    on('btn-leaderboard', () => {
      this.openDialog('dialog-leaderboard');
      this.actions.openLeaderboard?.('global');
    });

    on('btn-auth-login', () => this._submitAuth('login'));
    on('btn-auth-register', () => this._submitAuth('register'));
    on('btn-auth-guest', () => this._runAuthAction('guest'));
    on('btn-auth-logout', () => this._runAuthAction('logout'));
    on('btn-edit-profile', () => {
      if (this.dom.profileEditFields) this.dom.profileEditFields.hidden = false;
      if (this.dom.editProfileButton) this.dom.editProfileButton.hidden = true;
      this._setLocationControls(this.dom.profileCountry, this.dom.profileState, this.dom.profileStateField, this._profileUser ?? {});
    });
    on('btn-cancel-profile', () => this._closeProfileEditor());
    on('btn-save-profile', () => this._submitProfile());
    this.dom.authCountry?.addEventListener('change', () => this._toggleStateField(this.dom.authCountry, this.dom.authState, this.dom.authStateField));
    this.dom.profileCountry?.addEventListener('change', () => this._toggleStateField(this.dom.profileCountry, this.dom.profileState, this.dom.profileStateField));
    for (const btn of document.querySelectorAll('[data-leaderboard-scope]')) {
      btn.addEventListener('click', () => {
        for (const other of document.querySelectorAll('[data-leaderboard-scope]')) other.classList.toggle('is-active', other === btn);
        this.actions.openLeaderboard?.(btn.dataset.leaderboardScope);
      });
    }
    on('btn-add-friend', () => this.actions.addFriend?.(this.dom.friendUsername?.value));

    // Settings checkboxes are declared in HTML with data-setting keys.
    for (const input of document.querySelectorAll('[data-setting]')) {
      const key = input.dataset.setting;
      input.checked = Boolean(this.settings[key]);
      input.addEventListener('change', () => {
        this.settings[key] = input.checked;
        this.engine.autoCleanMarks = this.settings.autoCleanMarks;
        this.storage.saveSettings(this.settings);
        // Ticking "Dark mode" is an explicit choice, so it also stops the
        // page following the OS from here on.
        if (key === 'darkMode') this.applyTheme();
        this.render();
      });
    }

    for (const btn of document.querySelectorAll('[data-close-dialog]')) {
      btn.addEventListener('click', () => btn.closest('dialog')?.close());
    }
  }

  _populateLocationChoices() {
    const fillCountries = (select) => {
      if (!select) return;
      select.replaceChildren(...COUNTRIES.map(({ label, value }) => new Option(label, value)));
      select.value = DEFAULT_COUNTRY;
    };
    const fillStates = (select) => {
      if (!select) return;
      select.replaceChildren(new Option('Select a state', ''));
      select.append(...US_STATES.map(({ label, value }) => new Option(label, value)));
    };
    fillCountries(this.dom.authCountry);
    fillCountries(this.dom.profileCountry);
    fillStates(this.dom.authState);
    fillStates(this.dom.profileState);
    this._toggleStateField(this.dom.authCountry, this.dom.authState, this.dom.authStateField);
    this._toggleStateField(this.dom.profileCountry, this.dom.profileState, this.dom.profileStateField);
  }

  _toggleStateField(countrySelect, stateSelect, stateField) {
    const isUs = countrySelect?.value === DEFAULT_COUNTRY;
    if (stateField) stateField.hidden = !isUs;
    if (stateSelect) {
      stateSelect.disabled = !isUs;
      if (!isUs) stateSelect.value = '';
    }
  }

  _setLocationControls(countrySelect, stateSelect, stateField, user = {}) {
    if (!countrySelect) return;
    countrySelect.value = user.country ?? DEFAULT_COUNTRY;
    this._toggleStateField(countrySelect, stateSelect, stateField);
    if (stateSelect) stateSelect.value = user.state ?? '';
  }

  _closeProfileEditor() {
    if (this.dom.profileEditFields) this.dom.profileEditFields.hidden = true;
    if (this.dom.editProfileButton) this.dom.editProfileButton.hidden = false;
    if (this.dom.profileError) this.dom.profileError.textContent = '';
  }

  /* ----------------------------------------------------------------- theme */

  /**
   * Resolve the effective theme. `darkMode` is deliberately tri-state:
   * null means "whatever the OS says", true/false is an explicit choice that
   * survives the OS flipping later.
   */
  get isDark() {
    if (typeof this.settings.darkMode === 'boolean') return this.settings.darkMode;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }

  applyTheme() {
    const dark = this.isDark;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    // Keep the mobile browser chrome in step with the page.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#15131b' : '#7b1240');

    this.dom.themeBtn?.setAttribute('aria-pressed', String(dark));
    this.dom.themeBtn?.setAttribute('title', dark ? 'Switch to light mode' : 'Switch to dark mode');
    const box = document.querySelector('[data-setting="darkMode"]');
    if (box) box.checked = dark;
  }

  toggleTheme() {
    this.settings.darkMode = !this.isDark;
    this.storage.saveSettings(this.settings);
    this.applyTheme();
    this.flash(this.isDark ? 'Dark mode on' : 'Light mode on', 'neutral', 1400);
  }

  /** Show/hide applied cell colours. The colours themselves are untouched. */
  toggleCellColors() {
    this.settings.showCellColors = !this.settings.showCellColors;
    this.storage.saveSettings(this.settings);
    const box = document.querySelector('[data-setting="showCellColors"]');
    if (box) box.checked = this.settings.showCellColors;
    this.render();
    this.flash(this.settings.showCellColors ? 'Cell colours shown' : 'Cell colours hidden', 'neutral', 1400);
  }

  _bindTheme() {
    this.dom.themeBtn?.addEventListener('click', () => this.toggleTheme());
    this.dom.colorsBtn?.addEventListener('click', () => this.toggleCellColors());

    // Follow the OS only while the player has not made an explicit choice.
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (this.settings.darkMode === null || this.settings.darkMode === undefined) {
        this.applyTheme();
      }
    });

    this.applyTheme();
  }

  openDialog(id) {
    const dlg = document.getElementById(id);
    if (dlg && !dlg.open) dlg.showModal();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }

  /* -------------------------------------------------------------- keyboard */

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Let form controls keep their own keys. `matches` is guarded because
      // an event can be targeted at document/window, which do not have it.
      if (e.target?.matches?.('input, select, textarea')) return;
      if (document.querySelector('dialog[open]')) return;

      const mod = e.ctrlKey || e.metaKey;

      // Undo / redo
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.engine.redo();
        else this.engine.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.engine.redo();
        return;
      }

      // Digits. Shift -> corner marks, Ctrl/Cmd -> centre marks, matching
      // the muscle memory of other competitive Sudoku apps.
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        let mode = this.mode;
        if (e.shiftKey) mode = MODE.CORNER;
        else if (mod) mode = MODE.CENTER;
        this.pressDigit(Number(e.key), mode);
        return;
      }

      switch (e.key) {
        case 'Backspace':
        case 'Delete':
          e.preventDefault();
          this.engine.clear(this.selection, this.mode);
          return;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          this._moveCursor(e.key, e.shiftKey);
          return;
        case 'Escape':
          this.selection.clear();
          this.render();
          return;
        case ' ':
          e.preventDefault();
          this._cycleMode();
          return;
        default:
          break;
      }

      const map = { z: MODE.NORMAL, x: MODE.CORNER, c: MODE.CENTER, v: MODE.COLOR };
      const key = e.key.toLowerCase();
      if (!mod && map[key]) {
        e.preventDefault();
        this.setMode(map[key]);
        return;
      }
      if (!mod && key === 'h') {
        e.preventDefault();
        this.toggleCellColors();
        return;
      }
      if (!mod && key === 'd') {
        e.preventDefault();
        this.toggleTheme();
      }
    });
  }

  _moveCursor(key, extend) {
    const dr = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
    const dc = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
    // Wrap around the edges - quicker than stopping dead at the border.
    const r = (rowOf(this.cursor) + dr + SIZE) % SIZE;
    const c = (colOf(this.cursor) + dc + SIZE) % SIZE;
    this.cursor = indexOf(r, c);
    if (!extend) this.selection.clear();
    this.selection.add(this.cursor);
    this.render();
  }

  _cycleMode() {
    const order = [MODE.NORMAL, MODE.CORNER, MODE.CENTER, MODE.COLOR];
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
  }

  /* ----------------------------------------------------------------- verbs */

  setMode(mode) {
    this.mode = mode;
    this.render();
  }

  pressDigit(digit, modeOverride) {
    const mode = modeOverride ?? this.mode;
    if (!this.selection.size) return;
    this.engine.enterDigit(this.selection, digit, mode);
    if (!this.timer.running) this.timer.start();
    this.actions.onMove?.();
  }

  /** "Check" button - grades what is on the board right now. */
  checkSolution() {
    this.actions.onCheck?.();
    const { wrong, filled } = this.engine.checkAgainstSolution();
    const conflicts = this.engine.getConflicts();
    this.showErrors = true;
    this.render();

    if (this.engine.isComplete()) {
      this.actions.onSolved?.();
      return;
    }
    if (wrong.length) {
      this.flash(`${wrong.length} cell${wrong.length === 1 ? '' : 's'} incorrect`, 'bad');
    } else if (conflicts.cells.size) {
      this.flash(`${conflicts.cells.size} cells break a rule`, 'bad');
    } else if (filled === 0) {
      this.flash('Nothing entered yet', 'neutral');
    } else {
      this.flash(`So far so good - ${CELLS - filled} cells to go`, 'good');
    }
  }

  flash(message, tone = 'neutral', ms = 2600) {
    const el = this.dom.toast;
    if (!el) return;
    el.textContent = message;
    el.className = `toast show toast-${tone}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.className = 'toast';
    }, ms);
  }

  /** Full-board veil used while a puzzle generates. */
  setBusy(on, text = 'Generating puzzle...') {
    this.dom.overlayText.textContent = text;
    this.dom.overlay.classList.toggle('show', Boolean(on));
  }

  /* ---------------------------------------------------------------- render */

  render() {
    const { engine, settings } = this;
    if (!engine.puzzle) return;

    this.dom.grid.classList.toggle('colors-hidden', !settings.showCellColors);

    const conflicts = settings.showConflicts || this.showErrors
      ? engine.getConflicts().cells
      : new Set();
    const wrongCells = this.showErrors
      ? new Set(engine.checkAgainstSolution().wrong)
      : new Set();

    // Which digit should be highlighted across the board?
    const focusDigit =
      this.hoverDigit ??
      (this.selection.size === 1 ? engine.values[[...this.selection][0]] : 0);

    // Peers of a single selected cell.
    const peerSet = new Set();
    if (settings.highlightPeers && this.selection.size === 1) {
      const i = [...this.selection][0];
      const r = rowOf(i);
      const c = colOf(i);
      for (let k = 0; k < SIZE; k++) {
        peerSet.add(indexOf(r, k));
        peerSet.add(indexOf(k, c));
      }
      const r0 = ((r / 3) | 0) * 3;
      const c0 = ((c / 3) | 0) * 3;
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) peerSet.add(indexOf(r0 + dr, c0 + dc));
      }
    }

    // Where does the selected arrow claim its 9 is?
    const arrowTargets = new Set();
    if (settings.highlightArrowTarget) {
      for (const i of this.selection) {
        const t = this._arrowTarget(i);
        if (t >= 0) arrowTargets.add(t);
      }
    }

    for (let i = 0; i < CELLS; i++) {
      const node = this.cells[i];
      const root = node.root;
      const value = engine.values[i];

      root.classList.toggle('is-selected', this.selection.has(i));
      root.classList.toggle('is-peer', peerSet.has(i) && !this.selection.has(i));
      root.classList.toggle('is-given', engine.isGiven(i));
      root.classList.toggle('is-conflict', conflicts.has(i));
      root.classList.toggle('is-wrong', wrongCells.has(i));
      root.classList.toggle('is-arrow-target', arrowTargets.has(i));
      root.classList.toggle(
        'is-same-digit',
        Boolean(settings.highlightSameDigit && focusDigit && value === focusDigit)
      );

      // Digit
      node.value.textContent = value ? String(value) : '';

      // Pencil marks - hidden entirely once a digit is present
      if (value) {
        node.center.textContent = '';
        for (const span of node.corner.children) span.textContent = '';
      } else {
        const centre = engine.centerDigits(i);
        node.center.textContent = centre.join('');
        node.center.dataset.count = String(centre.length);

        const corners = engine.cornerDigits(i);
        const spans = node.corner.children;
        for (let k = 0; k < spans.length; k++) {
          spans[k].textContent = corners[k] ? String(corners[k]) : '';
        }
      }

      // Arrow
      const dir = engine.arrows[i];
      if (dir === NO_ARROW) {
        node.arrow.style.display = 'none';
      } else {
        node.arrow.style.display = '';
        node.arrow.style.transform = `rotate(${dir * 90}deg)`;
      }

      // Colours - multiple colours render as hard-stop stripes.
      // Visibility is a CSS concern (see .colors-hidden), so the layer is
      // always painted and only the class decides whether it shows.
      const list = engine.colorList(i);
      if (!list.length) {
        node.colors.style.background = '';
        node.colors.classList.remove('has-color');
      } else {
        if (list.length === 1) {
          node.colors.style.background = PALETTE[list[0]];
        } else {
          const step = 100 / list.length;
          const stops = list
            .map((c, k) => `${PALETTE[c]} ${k * step}% ${(k + 1) * step}%`)
            .join(', ');
          node.colors.style.background = `linear-gradient(135deg, ${stops})`;
        }
        node.colors.classList.add('has-color');
      }
    }

    this._renderControls();
  }

  /** The cell an arrow at `i` currently points at, or -1. */
  _arrowTarget(i) {
    const dir = this.engine.arrows[i];
    const v = this.engine.values[i];
    if (dir === NO_ARROW || !v) return -1;
    const dr = [-1, 0, 1, 0][dir];
    const dc = [0, 1, 0, -1][dir];
    const r = rowOf(i) + dr * v;
    const c = colOf(i) + dc * v;
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return -1;
    return indexOf(r, c);
  }

  _renderControls() {
    for (const btn of this.dom.modeButtons) {
      const active = btn.dataset.mode === this.mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    // In colour mode the digit keys become swatches.
    const colorMode = this.mode === MODE.COLOR;
    for (const btn of this.dom.digitButtons) {
      btn.classList.toggle('is-swatch', colorMode);
      const d = Number(btn.dataset.digit);
      btn.style.setProperty('--swatch', PALETTE[d - 1] ?? 'transparent');
    }

    this.dom.undo.disabled = !this.engine.canUndo;
    this.dom.redo.disabled = !this.engine.canRedo;

    const colorsOn = this.settings.showCellColors;
    this.dom.colorsBtn?.classList.toggle('is-off', !colorsOn);
    this.dom.colorsBtn?.setAttribute('aria-pressed', String(colorsOn));
    this.dom.colorsBtn?.setAttribute(
      'title',
      colorsOn ? 'Hide cell colours' : 'Show cell colours'
    );

    this.dom.timer.textContent = formatTime(this.timer.elapsedMs);
    this.dom.timer.classList.toggle('is-hidden', !this.settings.showTimer);
    this.dom.timerToggle.textContent = this.timer.running ? 'Pause' : 'Play';
    this.dom.timerToggle.setAttribute(
      'aria-label',
      this.timer.running ? 'Pause timer' : 'Start timer'
    );

    const remaining = this.engine.remainingCells();
    this.dom.status.textContent = remaining === 0
      ? 'Grid full - press Check'
      : `${remaining} cells remaining`;
    if (this.dom.roundChecks) this.dom.roundChecks.textContent = `${this.actions.getCheckCount?.() ?? 0} checks`;
  }

  /** Refresh the stats block from storage. */
  renderStats(stats) {
    const d = this.engine.puzzle?.difficulty ?? 'medium';
    this.dom.statSolved.textContent = String(stats.totalSolved ?? 0);
    this.dom.statBest.textContent = stats.best?.[d] != null ? formatTime(stats.best[d]) : '--:--';
    this.dom.statStreak.textContent = String(stats.streak?.current ?? 0);
    this.dom.statArrows.textContent = String(this.engine.puzzle?.stats?.arrowCount ?? 0);
    if (this.dom.statChecks) this.dom.statChecks.textContent = String(stats.totalChecks ?? 0);
  }

  renderUser(user) {
    if (this.dom.userBadge) {
      this.dom.userBadge.textContent = user ? (user.guest ? 'Guest' : user.username) : 'Sign in';
      this.dom.userBadge.classList.toggle('is-guest', Boolean(user?.guest));
    }
    const loggedIn = Boolean(user);
    const loginFields = document.getElementById('auth-login-fields');
    const signedIn = document.getElementById('auth-signed-in');
    if (loginFields) loginFields.hidden = loggedIn;
    if (signedIn) signedIn.hidden = !loggedIn;
    const name = document.getElementById('auth-user-name');
    if (name) name.textContent = user ? `${user.username}${user.guest ? ' · local only' : ''}` : '';
    this._profileUser = user;
    this._setLocationControls(this.dom.authCountry, this.dom.authState, this.dom.authStateField, user ?? {});
    this._setLocationControls(this.dom.profileCountry, this.dom.profileState, this.dom.profileStateField, user ?? {});
    if (this.dom.editProfileButton) this.dom.editProfileButton.hidden = !loggedIn || Boolean(user?.guest);
    if (this.dom.profileEditFields) this.dom.profileEditFields.hidden = true;
  }

  async _submitAuth(action) {
    const username = this.dom.authUsername?.value.trim();
    const password = this.dom.authPassword?.value ?? '';
    await this._runAuthAction(action, {
      username,
      password,
      country: this.dom.authCountry?.value,
      state: this.dom.authState?.value,
    });
  }

  async _submitProfile() {
    await this._runAuthAction('updateProfile', {
      country: this.dom.profileCountry?.value,
      state: this.dom.profileState?.value,
    });
    if (!this.dom.profileError?.textContent) this._closeProfileEditor();
  }

  async _runAuthAction(action, payload = {}) {
    try {
      if (action === 'login') await this.actions.authLogin?.(payload.username, payload.password);
      if (action === 'register') await this.actions.authRegister?.(payload.username, payload.password, { country: payload.country, state: payload.state });
      if (action === 'updateProfile') await this.actions.authUpdateProfile?.({ country: payload.country, state: payload.state });
      if (action === 'guest') await this.actions.authGuest?.();
      if (action === 'logout') await this.actions.authLogout?.();
      if (this.dom.authError) this.dom.authError.textContent = '';
      if (this.dom.profileError) this.dom.profileError.textContent = '';
      if (action !== 'logout' && action !== 'updateProfile') document.getElementById('dialog-auth')?.close();
    } catch (err) {
      const target = action === 'updateProfile' ? this.dom.profileError : this.dom.authError;
      if (target) target.textContent = err.message;
    }
  }

  renderLeaderboard(entries, scope = 'global', offline = false, mode = 'daily') {
    const body = this.dom.leaderboardBody;
    if (!body) return;
    const labels = { global: 'Global', local: 'Local device', friends: 'Friends' };
    if (this.dom.leaderboardMeta) {
      this.dom.leaderboardMeta.textContent = `${labels[scope] ?? 'Leaderboard'} · ${mode === 'practice' ? 'all practice puzzles' : "today's puzzle"}${offline ? ' · offline preview' : ''}`;
    }
    const title = document.getElementById('leaderboard-title');
    if (title) title.textContent = mode === 'practice' ? 'Practice leaderboard' : 'Daily leaderboard';
    if (!entries.length) {
      body.innerHTML = `<p class="empty-state">No scores yet. Be the first to solve ${mode === 'practice' ? 'a puzzle at this difficulty' : 'today\'s puzzle'}.</p>`;
      return;
    }
    body.innerHTML = `<table class="leaderboard-table"><thead><tr><th>#</th><th>Player</th><th>Time</th><th>Checks</th></tr></thead><tbody>${entries.map((entry, index) => `
      <tr class="${entry.checkCount === 0 ? 'is-clean' : ''}"><td>${entry.rank ?? index + 1}</td><td>${escapeHtml(entry.username ?? 'Guest')}</td><td>${formatTime(entry.timeMs)}</td><td>${entry.checkCount ?? 0}</td></tr>`).join('')}</tbody></table>`;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

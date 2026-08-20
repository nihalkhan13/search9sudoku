/**
 * main.js
 * Application entry point: wires the engine, timer, storage, API and UI
 * together and owns the high-level game flow (new puzzle, daily, restart,
 * autosave, victory).
 */

import { GameEngine } from './core/GameEngine.js';
import { serializePuzzle, deserializePuzzle, DIFFICULTY } from './core/Generator.js';
import { todaySeedInTimeZone, dailyDifficulty } from './core/rng.js';
import { timezoneForLocation } from './core/locations.js';
import { storage } from './services/StorageService.js';
import {
  fetchDailyPuzzle,
  fetchPracticePuzzle,
  buildShareUrl,
  readPuzzleFromUrl,
} from './services/ApiService.js';
import {
  currentUser,
  login,
  register,
  updateProfile,
  playAsGuest,
  logout,
  submitScore,
  fetchLeaderboard,
  addFriend,
  removeScore,
} from './services/CloudService.js';
import { Timer, formatTime } from './ui/Timer.js';
import { UIController } from './ui/UIController.js';

const engine = new GameEngine();
const settings = storage.loadSettings();
engine.autoCleanMarks = settings.autoCleanMarks;

let ui;
let currentMode = 'practice'; // 'practice' | 'daily'
let solvedThisRound = false;
let checkCount = 0;
let activeUser = currentUser();
let leaderboardScope = 'global';

const timer = new Timer(() => ui?._renderControls());
let dailyLoading = false;
let dailyRolloverTimer = null;

function dailyTimeZone() {
  return timezoneForLocation(activeUser?.country, activeUser?.state)
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function currentDailySeed() {
  return todaySeedInTimeZone(dailyTimeZone());
}

/* ------------------------------------------------------------------ flow */

/** Install a puzzle and reset the session around it. */
function startPuzzle(puzzle, { mode = 'practice', savedState = null, elapsedMs = 0, savedChecks = 0 } = {}) {
  currentMode = mode;
  solvedThisRound = false;
  checkCount = Number(savedChecks) || 0;

  engine.loadPuzzle(puzzle, savedState);
  ui.selection.clear();
  ui.showErrors = false;

  timer.reset(elapsedMs);
  timer.pause();

  updateHeader();
  ui.renderStats(storage.loadStats());
  ui.renderUser(activeUser);
  ui.render();
  saveProgress();
}

function updateHeader() {
  const p = engine.puzzle;
  const title = document.getElementById('puzzle-title');
  const sub = document.getElementById('puzzle-subtitle');
  const label = DIFFICULTY[p.difficulty]?.label ?? 'Custom';

  if (currentMode === 'daily') {
    title.textContent = 'Daily Puzzle';
    sub.textContent = `${p.dateSeed ?? currentDailySeed()} · ${label}`;
  } else {
    title.textContent = 'Search Nine Sudoku';
    sub.textContent = `${label} · ${p.stats?.arrowCount ?? 0} arrows · ${p.stats?.givenCount ?? 0} givens`;
  }
}

/**
 * Generation is synchronous and takes ~25ms, but we still yield a frame so
 * the "Generating..." veil actually paints before the main thread blocks.
 *
 * requestAnimationFrame is raced against a timer on purpose: a hidden or
 * backgrounded tab never fires rAF, and without the fallback the veil would
 * stay up forever if the player switched away mid-generation.
 */
function yieldToPaint() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      resolve();
    };
    const fallback = setTimeout(finish, 250);
    requestAnimationFrame(() => setTimeout(finish, 0));
  });
}

async function withBusy(text, fn) {
  ui.setBusy(true, text);
  try {
    await yieldToPaint();
    return await fn();
  } finally {
    ui.setBusy(false);
  }
}

async function newPuzzle(difficulty = 'medium') {
  const puzzle = await withBusy('Generating puzzle...', () => fetchPracticePuzzle(difficulty));
  startPuzzle(puzzle, { mode: 'practice' });
  ui.flash(`New ${DIFFICULTY[difficulty]?.label ?? ''} puzzle`, 'good');
}

async function dailyPuzzle() {
  if (dailyLoading) return;
  dailyLoading = true;
  try {
    const seed = currentDailySeed();
    const difficulty = dailyDifficulty(seed);
    const puzzle = await withBusy("Loading today's puzzle...", () => fetchDailyPuzzle(seed, difficulty));
    startPuzzle(puzzle, { mode: 'daily' });

    const done = storage.getDailyRecord(seed);
    const resetLabel = activeUser?.country === 'US' && activeUser?.state ? `${activeUser.state} midnight` : 'your local midnight';
    if (done) ui.flash(`Already solved today in ${formatTime(done.elapsedMs)} · resets at ${resetLabel}`, 'good');
    else ui.flash(`Daily puzzle for ${seed} · ${DIFFICULTY[difficulty].label} · resets at ${resetLabel}`, 'neutral');
  } finally {
    dailyLoading = false;
  }
}

function watchDailyRollover() {
  clearInterval(dailyRolloverTimer);
  dailyRolloverTimer = setInterval(() => {
    if (currentMode === 'daily' && engine.puzzle?.dateSeed !== currentDailySeed()) dailyPuzzle();
  }, 30_000);
}

function restart() {
  engine.resetBoard();
  checkCount = 0;
  timer.reset(0);
  timer.pause();
  ui.selection.clear();
  ui.showErrors = false;
  ui.render();
  ui.flash('Board cleared', 'neutral');
}

/* -------------------------------------------------------------- autosave */

let saveTimer = null;
function saveProgress() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!engine.puzzle) return;
    storage.saveCurrentGame({
      puzzle: serializePuzzle(engine.puzzle),
      state: engine.serializeState(),
      elapsedMs: timer.elapsedMs,
      mode: currentMode,
      dateSeed: engine.puzzle.dateSeed ?? null,
      checkCount,
    });
  }, 400);
}

/* --------------------------------------------------------------- victory */

function onSolved() {
  if (solvedThisRound) return;
  if (!engine.isComplete()) return;
  solvedThisRound = true;

  timer.pause();
  const elapsed = timer.elapsedMs;
  const difficulty = engine.puzzle.difficulty;
  const isDaily = currentMode === 'daily';
  const seed = engine.puzzle.dateSeed ?? currentDailySeed();

  const { stats, isNewBest } = storage.recordSolve(difficulty, elapsed, isDaily, seed, checkCount);
  if (isDaily) storage.markDailyComplete(seed, elapsed);
  storage.clearCurrentGame();
  ui.renderStats(stats);

  // Fire-and-forget; no-ops until a backend is configured in ApiService.
  const score = {
    puzzleId: engine.puzzle.id,
    timeMs: elapsed,
    checkCount,
    difficulty,
    dateSeed: engine.puzzle.dateSeed ?? null,
    isDaily,
    puzzleSeed: engine.puzzle.seed,
    grid: Array.from(engine.values).join(''),
  };
  storage.saveLocalScore({ ...score, userId: activeUser?.id ?? 'local-guest', username: activeUser?.username ?? 'Guest' });
  submitScore(score).then((result) => {
    if (result?._error) {
      ui.flash(result.status === 401 ? 'Score saved here. Sign in to publish it globally.' : 'Score saved here, but could not reach the global board.', 'neutral');
    } else if (result?.accepted && !result?.offline) {
      ui.flash('Score added to the leaderboard', 'good');
    }
  }).catch(() => {});

  document.getElementById('victory-time').textContent = formatTime(elapsed);
  document.getElementById('victory-difficulty').textContent =
    DIFFICULTY[difficulty]?.label ?? 'Custom';
  document.getElementById('victory-best').textContent = isNewBest
    ? 'New personal best!'
    : `Best: ${stats.best[difficulty] != null ? formatTime(stats.best[difficulty]) : '--:--'}`;
  document.getElementById('dialog-victory').showModal();
}

/** Called after every move: autosave, and auto-detect a finished grid. */
function onMove() {
  saveProgress();
  if (engine.remainingCells() === 0 && engine.isComplete()) onSolved();
}

function onCheck() {
  checkCount += 1;
  saveProgress();
  ui.render();
}

async function authLogin(username, password) {
  const user = await login(username, password);
  if (!user) throw new Error('Username or password not recognised');
  activeUser = user;
  ui.renderUser(activeUser);
  ui.flash(`Welcome back, ${user.username}`, 'good');
}

async function authRegister(username, password, location) {
  const user = await register(username, password, location);
  if (!user) throw new Error('Choose a new username and a password of 6+ characters');
  activeUser = user;
  ui.renderUser(activeUser);
  ui.flash(`Account created for ${user.username}`, 'good');
}

async function authUpdateProfile(location) {
  const user = await updateProfile(location);
  if (!user) throw new Error('Could not update your profile');
  activeUser = user;
  ui.renderUser(activeUser);
  ui.flash('Profile updated', 'good');
}

async function authGuest() {
  activeUser = await playAsGuest();
  ui.renderUser(activeUser);
  ui.flash('Playing as Guest · scores stay on this device', 'neutral');
}

async function authLogout() {
  await logout();
  activeUser = null;
  ui.renderUser(null);
  ui.flash('Signed out', 'neutral');
}

async function openLeaderboard(scope = 'global') {
  leaderboardScope = scope;
  let mode = currentMode;
  let puzzleId = currentMode === 'daily' ? engine.puzzle?.id : null;
  let difficulty = engine.puzzle?.difficulty;
  let apiScope = scope;

  // The Daily tab is available from any puzzle, so resolve today's daily
  // identity before asking the API for its exact board.
  if (scope === 'daily') {
    const seed = currentDailySeed();
    difficulty = dailyDifficulty(seed);
    const daily = await fetchDailyPuzzle(seed, difficulty);
    puzzleId = daily.id;
    mode = 'daily';
    apiScope = 'global';
  }

  const result = await fetchLeaderboard({
    puzzleId,
    difficulty,
    mode,
    scope: apiScope,
    limit: 50,
  });
  const localLabel = activeUser?.country === 'US' && activeUser?.state ? `Local (${activeUser.state})` : 'Local';
  ui.renderLeaderboard(result?.entries ?? [], scope, Boolean(result?.offline), mode, {
    localLabel,
    viewerId: activeUser?.id,
    isAdmin: activeUser?.username?.toLowerCase() === 'thekhanartist',
  });
}

async function removeLeaderboardScore(entry) {
  if (!entry?.scoreId && !entry?.puzzleId) return;
  const label = entry.puzzleCode ? `puzzle ${entry.puzzleCode}` : 'this score';
  const isAdmin = activeUser?.username?.toLowerCase() === 'thekhanartist';
  const subject = isAdmin && entry.userId !== activeUser?.id ? "this player's" : 'your';
  if (!window.confirm(`Remove ${subject} ${label} from the leaderboard?`)) return;
  const result = await removeScore({ scoreId: entry.scoreId, puzzleId: entry.puzzleId, userId: entry.userId });
  if (result?._error) {
    ui.flash(result._error, 'bad');
    return;
  }
  if (!result?.deleted) {
    ui.flash('That score could not be removed', 'bad');
    return;
  }
  ui.flash('Score removed from the leaderboard', 'good');
  await openLeaderboard(leaderboardScope);
}

async function playLeaderboardPuzzle(entry) {
  const isDaily = Boolean(entry.isDaily || entry.dateSeed);
  const seed = entry.puzzleSeed ?? entry.dateSeed;
  if (!seed) {
    ui.flash('This older score cannot be replayed yet', 'neutral');
    return;
  }
  const difficulty = entry.difficulty ?? 'medium';
  const puzzle = isDaily
    ? await fetchDailyPuzzle(entry.dateSeed, difficulty)
    : await fetchPracticePuzzle(difficulty, seed);
  startPuzzle(puzzle, { mode: isDaily ? 'daily' : 'practice' });
  document.getElementById('dialog-leaderboard')?.close();
  ui.flash(`Loaded puzzle ${entry.puzzleCode ?? ''}`.trim(), 'good');
}

async function addFriendByUsername(username) {
  const result = await addFriend(username);
  const status = document.getElementById('friend-status');
  if (result?.friend) {
    if (status) status.textContent = `${result.friend.username} added to your friends.`;
    ui.actions.openLeaderboard?.('friends');
  } else if (status) {
    status.textContent = 'That player could not be found yet.';
  }
}

/* ------------------------------------------------------------------ boot */

function share() {
  const url = buildShareUrl(engine.puzzle);
  navigator.clipboard?.writeText(url).then(
    () => ui.flash('Puzzle link copied to clipboard', 'good'),
    () => ui.flash('Could not copy - check the address bar', 'bad')
  );
  window.history.replaceState(null, '', url);
}

function openStats() {
  const stats = storage.loadStats();
  const body = document.getElementById('stats-body');
  const rows = Object.entries(DIFFICULTY).map(([key, cfg]) => {
    const best = stats.best[key] != null ? formatTime(stats.best[key]) : '--:--';
    return `<tr><td>${cfg.label}</td><td>${stats.solved[key] ?? 0}</td><td>${best}</td></tr>`;
  });
  body.innerHTML = `
    <table class="stats-table">
      <thead><tr><th>Difficulty</th><th>Solved</th><th>Best</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <p class="stats-summary">
      Total solved: <strong>${stats.totalSolved}</strong><br>
      Checks used: <strong>${stats.totalChecks ?? 0}</strong><br>
      Daily streak: <strong>${stats.streak.current}</strong> (best ${stats.streak.best})<br>
      Time played: <strong>${formatTime(stats.totalMs)}</strong>
    </p>`;
  document.getElementById('dialog-stats').showModal();
}

async function boot() {
  ui = new UIController(engine, {
    timer,
    storage,
    settings,
    actions: {
      newPuzzle, dailyPuzzle, restart, share, openStats, onMove, onSolved, onCheck,
      authLogin, authRegister, authUpdateProfile, authGuest, authLogout, openLeaderboard, playLeaderboardPuzzle, removeLeaderboardScore,
      addFriend: addFriendByUsername,
      getCheckCount: () => checkCount,
    },
  });
  watchDailyRollover();

  document.getElementById('btn-victory-new').addEventListener('click', () => {
    document.getElementById('dialog-victory').close();
    newPuzzle(document.getElementById('difficulty-select').value);
  });

  // Priority: a puzzle in the URL, then a saved game, then a fresh one.
  const fromUrl = readPuzzleFromUrl();
  if (fromUrl) {
    startPuzzle(fromUrl, { mode: 'practice' });
    ui.flash('Loaded puzzle from link', 'good');
    return;
  }

  const saved = storage.loadCurrentGame();
  if (saved?.puzzle) {
    try {
      const puzzle = deserializePuzzle(saved.puzzle);
      if (saved.dateSeed) {
        puzzle.dateSeed = saved.dateSeed;
        puzzle.isDaily = true;
      }
      startPuzzle(puzzle, {
        mode: saved.mode ?? 'practice',
        savedState: saved.state,
        elapsedMs: saved.elapsedMs ?? 0,
        savedChecks: saved.checkCount ?? 0,
      });
      ui.flash('Resumed your saved game', 'neutral');
      return;
    } catch (err) {
      console.warn('[main] could not restore saved game:', err.message);
      storage.clearCurrentGame();
    }
  }

  await newPuzzle('easy');
}

// Keep the clock honest when the tab is hidden, and never lose progress.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveProgress();
});
window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  if (!engine.puzzle || solvedThisRound) return;
  storage.saveCurrentGame({
    puzzle: serializePuzzle(engine.puzzle),
    state: engine.serializeState(),
    elapsedMs: timer.elapsedMs,
    mode: currentMode,
    dateSeed: engine.puzzle.dateSeed ?? null,
    checkCount,
  });
});

boot();

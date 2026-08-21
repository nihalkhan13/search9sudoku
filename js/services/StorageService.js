/**
 * StorageService.js
 * Everything that must survive a page reload: the in-progress game, best
 * times, streaks and user settings.
 *
 * All access goes through this one module so that swapping localStorage for a
 * server-backed profile later means rewriting this file and nothing else.
 * Every method degrades gracefully when storage is unavailable (private
 * browsing, quota exceeded, disabled cookies).
 */

const PREFIX = 'search9:';
const KEYS = {
  CURRENT: `${PREFIX}current`,
  STATS: `${PREFIX}stats`,
  SETTINGS: `${PREFIX}settings`,
  DAILY: `${PREFIX}daily`,
  AUTH_USERS: `${PREFIX}auth-users`,
  SESSION: `${PREFIX}session`,
  LOCAL_SCORES: `${PREFIX}local-scores`,
  PENDING_SCORES: `${PREFIX}pending-scores`,
  FRIENDS: `${PREFIX}friends`,
  DAILY_OPENS: `${PREFIX}daily-opens`,
  DAILY_RESET: `${PREFIX}daily-reset`,
};

// The daily difficulty rule changed, so old local state must not make the user
// appear already finished on a puzzle from the previous daily version.
const DAILY_RESET_VERSION = '2026-08-20-medium-hard-random-v2';
const DAILY_RESET_SEED = '2026-08-20';

export const DEFAULT_SETTINGS = Object.freeze({
  highlightSameDigit: true,
  highlightPeers: true,
  showConflicts: true,
  autoCleanMarks: true,
  showTimer: true,
  highlightArrowTarget: true,
  /** Hides applied cell colors without erasing them. */
  showCellColors: true,
  /**
   * null = follow the OS setting, true/false = an explicit choice.
   * The inline script in index.html reads this before first paint, so the
   * page never flashes the wrong theme.
   */
  darkMode: null,
});

function available() {
  try {
    const k = `${PREFIX}__probe`;
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export class StorageService {
  constructor() {
    this.ok = typeof window !== 'undefined' && available();
    if (!this.ok) {
      console.warn('[StorageService] localStorage unavailable - progress will not persist.');
    } else {
      this._applyDailyReset();
    }
  }

  _applyDailyReset() {
    if (this._read(KEYS.DAILY_RESET, null) === DAILY_RESET_VERSION) return;

    const daily = this._read(KEYS.DAILY, {});
    delete daily[DAILY_RESET_SEED];
    this._write(KEYS.DAILY, daily);

    const opens = this._read(KEYS.DAILY_OPENS, {});
    delete opens[DAILY_RESET_SEED];
    this._write(KEYS.DAILY_OPENS, opens);

    const scores = this._read(KEYS.LOCAL_SCORES, []);
    this._write(KEYS.LOCAL_SCORES, scores.filter((score) => score.dateSeed !== DAILY_RESET_SEED));

    const current = this._read(KEYS.CURRENT, null);
    if (current?.dateSeed === DAILY_RESET_SEED && current.mode === 'daily') this.clearCurrentGame();

    this._write(KEYS.DAILY_RESET, DAILY_RESET_VERSION);
  }

  _read(key, fallback = null) {
    if (!this.ok) return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn(`[StorageService] could not read ${key}`, err);
      return fallback;
    }
  }

  _write(key, value) {
    if (!this.ok) return false;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn(`[StorageService] could not write ${key}`, err);
      return false;
    }
  }

  /* ------------------------------------------------------- current game */

  /**
   * @param {object} payload
   * @param {string} payload.puzzle    serialised puzzle string
   * @param {object} payload.state     GameEngine.serializeState()
   * @param {number} payload.elapsedMs timer value
   * @param {string} payload.mode      'daily' | 'practice'
   */
  saveCurrentGame(payload) {
    return this._write(KEYS.CURRENT, { ...payload, savedAt: Date.now() });
  }

  loadCurrentGame() {
    return this._read(KEYS.CURRENT, null);
  }

  clearCurrentGame() {
    if (!this.ok) return;
    try {
      window.localStorage.removeItem(KEYS.CURRENT);
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------ settings */

  loadSettings() {
    return { ...DEFAULT_SETTINGS, ...this._read(KEYS.SETTINGS, {}) };
  }

  saveSettings(settings) {
    return this._write(KEYS.SETTINGS, settings);
  }

  /* --------------------------------------------------------------- stats */

  /**
   * Stats shape:
   * {
   *   solved: { easy: n, medium: n, hard: n },
   *   best:   { easy: ms, medium: ms, hard: ms },
   *   totalMs, totalSolved,
   *   streak: { current, best, lastDate }
   * }
   */
  loadStats() {
    return this._read(KEYS.STATS, {
      solved: { easy: 0, medium: 0, hard: 0 },
      best: { easy: null, medium: null, hard: null },
      totalMs: 0,
      totalSolved: 0,
      totalChecks: 0,
      streak: { current: 0, best: 0, lastDate: null },
    });
  }

  /**
   * Record a solve and return the updated stats.
   * @param {string} difficulty
   * @param {number} elapsedMs
   * @param {boolean} isDaily whether this counts toward the daily streak
   * @param {string} dateSeed YYYY-MM-DD, used for streak continuity
   */
  recordSolve(difficulty, elapsedMs, isDaily = false, dateSeed = null, checkCount = 0) {
    const stats = this.loadStats();

    stats.solved[difficulty] = (stats.solved[difficulty] ?? 0) + 1;
    stats.totalSolved += 1;
    stats.totalMs += elapsedMs;
    stats.totalChecks = (stats.totalChecks ?? 0) + checkCount;

    const prevBest = stats.best[difficulty];
    const isNewBest = prevBest == null || elapsedMs < prevBest;
    if (isNewBest) stats.best[difficulty] = elapsedMs;

    if (isDaily && dateSeed) {
      const { lastDate } = stats.streak;
      if (lastDate === dateSeed) {
        // already counted today - leave the streak alone
      } else {
        const yesterday = previousDay(dateSeed);
        stats.streak.current = lastDate === yesterday ? stats.streak.current + 1 : 1;
        stats.streak.best = Math.max(stats.streak.best, stats.streak.current);
        stats.streak.lastDate = dateSeed;
      }
    }

    this._write(KEYS.STATS, stats);
    return { stats, isNewBest };
  }

  resetStats() {
    if (!this.ok) return;
    try {
      window.localStorage.removeItem(KEYS.STATS);
    } catch {
      /* ignore */
    }
  }

  /* --------------------------------------------------------------- daily */

  /** Which dailies have been completed, so the UI can show a tick. */
  markDailyComplete(dateSeed, elapsedMs) {
    const daily = this._read(KEYS.DAILY, {});
    daily[dateSeed] = { elapsedMs, completedAt: Date.now() };
    // Keep the log small - the last 400 days is plenty for a local client.
    const keys = Object.keys(daily).sort();
    while (keys.length > 400) delete daily[keys.shift()];
    return this._write(KEYS.DAILY, daily);
  }

  isDailyComplete(dateSeed) {
    const daily = this._read(KEYS.DAILY, {});
    return Boolean(daily[dateSeed]);
  }

  getDailyRecord(dateSeed) {
    return this._read(KEYS.DAILY, {})[dateSeed] ?? null;
  }

  hasOpenedDaily(dateSeed) {
    return Boolean(this._read(KEYS.DAILY_OPENS, {})[dateSeed]);
  }

  markDailyOpened(dateSeed) {
    const opens = this._read(KEYS.DAILY_OPENS, {});
    opens[dateSeed] = Date.now();
    const keys = Object.keys(opens).sort();
    while (keys.length > 400) delete opens[keys.shift()];
    return this._write(KEYS.DAILY_OPENS, opens);
  }

  /* --------------------------------------------------------- local account */

  /** Local fallback account support used only when the online API is absent. */
  saveSession(session) { return this._write(KEYS.SESSION, session); }
  loadSession() { return this._read(KEYS.SESSION, null); }
  clearSession() {
    if (!this.ok) return;
    try { window.localStorage.removeItem(KEYS.SESSION); } catch { /* ignore */ }
  }

  localRegister(username, password, location = {}) {
    const clean = String(username ?? '').trim().toLowerCase();
    const users = this._read(KEYS.AUTH_USERS, {});
    if (!clean || String(password ?? '').length < 6 || users[clean]) return null;
    users[clean] = { id: `local-${clean}`, username: clean, password, country: location.country ?? 'US', state: location.state ?? null };
    this._write(KEYS.AUTH_USERS, users);
    return { id: users[clean].id, username: clean, country: users[clean].country, state: users[clean].state, guest: false, local: true };
  }

  localLogin(username, password) {
    const clean = String(username ?? '').trim().toLowerCase();
    const user = this._read(KEYS.AUTH_USERS, {})[clean];
    if (!user || user.password !== password) return null;
    return { id: user.id, username: user.username, country: user.country ?? 'US', state: user.state ?? null, guest: false, local: true };
  }

  findLocalUser(username) {
    const clean = String(username ?? '').trim().toLowerCase();
    const user = this._read(KEYS.AUTH_USERS, {})[clean];
    return user ? { id: user.id, username: user.username, country: user.country ?? 'US', state: user.state ?? null, guest: false, local: true } : null;
  }

  updateLocalProfile(userId, location = {}) {
    const users = this._read(KEYS.AUTH_USERS, {});
    const key = Object.keys(users).find((candidate) => users[candidate].id === userId);
    if (!key) return null;
    users[key] = { ...users[key], country: location.country, state: location.state ?? null };
    this._write(KEYS.AUTH_USERS, users);
    return { id: users[key].id, username: users[key].username, country: users[key].country, state: users[key].state, guest: false, local: true };
  }

  guestSession() {
    return { id: `guest-${Math.random().toString(36).slice(2, 10)}`, username: 'Guest', guest: true, local: true };
  }

  /* ---------------------------------------------- offline leaderboard */

  saveLocalScore(entry) {
    const scores = this._read(KEYS.LOCAL_SCORES, []);
    scores.push({ ...entry, local: true, createdAt: Date.now() });
    scores.sort((a, b) => scoreCompare(a, b));
    this._write(KEYS.LOCAL_SCORES, scores.slice(0, 500));
    return scores;
  }

  /** Keep a score queued until the online account/backend is available. */
  queuePendingScore(entry) {
    if (!entry?.puzzleId) return [];
    const pending = this._read(KEYS.PENDING_SCORES, []);
    const existingIndex = pending.findIndex((score) => score.puzzleId === entry.puzzleId);
    if (existingIndex >= 0) {
      if (scoreCompare(entry, pending[existingIndex]) < 0) pending[existingIndex] = { ...entry, queuedAt: Date.now() };
    } else {
      pending.push({ ...entry, queuedAt: Date.now() });
    }
    pending.sort((a, b) => scoreCompare(a, b));
    this._write(KEYS.PENDING_SCORES, pending.slice(0, 100));
    return pending;
  }

  getPendingScores() {
    return this._read(KEYS.PENDING_SCORES, []);
  }

  removePendingScore(puzzleId) {
    const pending = this._read(KEYS.PENDING_SCORES, []);
    const remaining = pending.filter((score) => score.puzzleId !== puzzleId);
    this._write(KEYS.PENDING_SCORES, remaining);
    return remaining;
  }

  removeLocalScore({ scoreId = null, puzzleId = null, userId = null } = {}) {
    const scores = this._read(KEYS.LOCAL_SCORES, []);
    const remaining = scores.filter((score) => {
      if (scoreId && (score.scoreId === scoreId || score.id === scoreId)) return false;
      if (!puzzleId || score.puzzleId !== puzzleId) return true;
      if (!userId) return true;
      return score.userId !== userId;
    });
    const deleted = remaining.length !== scores.length;
    this._write(KEYS.LOCAL_SCORES, remaining);
    return { deleted, offline: true };
  }

  getLocalScores(puzzleId, scope = 'local', userId = null, filters = {}) {
    const scores = this._read(KEYS.LOCAL_SCORES, []).filter((s) => {
      if (filters.mode === 'practice') return s.dateSeed == null && s.difficulty === filters.difficulty;
      return s.puzzleId === puzzleId;
    });
    if (scope === 'friends' && userId) {
      const friendIds = new Set(this._read(KEYS.FRIENDS, []).map((f) => f.id));
      friendIds.add(userId);
      return scores.filter((s) => friendIds.has(s.userId));
    }
    if (scope === 'local' && userId) return scores.filter((s) => s.userId === userId || s.local);
    return scores;
  }

  addLocalFriend(user) {
    const friends = this._read(KEYS.FRIENDS, []);
    if (!friends.some((f) => f.id === user.id)) friends.push(user);
    this._write(KEYS.FRIENDS, friends);
    return friends;
  }

  getLocalFriends() { return this._read(KEYS.FRIENDS, []); }
}

/** No-check runs are preferred whenever at least one exists in the table. */
export function scoreCompare(a, b) {
  const aChecks = Number(a.checkCount ?? a.checks ?? 0);
  const bChecks = Number(b.checkCount ?? b.checks ?? 0);
  if ((aChecks === 0) !== (bChecks === 0)) return aChecks === 0 ? -1 : 1;
  return Number(a.timeMs) - Number(b.timeMs) || aChecks - bChecks;
}

/** YYYY-MM-DD one day earlier, used for streak continuity. */
function previousDay(dateSeed) {
  const [y, m, d] = dateSeed.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export const storage = new StorageService();

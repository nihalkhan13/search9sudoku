/**
 * rng.js
 * Small deterministic PRNG so a given seed string always produces the same
 * puzzle. Used by the Daily Puzzle mode (seed = "YYYY-MM-DD") and by any
 * reproducible practice puzzle (seed = puzzle id).
 */

/** xmur3 string hash -> 32-bit seed generator. */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 - fast, good-enough 32-bit PRNG. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a seeded random source.
 * @param {string|number} seed - any string; omit for a random (non-reproducible) source.
 */
export function createRng(seed = String(Math.random())) {
  const next = mulberry32(xmur3(String(seed))());
  return {
    seed: String(seed),
    /** float in [0, 1) */
    next,
    /** integer in [0, n) */
    int: (n) => Math.floor(next() * n),
    /** random element of an array */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** in-place Fisher-Yates shuffle; returns the same array */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    },
  };
}

/** Today's local date as YYYY-MM-DD - the canonical Daily Puzzle seed. */
export function todaySeed(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Calendar date in an IANA timezone, used for location-aware Daily mode. */
export function todaySeedInTimeZone(timeZone, date = new Date()) {
  if (!timeZone) return todaySeed(date);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return todaySeed(date);
  }
}

/**
 * One-time date-specific adjustments. The current daily is intentionally
 * reset to Medium; future dates keep the normal Hard daily rule.
 */
export const DAILY_DIFFICULTY_OVERRIDES = Object.freeze({
  '2026-08-20': 'medium',
});

/**
 * Return the verified difficulty for a daily seed. The date argument remains
 * part of the public API so location-aware seeds and score submissions use
 * one shared rule.
 */
export function dailyDifficulty(dateSeed = todaySeed()) {
  return DAILY_DIFFICULTY_OVERRIDES[String(dateSeed)] ?? 'hard';
}

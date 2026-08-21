import { dailyDifficulty } from '../../js/core/rng.js';
import { db, ready } from './db.js';

const RESET_SEED = '2026-08-20';

/** Remove scores from the superseded version of today's reset daily. */
export async function clearStaleDailyScores(dateSeed) {
  const seed = String(dateSeed ?? '');
  if (!ready() || seed !== RESET_SEED) return;

  const difficulty = dailyDifficulty(seed);
  await db(`scores?date_seed=eq.${encodeURIComponent(seed)}&difficulty=neq.${encodeURIComponent(difficulty)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

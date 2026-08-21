import { dailyDifficulty } from '../../js/core/rng.js';
import { db, ready } from './db.js';

const RESET_SEED = '2026-08-20';

/** Remove scores from the superseded version of today's reset daily. */
export async function clearStaleDailyScores(dateSeed) {
  const seed = String(dateSeed ?? '');
  if (!ready() || seed !== RESET_SEED || dailyDifficulty(seed) === 'hard') return;

  await db(`scores?date_seed=eq.${encodeURIComponent(seed)}&difficulty=neq.${encodeURIComponent(dailyDifficulty(seed))}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

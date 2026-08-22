import { puzzleCode } from '../js/core/puzzleCode.js';
import { dailyDifficulty } from '../js/core/rng.js';
import { db, ready, send, userFromRequest } from './_lib/db.js';
import { clearStaleDailyScores } from './_lib/dailyReset.js';

function compare(a, b) {
  // Keep every score for the same puzzle together, then rank players within
  // that puzzle using the normal clean-solve/time/check rules.
  const puzzleGroup = puzzleCode(a.puzzle_id).localeCompare(puzzleCode(b.puzzle_id), undefined, { numeric: true })
    || String(a.puzzle_id ?? '').localeCompare(String(b.puzzle_id ?? ''));
  if (puzzleGroup) return puzzleGroup;
  const az = Number(a.check_count) === 0;
  const bz = Number(b.check_count) === 0;
  if (az !== bz) return az ? -1 : 1;
  return Number(a.time_ms) - Number(b.time_ms) || Number(a.check_count) - Number(b.check_count);
}

function sameLocation(a, b) {
  return Boolean(a && b && a.country === b.country && (a.state ?? null) === (b.state ?? null));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET required' });
  if (!ready()) return send(res, 200, { entries: [], offline: true });
  const user = userFromRequest(req);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const puzzleId = url.searchParams.get('puzzleId');
  const difficulty = url.searchParams.get('difficulty');
  const mode = url.searchParams.get('mode') ?? 'daily';
  const scope = url.searchParams.get('scope') ?? 'global';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  if (mode === 'daily' && !puzzleId) return send(res, 400, { error: 'puzzleId required for a daily leaderboard' });
  if (mode === 'practice' && !['easy', 'medium', 'hard', 'extreme'].includes(difficulty)) return send(res, 400, { error: 'difficulty required for a practice leaderboard' });

  try {
    const dailySeed = mode === 'daily' && /^daily-\d{4}-\d{2}-\d{2}$/.test(String(puzzleId))
      ? String(puzzleId).slice('daily-'.length)
      : null;
    await clearStaleDailyScores(dailySeed).catch((error) => console.warn('[leaderboard] stale score cleanup skipped:', error.message));
    const verifiedDailyDifficulty = dailySeed ? dailyDifficulty(dailySeed) : null;
    let rows = await db('scores?select=id,user_id,puzzle_id,puzzle_seed,time_ms,check_count,difficulty,date_seed,created_at&order=created_at.desc&limit=500');
    const allIds = [...new Set(rows.map((row) => row.user_id))];
    const profiles = allIds.length
      ? await db(`users?select=id,username,country,state&id=in.(${allIds.join(',')})`)
      : [];
    const profileMap = new Map((profiles ?? []).map((row) => [row.id, row]));

    if (scope === 'friends') {
      if (!user) return send(res, 401, { error: 'Sign in to use friends leaderboard' });
      const friendRows = await db(`friendships?select=friend_id&user_id=eq.${user.id}`);
      const ids = new Set([user.id, ...(friendRows ?? []).map((row) => row.friend_id)]);
      rows = rows.filter((row) => ids.has(row.user_id));
    }

    if (scope === 'local') {
      if (!user) return send(res, 401, { error: 'Sign in to use your local leaderboard' });
      let viewer = profileMap.get(user.id);
      if (!viewer) {
        const viewerRows = await db(`users?select=id,username,country,state&id=eq.${user.id}&limit=1`);
        viewer = viewerRows?.[0];
      }
      rows = rows.filter((row) => sameLocation(profileMap.get(row.user_id), viewer));
    }

    rows = rows.filter((row) => mode === 'practice'
      ? row.date_seed == null && row.difficulty === difficulty
      : row.puzzle_id === puzzleId && (!verifiedDailyDifficulty || row.difficulty === verifiedDailyDifficulty)).sort(compare).slice(0, limit);

    const puzzleTotals = new Map();
    const puzzleRanks = new Map();
    for (const row of rows) puzzleTotals.set(row.puzzle_id, (puzzleTotals.get(row.puzzle_id) ?? 0) + 1);

    return send(res, 200, {
      entries: rows.map((row, i) => {
        const profile = profileMap.get(row.user_id) ?? {};
        // Older practice scores predate puzzle_seed, but generated puzzle ids
        // preserve the difficulty-prefixed seed, so they remain replayable.
        const replaySeed = row.puzzle_seed
          ?? (row.date_seed
            ? String(row.date_seed)
            : row.puzzle_id?.startsWith(`${row.difficulty}-`)
              ? row.puzzle_id.slice(String(row.difficulty).length + 1)
              : null);
        const puzzleRank = (puzzleRanks.get(row.puzzle_id) ?? 0) + 1;
        puzzleRanks.set(row.puzzle_id, puzzleRank);
        return {
          rank: puzzleRank,
          overallRank: i + 1,
          puzzleRank,
          puzzleTotal: puzzleTotals.get(row.puzzle_id) ?? 1,
          scoreId: row.id,
          userId: row.user_id,
          username: profile.username ?? 'Player',
          country: profile.country ?? null,
          state: profile.state ?? null,
          timeMs: row.time_ms,
          checkCount: row.check_count,
          difficulty: row.difficulty,
          puzzleId: row.puzzle_id,
          puzzleSeed: replaySeed,
          dateSeed: row.date_seed ? String(row.date_seed) : null,
          puzzleCode: puzzleCode(row.puzzle_id),
          playedAt: row.created_at,
          isDaily: row.date_seed != null,
        };
      }),
    });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}

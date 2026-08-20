import { db, ready, send, userFromRequest } from './_lib/db.js';

function compare(a, b) {
  const az = Number(a.check_count) === 0;
  const bz = Number(b.check_count) === 0;
  if (az !== bz) return az ? -1 : 1;
  return Number(a.time_ms) - Number(b.time_ms) || Number(a.check_count) - Number(b.check_count);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'GET required' });
  if (!ready()) return send(res, 200, { entries: [], offline: true });
  const user = userFromRequest(req);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const puzzleId = url.searchParams.get('puzzleId');
  const scope = url.searchParams.get('scope') ?? 'global';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  if (!puzzleId) return send(res, 400, { error: 'puzzleId required' });
  try {
    let rows = await db(`scores?select=id,user_id,puzzle_id,time_ms,check_count,difficulty,date_seed,created_at&order=created_at.desc&limit=500`);
    if (scope === 'local' && user) rows = rows.filter((row) => row.user_id === user.id);
    if (scope === 'friends') {
      if (!user) return send(res, 401, { error: 'Sign in to use friends leaderboard' });
      const friendRows = await db(`friendships?select=friend_id&user_id=eq.${user.id}`);
      const ids = new Set([user.id, ...(friendRows ?? []).map((row) => row.friend_id)]);
      rows = rows.filter((row) => ids.has(row.user_id));
    }
    rows = rows.filter((row) => row.puzzle_id === puzzleId).sort(compare).slice(0, limit);
    const ids = [...new Set(rows.map((row) => row.user_id))];
    const names = ids.length ? await db(`users?select=id,username&id=in.(${ids.join(',')})`) : [];
    const nameMap = new Map((names ?? []).map((row) => [row.id, row.username]));
    return send(res, 200, { entries: rows.map((row, i) => ({ rank: i + 1, username: nameMap.get(row.user_id) ?? 'Player', timeMs: row.time_ms, checkCount: row.check_count, difficulty: row.difficulty })) });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}

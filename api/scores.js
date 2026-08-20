import { generatePuzzle } from '../js/core/Generator.js';
import { isSolved } from '../js/core/Solver.js';
import { db, readBody, ready, send, userFromRequest } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
  if (!ready()) return send(res, 503, { error: 'Online scores are not configured yet' });
  const user = userFromRequest(req);
  if (!user) return send(res, 401, { error: 'Sign in to submit a global score' });
  try {
    const body = await readBody(req);
    const difficulty = ['easy', 'medium', 'hard'].includes(body.difficulty) ? body.difficulty : 'medium';
    const checkCount = Math.max(0, Number(body.checkCount) || 0);
    const timeMs = Math.max(1, Math.round(Number(body.timeMs) || 0));
    const dateSeed = String(body.dateSeed ?? '');
    if (!body.isDaily || !/^\d{4}-\d{2}-\d{2}$/.test(dateSeed) || !/^[0-9]{81}$/.test(String(body.grid ?? ''))) {
      return send(res, 400, { error: 'Only verified daily scores can enter the global leaderboard' });
    }
    const puzzle = generatePuzzle({ difficulty, seed: dateSeed });
    const grid = Int8Array.from(String(body.grid).split('').map(Number));
    if (!isSolved(grid, puzzle.arrows)) return send(res, 422, { error: 'That grid is not a valid solution' });

    const existing = await db(`scores?select=id,time_ms,check_count&user_id=eq.${user.id}&puzzle_id=eq.${encodeURIComponent(body.puzzleId)}&limit=1`);
    const old = existing?.[0];
    const improves = !old || checkCount < old.check_count || (checkCount === old.check_count && timeMs < old.time_ms);
    if (!improves) return send(res, 200, { accepted: false, reason: 'existing score is better' });

    const record = { user_id: user.id, puzzle_id: body.puzzleId, date_seed: dateSeed, difficulty, time_ms: timeMs, check_count: checkCount, grid: String(body.grid) };
    const saved = old
      ? await db(`scores?id=eq.${old.id}`, { method: 'PATCH', body: record, headers: { Prefer: 'return=representation' } })
      : await db('scores', { method: 'POST', body: [record], headers: { Prefer: 'return=representation' } });
    return send(res, 200, { accepted: true, score: saved?.[0] ?? record });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}

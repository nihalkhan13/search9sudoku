import { generatePuzzle } from '../js/core/Generator.js';
import { isSolved } from '../js/core/Solver.js';
import { dailyDifficulty } from '../js/core/rng.js';
import { ADMIN_USERNAME, db, readBody, ready, send, userFromRequest } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method === 'DELETE') return removeScore(req, res);
  if (req.method !== 'POST') return send(res, 405, { error: 'POST or DELETE required' });
  if (!ready()) return send(res, 503, { error: 'Online scores are not configured yet' });
  const user = userFromRequest(req);
  if (!user) return send(res, 401, { error: 'Sign in to submit a global score' });
  try {
    const body = await readBody(req);
    const difficulty = ['easy', 'medium', 'hard', 'extreme'].includes(body.difficulty) ? body.difficulty : 'medium';
    const checkCount = Math.max(0, Number(body.checkCount) || 0);
    const timeMs = Math.max(1, Math.round(Number(body.timeMs) || 0));
    const puzzleId = String(body.puzzleId ?? '');
    const isDaily = body.isDaily === true;
    const dateSeed = String(body.dateSeed ?? '');
    const puzzleSeed = isDaily ? dateSeed : String(body.puzzleSeed ?? '');
    if (!puzzleId || !/^[0-9]{81}$/.test(String(body.grid ?? '')) || !/^[a-zA-Z0-9:_.,-]{1,160}$/.test(puzzleSeed)) {
      return send(res, 400, { error: 'That score is missing a valid puzzle or solution grid' });
    }
    if (isDaily && (!/^\d{4}-\d{2}-\d{2}$/.test(dateSeed) || puzzleId !== `daily-${dateSeed}` || dailyDifficulty(dateSeed) !== difficulty)) {
      return send(res, 400, { error: 'That daily puzzle does not match today\'s verified puzzle' });
    }
    const puzzle = generatePuzzle({ difficulty, seed: puzzleSeed });
    if (!isDaily && puzzle.id !== puzzleId) return send(res, 400, { error: 'That practice puzzle could not be verified' });
    const grid = Int8Array.from(String(body.grid).split('').map(Number));
    if (!isSolved(grid, puzzle.arrows)) return send(res, 422, { error: 'That grid is not a valid solution' });

    const existing = await db(`scores?select=id,time_ms,check_count&user_id=eq.${user.id}&puzzle_id=eq.${encodeURIComponent(body.puzzleId)}&limit=1`);
    const old = existing?.[0];
    const improves = !old || checkCount < old.check_count || (checkCount === old.check_count && timeMs < old.time_ms);
    if (!improves) return send(res, 200, { accepted: false, reason: 'existing score is better' });

    const record = { user_id: user.id, puzzle_id: puzzleId, puzzle_seed: puzzleSeed, date_seed: isDaily ? dateSeed : null, difficulty, time_ms: timeMs, check_count: checkCount, grid: String(body.grid) };
    const saved = old
      ? await db(`scores?id=eq.${old.id}`, { method: 'PATCH', body: record, headers: { Prefer: 'return=representation' } })
      : await db('scores', { method: 'POST', body: [record], headers: { Prefer: 'return=representation' } });
    return send(res, 200, { accepted: true, score: saved?.[0] ?? record });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}

async function removeScore(req, res) {
  if (!ready()) return send(res, 503, { error: 'Online scores are not configured yet' });
  const user = userFromRequest(req);
  if (!user) return send(res, 401, { error: 'Sign in to remove a leaderboard score' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const scoreId = String(url.searchParams.get('scoreId') ?? '');
  const puzzleId = String(url.searchParams.get('puzzleId') ?? '');
  const isAdmin = String(user.username ?? '').toLowerCase() === ADMIN_USERNAME;
  if ((scoreId && !/^[0-9a-f-]{36}$/i.test(scoreId)) || (puzzleId && !/^[a-zA-Z0-9:_.,-]{1,160}$/.test(puzzleId))) {
    return send(res, 400, { error: 'That score reference is invalid' });
  }
  if (!scoreId && !puzzleId) return send(res, 400, { error: 'scoreId or puzzleId required' });

  try {
    const filters = [];
    if (scoreId) filters.push(`id=eq.${scoreId}`);
    if (puzzleId) filters.push(`puzzle_id=eq.${encodeURIComponent(puzzleId)}`);
    if (!isAdmin) filters.push(`user_id=eq.${user.id}`);
    const existing = await db(`scores?select=id,user_id,puzzle_id&${filters.join('&')}&limit=1`);
    if (!existing?.length) return send(res, 404, { error: 'That leaderboard score was not found' });

    const deleted = await db(`scores?id=eq.${existing[0].id}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    return send(res, 200, { deleted: true, admin: isAdmin, score: deleted?.[0] ?? existing[0] });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
}

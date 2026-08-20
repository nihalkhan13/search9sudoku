import { generatePuzzle, serializePuzzle } from '../js/core/Generator.js';
import { dailyDifficulty } from '../js/core/rng.js';
import { send } from './_lib/db.js';

export default async function handler(req, res) {
  const date = new URL(req.url, `http://${req.headers.host}`).searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const difficulty = dailyDifficulty(date);
  const puzzle = generatePuzzle({ difficulty, seed: date });
  const withoutSolution = { ...puzzle, solution: new Int8Array(81) };
  return send(res, 200, { id: `daily-${date}`, seed: date, dateSeed: date, difficulty, puzzle: serializePuzzle(withoutSolution) });
}

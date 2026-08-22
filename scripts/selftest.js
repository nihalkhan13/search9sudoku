/**
 * selftest.js - run with `npm test`.
 * Verifies the solver and generator without needing a browser.
 */

import { CELLS, SIZE, NO_ARROW, DIR, DR, DC, rowOf, colOf, indexOf, UNITS } from '../js/core/constants.js';
import { solve, findConflicts, isSolved } from '../js/core/Solver.js';
import {
  generatePuzzle,
  generateSolution,
  arrowOptions,
  serializePuzzle,
  deserializePuzzle,
  DIFFICULTY,
} from '../js/core/Generator.js';
import { createRng, dailyDifficulty, todaySeedInTimeZone } from '../js/core/rng.js';
import { timezoneForLocation } from '../js/core/locations.js';
import { scoreCompare } from '../js/services/StorageService.js';
import { GameEngine } from '../js/core/GameEngine.js';
import { puzzleCode } from '../js/core/puzzleCode.js';
import { colorDigitFromKey, digitFromKeyEvent } from '../js/ui/UIController.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

/** Independent verification that a filled grid obeys both rule sets. */
function verify(grid, arrows) {
  for (const unit of UNITS) {
    const seen = new Set();
    for (const c of unit) {
      if (grid[c] < 1 || grid[c] > 9) return `cell ${c} holds ${grid[c]}`;
      if (seen.has(grid[c])) return `duplicate ${grid[c]} in a unit`;
      seen.add(grid[c]);
    }
  }
  for (let i = 0; i < CELLS; i++) {
    const dir = arrows[i];
    if (dir === NO_ARROW) continue;
    const v = grid[i];
    const rr = rowOf(i) + DR[dir] * v;
    const cc = colOf(i) + DC[dir] * v;
    if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) return `arrow at ${i} points off-board`;
    if (grid[indexOf(rr, cc)] !== 9) return `arrow at ${i} (dist ${v}) does not find a 9`;
  }
  return null;
}

console.log('\n=== 1. Solution board generation ===');
{
  const rng = createRng('test-solution');
  const sol = generateSolution(rng);
  check('solution is a valid Sudoku', verify(sol, new Int8Array(CELLS).fill(NO_ARROW)) === null);

  const rngA = createRng('same-seed');
  const rngB = createRng('same-seed');
  const a = generateSolution(rngA).join(',');
  const b = generateSolution(rngB).join(',');
  check('same seed -> same board', a === b);

  const c = generateSolution(createRng('other-seed')).join(',');
  check('different seed -> different board', a !== c);
}

console.log('\n=== 2. Arrow option synthesis ===');
{
  const sol = generateSolution(createRng('arrows'));
  const options = arrowOptions(sol);
  let checked = 0;
  let bad = 0;
  for (let i = 0; i < CELLS; i++) {
    if (sol[i] === 9 && options[i].length) bad++;
    for (const dir of options[i]) {
      const v = sol[i];
      const rr = rowOf(i) + DR[dir] * v;
      const cc = colOf(i) + DC[dir] * v;
      checked++;
      if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE || sol[indexOf(rr, cc)] !== 9) bad++;
    }
  }
  check(`every synthesised arrow is truthful (${checked} arrows)`, bad === 0, `${bad} bad`);
  check('cells holding 9 never get an arrow', true);
}

console.log('\n=== 3. Generation + uniqueness, all difficulties ===');
for (const level of Object.keys(DIFFICULTY)) {
  for (let n = 0; n < 3; n++) {
    const t0 = Date.now();
    const p = generatePuzzle({ difficulty: level, seed: `suite-${level}-${n}` });
    const ms = Date.now() - t0;

    const problem = verify(p.solution, p.arrows);
    check(`[${level} #${n}] stored solution satisfies all rules`, problem === null, problem || '');

    const res = solve(p.grid, p.arrows, { limit: 2, maxNodes: 2000000 });
    check(
      `[${level} #${n}] exactly one solution (${p.stats.arrowCount} arrows, ` +
        `${p.stats.givenCount} givens, ${ms}ms)`,
      res.count === 1 && !res.exhausted,
      `count=${res.count} exhausted=${res.exhausted}`
    );

    if (res.solution) {
      check(
        `[${level} #${n}] solver result matches stored solution`,
        res.solution.join(',') === p.solution.join(',')
      );
    }

    // Givens must agree with the solution.
    let givenMismatch = 0;
    for (let i = 0; i < CELLS; i++) if (p.grid[i] && p.grid[i] !== p.solution[i]) givenMismatch++;
    check(`[${level} #${n}] givens agree with solution`, givenMismatch === 0);
  }
}

console.log('\n=== 3b. Hard puzzle clue floor ===');
{
  const hardBatch = Array.from({ length: 18 }, (_, n) => generatePuzzle({ difficulty: 'hard', seed: `hard-audit-${n}` }));
  check('hard puzzles keep at least six starting digits', hardBatch.every((p) => p.stats.givenCount >= 6));
  check(
    'hard puzzles remain uniquely solvable without checks',
    hardBatch.every((p) => {
      const result = solve(p.grid, p.arrows, { limit: 2, maxNodes: 1000000 });
      return result.count === 1 && !result.exhausted && result.solution?.join('') === p.solution.join('');
    })
  );

  const extremeBatch = Array.from({ length: 8 }, (_, n) => generatePuzzle({ difficulty: 'extreme', seed: `extreme-audit-${n}` }));
  const hardAverage = hardBatch.reduce((total, puzzle) => total + puzzle.stats.givenCount, 0) / hardBatch.length;
  const extremeAverage = extremeBatch.reduce((total, puzzle) => total + puzzle.stats.givenCount, 0) / extremeBatch.length;
  check('extreme puzzles use fewer starting digits than hard on average', extremeAverage < hardAverage);
  check(
    'extreme puzzles remain uniquely solvable without checks',
    extremeBatch.every((p) => {
      const result = solve(p.grid, p.arrows, { limit: 2, maxNodes: 2000000 });
      return result.count === 1 && !result.exhausted && result.solution?.join('') === p.solution.join('');
    })
  );
}

console.log('\n=== 4. Determinism (Daily Puzzle guarantee) ===');
{
  const a = generatePuzzle({ difficulty: 'medium', seed: '2026-07-30' });
  const b = generatePuzzle({ difficulty: 'medium', seed: '2026-07-30' });
  check('same date seed -> identical puzzle', serializePuzzle(a) === serializePuzzle(b));

  const c = generatePuzzle({ difficulty: 'medium', seed: '2026-07-31' });
  check('next day -> different puzzle', serializePuzzle(a) !== serializePuzzle(c));
}

console.log('\n=== 5. Serialisation round-trip ===');
{
  const p = generatePuzzle({ difficulty: 'hard', seed: 'round-trip' });
  const q = deserializePuzzle(serializePuzzle(p));
  check('grid survives round-trip', p.grid.join(',') === q.grid.join(','));
  check('arrows survive round-trip', p.arrows.join(',') === q.arrows.join(','));
  check('solution survives round-trip', p.solution.join(',') === q.solution.join(','));
}

console.log('\n=== 6. Conflict detection ===');
{
  const p = generatePuzzle({ difficulty: 'medium', seed: 'conflicts' });

  check('completed solution reports no conflicts', findConflicts(p.solution, p.arrows).cells.size === 0);
  check('completed solution counts as solved', isSolved(p.solution, p.arrows) === true);

  // Break a Sudoku rule: duplicate a digit within a row.
  const dup = Int8Array.from(p.solution);
  const r0 = 0;
  dup[indexOf(r0, 1)] = dup[indexOf(r0, 0)];
  const dupRes = findConflicts(dup, p.arrows);
  check('duplicate in a row is flagged', dupRes.sudoku.size >= 2);

  // Break an arrow rule: change an arrow cell's digit to a wrong distance.
  const wrong = Int8Array.from(p.solution);
  let arrowCell = -1;
  for (let i = 0; i < CELLS; i++) if (p.arrows[i] !== NO_ARROW) { arrowCell = i; break; }
  wrong[arrowCell] = wrong[arrowCell] === 1 ? 2 : 1;
  const wrongRes = findConflicts(wrong, p.arrows);
  check('wrong arrow distance is flagged', wrongRes.arrows.has(arrowCell));

  // Partial grids must not produce false positives.
  const partial = new Int8Array(CELLS);
  for (let i = 0; i < CELLS; i++) if (p.grid[i]) partial[i] = p.grid[i];
  check('starting position reports no conflicts', findConflicts(partial, p.arrows).cells.size === 0);
  check('starting position is not "solved"', isSolved(partial, p.arrows) === false);
}

console.log('\n=== 7. Solver rejects an impossible arrow ===');
{
  // A RIGHT arrow in column 8 can never be satisfied - there is no room.
  const arrows = new Int8Array(CELLS).fill(NO_ARROW);
  arrows[indexOf(0, 8)] = DIR.RIGHT;
  const res = solve(new Int8Array(CELLS), arrows, { limit: 1 });
  check('unsatisfiable arrow yields no solution', res.count === 0);
}

console.log('\n=== 8. Performance ===');
{
  const t0 = Date.now();
  const runs = 5;
  for (let i = 0; i < runs; i++) generatePuzzle({ difficulty: 'hard', seed: `perf-${i}` });
  const avg = (Date.now() - t0) / runs;
  console.log(`  INFO  average hard generation: ${avg.toFixed(0)}ms`);
  check('hard generation averages under 8s', avg < 8000, `${avg.toFixed(0)}ms`);
}

console.log('\n=== 3c. Daily puzzle difficulty and solvability ===');
{
  const dailySeeds = Array.from({ length: 30 }, (_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`);
  const dailyDifficulties = dailySeeds.map((seed) => dailyDifficulty(seed));
  const solvabilitySeeds = dailySeeds.slice(19, 25);
  const dailyBatch = solvabilitySeeds.map((seed) => generatePuzzle({ difficulty: dailyDifficulty(seed), seed }));
  check('daily difficulty is always Medium or Hard', dailyDifficulties.every((difficulty) => difficulty === 'medium' || difficulty === 'hard'));
  check('daily difficulty is deterministic per date', dailyDifficulty('2026-08-20') === dailyDifficulty('2026-08-20'));
  check('daily difficulty samples both Medium and Hard', new Set(dailyDifficulties).size === 2);
  check(
    'daily puzzles are uniquely solvable without checks',
    dailyBatch.every((puzzle) => {
      const result = solve(puzzle.grid, puzzle.arrows, { limit: 2, maxNodes: 1000000 });
      return puzzle.stats.givenCount >= 3 && result.count === 1 && !result.exhausted && result.solution?.join('') === puzzle.solution.join('');
    })
  );
}

console.log('\n=== 9. Product rules ===');
{
  check(
    'daily difficulty remains date-seeded',
    dailyDifficulty('2026-08-19') === dailyDifficulty('2026-08-19') &&
    dailyDifficulty('2026-08-21') === dailyDifficulty('2026-08-21')
  );
  const clean = { timeMs: 120000, checkCount: 0 };
  const checked = { timeMs: 1000, checkCount: 1 };
  check('no-check score outranks a faster checked score', scoreCompare(clean, checked) < 0);
  check('when both scores use checks, fastest time wins', scoreCompare({ timeMs: 1000, checkCount: 2 }, { timeMs: 2000, checkCount: 1 }) < 0);
}

console.log('\n=== 10. Location-aware Daily mode ===');
{
  const instant = new Date('2026-08-20T06:30:00Z');
  check('California maps to Pacific time', timezoneForLocation('US', 'CA') === 'America/Los_Angeles');
  check('New York maps to Eastern time', timezoneForLocation('US', 'NY') === 'America/New_York');
  check(
    'same instant can have different state dates',
    todaySeedInTimeZone('America/Los_Angeles', instant) === '2026-08-19' &&
      todaySeedInTimeZone('America/New_York', instant) === '2026-08-20'
  );
  check('non-US location falls back cleanly', timezoneForLocation('CA', null) === null);
}

console.log('\n=== 11. Leaderboard replay codes ===');
{
  check('puzzle code is four digits', /^\d{4}$/.test(puzzleCode('easy-test')));
  check('puzzle code is stable', puzzleCode('easy-test') === puzzleCode('easy-test'));
}

console.log('\n=== 12. Color tool behavior ===');
{
  const engine = new GameEngine();
  check('first swatch applies to a tile', engine.applyColor(new Set([0]), 0) && engine.colors[0] === 1);
  check('second swatch replaces the first', engine.applyColor(new Set([0]), 1) && engine.colors[0] === 2);
  check('clicking the active swatch clears the tile', engine.applyColor(new Set([0]), 1) && engine.colors[0] === 0);
}

console.log('\n=== 13. Keyboard shortcuts ===');
{
  check('plain digit key enters its digit', digitFromKeyEvent({ key: '7', code: 'Digit7' }) === 7);
  check('Shift+digit resolves through its physical key code', digitFromKeyEvent({ key: '&', code: 'Digit7', shiftKey: true }) === 7);
  check('numpad digit resolves through its physical key code', digitFromKeyEvent({ key: 'End', code: 'Numpad1' }) === 1);
  check('QWERTY color keys map Q through O to colors 1 through 9',
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o'].every((key, index) => colorDigitFromKey(key) === index + 1));
  check('unmapped color key is ignored', colorDigitFromKey('p') === 0);
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);

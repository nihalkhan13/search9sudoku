# Search Nine Sudoku

An interactive player and generator for **Search Nine**, a Sudoku variant where grey arrows
point at the 9 in their row or column, and the digit in the arrow's own cell is the distance
to that 9.

Runs entirely in the browser with no build step and no dependencies. The core engine is
plain ES modules with no DOM access, so the same solver that runs in the page can run in
Node — which is how the test suite works, and how a future server would grade submissions.

---

## Running it locally

```bash
npm start
```

Then open <http://localhost:5173>.

`npm start` runs `server.js`, a ~50-line zero-dependency static file server. Any static
server works just as well:

```bash
python3 -m http.server 5173
```

**Opening `index.html` directly from the filesystem will not work** — ES modules require an
`http://` origin. You need a server of some kind.

Run the engine test suite (no browser needed):

```bash
npm test
```

It checks solution validity, arrow-clue truthfulness, uniqueness across all three
difficulties, daily-seed determinism, serialisation round-trips, conflict detection and
generation performance.

---

## The rules

1. **Normal Sudoku.** Every row, column and 3×3 box contains 1–9 exactly once.
2. **Arrows.** A cell with a grey arrow points toward the digit **9** in that row
   (left/right arrows) or column (up/down arrows).
3. **Distance.** The digit written in an arrow cell is exactly how many cells away that 9 is.

An arrow pointing right holding a `3` means the row's 9 sits exactly three cells to its
right. Two consequences fall out of this and both are used by the solver:

- An arrow cell can never contain a 9 — the distance would be 0, which is not a digit.
- An arrow pointing right from column *c* proves no cell at column ≤ *c* in that row is a 9.

---

## Controls

| Action | Input |
|---|---|
| Select | Click, or click-and-drag across cells |
| Extend selection | <kbd>Shift</kbd> / <kbd>Ctrl</kbd> + click, or <kbd>Shift</kbd> + arrow keys |
| Enter a digit | <kbd>1</kbd>–<kbd>9</kbd> (press again to clear) |
| Corner marks | <kbd>Shift</kbd> + digit, or the Corner mode button |
| Centre marks | <kbd>Ctrl</kbd> + digit, or the Centre mode button |
| Colour a cell | Colour mode, then a digit key picks the swatch |
| Switch mode | <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd>, or <kbd>Space</kbd> to cycle |
| Clear | <kbd>Backspace</kbd> / <kbd>Delete</kbd> |
| Undo / redo | <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> |
| Show/hide cell colours | <kbd>H</kbd>, or the eye button |
| Dark mode | <kbd>D</kbd>, or the moon/sun button |
| Deselect | <kbd>Esc</kbd> |

Everything also works by touch, including drag-select.

---

## Project layout

```
index.html              markup: grid container, control panel, dialogs
server.js               static file server + notes on growing a backend
css/styles.css          all styling
js/
  main.js               entry point; game flow, autosave, victory
  core/                 no DOM access — runs in Node as-is
    constants.js        grid geometry, bitmask helpers, direction tables
    rng.js              seeded PRNG (this is what makes dailies deterministic)
    Solver.js           constraint propagation + backtracking; conflict finder
    Generator.js        solution boards, arrow synthesis, uniqueness-safe carving
    GameEngine.js       board state, pencil marks, colours, undo/redo
  services/
    StorageService.js   localStorage: saved game, stats, streaks, settings
    ApiService.js       the backend seam — stubs + the intended HTTP contract
  ui/
    UIController.js     rendering and all input handling
    Timer.js            pause/resume timer
scripts/selftest.js     engine test suite
```

### How generation works

1. **Sample an arrow-rich solution board.** A random solved grid only supports about 17
   legal arrow placements on average — for a given row, a RIGHT arrow works at column *c*
   only when that cell's digit happens to equal the distance to the row's 9. Since
   generating a board costs ~0.02 ms, the generator samples several hundred and keeps the
   most arrow-rich one, which lifts the count to roughly 30.
2. **Place every legal arrow.**
3. **Carve from a full board.** Start with all 81 digits revealed — trivially unique — then
   greedily remove digits, then arrows, re-checking uniqueness after every removal and
   putting anything back that was load-bearing.

Because carving only ever starts from a unique position and never accepts a step that
breaks uniqueness, **every generated puzzle has exactly one solution by construction**
rather than by luck. `npm test` verifies this independently.

Typical output (measured):

| Difficulty | Arrows | Given digits | Generation |
|---|---|---|---|
| Easy | ~30 | ~10 | ~15 ms |
| Medium | ~24 | ~5 | ~15 ms |
| Hard | ~18 | ~2 | ~25 ms |

Hard puzzles usually still need a couple of given digits: with only ~30 possible arrow
positions on a random board, arrows alone rarely pin a grid down. Tune the trade-off in
`DIFFICULTY` at the top of `js/core/Generator.js`.

### Daily puzzles

`todaySeed()` produces `YYYY-MM-DD`, which seeds the PRNG. Same date in, same puzzle out —
so every player gets an identical board with no server involved. The test suite asserts
this determinism.

---

## Taking it online

The project now includes a Vercel-ready online layer:

- `api/` contains account, daily puzzle, score, leaderboard, and friends endpoints.
- `supabase/schema.sql` creates the durable users, scores, and friendships tables.
- `vercel.json` configures the zero-build deployment.
- `DEPLOY.md` walks through GitHub, Supabase, and Vercel setup.

The browser remains local-first while those services are unconfigured. Once the
three server-only Vercel variables are set (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `SESSION_SECRET`), username accounts, verified
daily scores, global rankings, and friends leaderboards work across devices.

---

## Theming and cell colours

**Dark mode** is a single CSS override block. Every colour the UI paints comes from a token
declared in `:root`, and `:root[data-theme="dark"]` redefines the same names — no
component-level dark rules exist. `index.html` runs a small inline script that resolves the
theme *before* the stylesheet paints, so there is no white flash on load.

The `darkMode` setting is deliberately tri-state: `null` follows the OS (and keeps following
it live via `matchMedia`), while `true`/`false` is an explicit choice that sticks even if the
OS flips later.

**Hiding cell colours** (the eye button / <kbd>H</kbd>) never erases them. The colour layer is
always rendered and a single CSS rule stops it painting, so toggling back restores exactly
what you had — including multi-colour cells. In dark mode the pastel swatches paint at 42%
opacity (`--color-opacity`), because at full strength they would blow out the dark grid and
make the digits unreadable.

Cell state highlights (selection, peers, matching digits) are translucent so a colour
underneath still reads, and the selected cell additionally gets an inset ring so the
selection stays unmistakable even on a strongly coloured cell.

## Notes

- Progress autosaves continuously and is restored on reload, including the timer.
- The share button (🔗) puts the whole puzzle in the URL hash, so you can send a specific
  board to someone with no backend at all.
- Grid lines are drawn as an SVG overlay rather than as cell borders, so every cell stays
  exactly the same size regardless of how thick the 3×3 box lines are.
- The board fills the viewport on desktop; the control panel scrolls internally on short
  screens, and the whole layout stacks below 980 px.

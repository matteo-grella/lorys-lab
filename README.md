# Lory's Lab 🐦🧪

An original browser-based 2D physics contraption-puzzle game for ages 5+, in the
spirit of 1990s Rube Goldberg games like *The Incredible Machine*. Help Lory the
lorikeet inventor by building silly chain-reaction machines: deliver the berry to
her bowl, ring bells, pop balloons.

**Everything is original and generated in code** — all art is Canvas 2D paths
(no image files), all sound is synthesized at runtime with the Web Audio API
(no audio files), all 16 puzzles were designed for this game.

## Play

Open `dist/lorys-lab.html` in any modern browser. That's it — a single
self-contained file.

## Features

- **24-level campaign** with a gentle teaching curve: each early level teaches
  one part (plank → trampoline → seesaw → fan → dominoes → conveyor → bumper →
  magnet), later levels combine them into multi-step machines.
- **11 placeable parts**: plank, trampoline, seesaw, fan, magnet, dominoes,
  conveyor belt, bumper, balloon, bucket, beach ball & marble — plus bowls,
  bells, goal balloons, and a friendly cactus as level furniture.
- **The sleepy magnet**: bumps wake it, it pulls metal marbles for two seconds,
  then it gets tired and drops them — enabling two-stage crane puzzles.
- **Sandbox mode** with every part, for free building — including the
  machine shop: ropes (cuttable), scissors, candles, fuses that burn with a
  real flame front, directional fire hydrants (water pushes what wind can't,
  and douses flames), pressure switches that power fans/belts/magnets through
  a visible wire, a spring-loaded boxing fist, a fuse-fired cannon —
  drop a ball in the top hatch (the door snaps shut), light the fuse with
  any flame or beam, BOOM — one shot each, mirrors that bounce the laser
  beam around corners, a castle drawbridge lowered by dropping a weight on
  its pull-ring, and a basketball hoop with its own win signal (only
  basketballs count — try a cannon three-pointer). Every behavior and
  interaction is proven by the headless physics suite.
- **Puzzle maker**: build a scene in the sandbox, press 🧩, tap the parts the
  player should place (they fade into the future tray), press 💾 and name it.
  Saved puzzles persist and appear under "My puzzles" in the level select,
  where they can be replayed, edited (✎ reopens the scene in the sandbox and
  💾 updates it in place), or deleted. Pick the puzzle's ending when saving:
  feed Lory (berry + bowl), ring the bell, or score a basket (basketball
  required — hoops only count basketballs).
- **Cartoon speed effects** on rolling balls — motion trails, exaggerated
  spin, lean, dust puffs. Pure rendering; physics and solutions untouched.
- **Start fresh**: a reset button on the title screen erases all stars,
  unlocks, and created puzzles (with confirmation) while keeping settings.
- **iOS/Android**: see [`doc/IOS-APP-GUIDE.md`](doc/IOS-APP-GUIDE.md) for the
  Home-Screen and Capacitor app routes, including guaranteed native save
  persistence via the `window.LoryStorage` hook.
- **Secret lab key**: on the level-select screen, press the letter **L** five
  times (or tap the "Pick a puzzle!" heading five times) to unlock every
  level; repeat to lock again.
- **Age-adaptive difficulty**: Little Inventor (5+) gets unlimited hints and a
  free auto-hint after two tries; Big Inventor (8+) gets two hints per level.
  A skip option appears after repeated tries so nobody is ever hard-stuck.
- **Hints as ghosts**: the hint button shows dashed outlines of one working
  solution — the same data the automated verifier proves is winnable.
- **3-star sparkles** along the machine's path, win fanfares, confetti,
  squash-and-stretch, and Lory reacting to everything.
- Parts can be moved, rotated (buttons, `R`, or mouse wheel) and re-arranged
  freely at any time; they only lock while the machine is running.
- Progress, mode, and audio settings persist in `localStorage`.

## Engineering

- `src/core.js` — physics module over vendored [matter-js 0.20](vendor/matter.min.js)
  (MIT). Runs identically in the browser and in Node, which enables:
- `test/smoke.mjs` — 18 headless physics behaviour tests (every part mechanic).
- `test/verify.mjs` — proves every level (a) does not solve itself, (b) is
  beatable by its stored solution (which doubles as the hint ghosts), and
  (c) has all 3 sparkles on the winning path. **24/24 pass.**
- `src/render.js` — all art drawn in Canvas 2D per the visual spec (`design/`).
- `src/audio.js` — WebAudio synth: 21 SFX recipes + generative music-box loop.
- `src/game.js` — screens, drag-and-drop editor, run loop, saves.
- `build.mjs` — inlines everything into the single-file builds in `dist/`.

```
node test/smoke.mjs    # physics behaviour suite
node test/verify.mjs   # level solvability proofs
node build.mjs         # rebuild dist/
```

## For maintainers (human or AI)

**Read [`doc/MAINTAINERS-GUIDE.md`](doc/MAINTAINERS-GUIDE.md) before changing
anything.** It documents the architecture, every tuned physics constant and why
it has its value, the level solvability contract, the event system, and safe
step-by-step recipes for adding parts, levels, goals, and sounds.

## Design docs

`design/` holds the visual identity spec, audio spec, and level campaign JSON
produced during development.

## License

MIT — Copyright (c) 2026 Matteo Grella, Lorenzo Grella. See [LICENSE](LICENSE).
The vendored physics engine [matter-js](https://github.com/liabru/matter-js) is MIT-licensed by Liam Brummitt and contributors.

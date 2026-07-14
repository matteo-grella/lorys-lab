# Lory's Lab — Operating Manual (the part-builder's cookbook)

**Audience:** any developer or AI agent — including less capable models —
continuing this work. The [Maintainer's Guide](MAINTAINERS-GUIDE.md) is the
reference for what the game IS (architecture, part catalog, constants,
invariants). THIS document is the recipe for HOW to change it: the design
principles, the experiment-driven method, and the exact rituals that keep the
project green. Follow it mechanically. Where this manual says "MUST", a
skipped step has already caused a shipped bug at least once.

---

## 0. The prime directive: prove, don't believe

The physics core runs identically in the browser and in Node. This is the
project's superpower and your working method:

> **Never claim a mechanic works because the code looks right. Run a probe
> that shows it working. Then freeze the probe into a permanent proof.**

The workflow for EVERY behaviour change, no exceptions:

1. **Probe** — a throwaway `node -e "..."` script that builds a tiny scene
   with `Core.createSim`, steps it, and prints what happened (§6.1 template).
2. **Diagnose honestly** — when a probe fails, first suspect the PROBE
   (§6.5 lists the classic probe mistakes), not the game. Change game code
   only once you can say in one sentence *why* the behaviour is wrong.
3. **Freeze** — turn the working probe into a numbered proof in
   `test/smoke.mjs`: one happy path + one "doesn't do what it shouldn't".
4. **Look at it** — if you touched a painter, screenshot it (§6.2). You may
   not ship art you have not seen. (The laser cannon shipped as an unreadable
   brick because this step was skipped once. Never again.)
5. **Ship ritual** — §7. Tests, guide sync, SW bump, build, commit.

---

## 1. Design principles for new parts

### 1.1 The one-sentence test
Every part must be explainable in ONE short Lory sentence (it literally goes
into `PART_INFO` in game.js, spoken by the bird via the ? button). If you
cannot write that sentence, the part is too complicated — split it or
simplify. Example: *"It focuses light! Put it near a glowing bulb and out
comes a laser beam."*

### 1.2 Composability is the product
A new part earns its tray slot only if it meaningfully interacts with at
least TWO existing systems. The systems are:

| system | carriers | how to join it |
|---|---|---|
| gravity & collision | every solid body | collisionStart handlers, restitution/friction |
| wind | fan | react in the fan's `Query.region` block (respect the berry rule!) |
| magnetism | magnet ↔ `ball_marble` only | `lab` flag, never type-name checks |
| fire | candle/match flames, fuse fronts | join the `flames` array or be flammable (checked against flame points) |
| water | hydrant jet | douse/push blocks in the hydrant region loop |
| light beam | laser, lens (via bulb) | `castBeam` affects you, or you emit/block/feed beams |
| cutting | scissors, flame, beam | have a string (rope/tether pattern) or cut strings |
| triggering | bump, touch, face-button, switch wire, plate | pick from the trigger vocabulary (§1.3) |
| scoring | sparkles, goals | sensors + `state` counters |

When you add a part, walk this table and write down every interaction you
are choosing to have — and every one you are deliberately NOT having. Both
lists go in the part's guide table row.

### 1.3 Trigger vocabulary (reuse, don't invent)
- **bump** (`relSpeed >= 1.6`, cooldown): hydrant, magnet, match, bulb button
- **any touch** (cooldown, no speed gate): scissors, laser
- **face-specific contact** (local-coords check): fist glove/plunger, bulb
  button (`dirVector` + along/across test — copy that block)
- **switch-wired** (`switchControlled` + `poweredNow`): fan, conveyor,
  magnet, hydrant, laser, bulb — add your type to the wiring list in
  `createSim` if it makes sense
- **flame proximity** (`FLAME_R`-ish, forgiving): candle/match ignition
- **beam crossing** (`distPointSeg < 20`): candle/match/fuse via `castBeam`
- **always-on with optional initial state** (`spec.on !== false`): fan

### 1.4 State vocabulary
- one-shot & spent (match, cannon) · timed burst (hydrant, magnet, laser)
- toggle (bulb) · powered-while (all switch loads)
- **author-settable initial state**: candle `lit`, fan `on`. ⚠️ Each such
  boolean consumes one wire-format "extra" slot and parts have AT MOST TWO,
  one per kind (dir string, angle number, `false` flag). dir + angle fits —
  the cannon does exactly that (its "angle" is barrel elevation, the body
  never rotates) — but a part needing dir + angle + a flag, or two boolean
  flags, means real format work — think before you commit to that (§4.4 of
  the guide, "Puzzle sharing").

### 1.5 Kid rules (non-negotiable)
- **Teaching invariants stay true**: berries never blown by wind; only
  marbles feel magnets; bowls only count berries. Never "fix" these.
- **Forgiving tolerances**: ignition/interaction radii ~20px, not 5. Little
  fingers, big targets (44px+ touch UI).
- **Visible cause → effect**: every state change emits an event, and every
  event gets a sound AND a visual (or a written decision that one side is
  deliberately silent — record it in the guide's event table).
- **No hidden state**: off-fan has still blades; spent match is charred;
  armed laser breathes light. If the state doesn't LOOK different, kids
  think the game is broken.
- Text: Lory speaks first-person, action-first, one idea per sentence.

---

## 2. The layer checklist for a new part

Touch the layers in THIS order. Do not skip; do not reorder. (Extends the
guide's recipe 11.1 with everything learned since.)

1. **`core.js PART_DEFS`** — size, `static`, `placeable`, `rot` OR `dir`
   (both only if the part needs no third extra — the wire format holds two,
   one per kind; the cannon is the precedent, and note its `angle` is barrel
   elevation, not body rotation, which costs special-casing in
   `rotateSelection`, the wheel handler, `drawGhost` and `drawSelection`).
   Body should
   hug the visual silhouette (the laser was resized 60×44→44×56 for this).
2. **`core.js MATERIAL`** — pick the impact-sound class (wood/marble/
   magnet/rubber/…). Metal-ish machine → `'magnet'`.
3. **Constants** — new named constant per behaviour number
   (`LENS_REACH 220` style). NEVER reuse or change an existing constant for
   a new part (guide 11.3: they are globally coupled to 24 level solutions).
4. **`makePart` case** — build the body/bodies, `tag(...)` every one, put
   mutable state in the tag's second arg (`{ lens: { firing: 0 } }`).
   Sensor-only body? You MUST add its type to the `hitPlacement` sensor
   exception in game.js or it can never be selected again (fuse/sparkle
   precedent).
5. **Triggers** — a block in the `collisionStart` handler, using `lab()`
   (never `body.plugin.lab` there — compound parents!), with a cooldown
   sized to the trigger's physical cadence: 20 frames absorbs one landing's
   contact-rattle while letting a re-bounce re-press (bulb lesson: 45 was
   too long and swallowed real presses).
6. **Behaviour block** in `applyBehaviours`, inserted in the canonical
   order: switch scan → device gating → fan/magnet/balloon → conveyor →
   hydrant → fuse advance → match burn-down → flame collection → flame
   effects → scissors → laser beam → bulb tick → lens feed → fist cooldown.
   Continuous field/beam work belongs here, not in collision handlers.
7. **Quiescence guard** — if your part being "active" means the world will
   still change (burning fuse, flaring match, spraying hydrant, firing
   laser/lens), add it to `isQuiescent()` or the sandbox autostop will cut
   your show short. If active-but-static (lit bulb, awake magnet), do NOT
   guard it.
8. **Events** — one producer (core), BOTH consumers (audio + render) handle
   or deliberately ignore each new event, AND the guide's §4.5 table plus
   the core→audio contract row get the new names. Grep for one existing
   event (`water_on`) to find every place.
9. **Painter** (`render.js painters`) — draw centered at origin in the
   LOCAL frame (rotation is applied outside). MUST be body-null-safe
   (`body ? body.plugin.lab.foo : {defaults}`) — tray icons and drag ghosts
   call it with `body = null`. Palette tokens only, outline 2px, one charm
   detail, one motion touch. Every distinct physics state needs a distinct
   look (§1.5). Then SCREENSHOT IT (§6.2) at multiple rotations/states and
   actually look before shipping.
10. **`game.js SANDBOX_TRAY`** — `[type, count]`. The tray paginates
    automatically; still update the "N entries/wells" counts in the guide.
11. **Selection buttons** — if the part has an author-settable state, add
    the toggle in `drawSelection` (icon shows what tapping DOES) + handler
    in the selection-button dispatch. All parts get ? for free.
12. **`PART_INFO`** — the one Lory sentence (§1.1).
13. **Wire format** — dir/rot/lit-style extras are handled generically;
    verify by adding your part to the roundtrip fixture in
    `test/puzzlecode.mjs`. A brand-new FLAG needs codec work: extend
    `puzzleExtras`/`puzzleCheckPart` symmetrically + reject-tests.
14. **Smoke proofs** — minimum three: happy path, "doesn't do what it
    shouldn't" (idle/dark/blocked variant), and one cross-part interaction.
    Number the section, keep the terse PASS-line style.
15. **Guide sync** — part table row (size, trigger, constants, events),
    events table, tray counts, proof counts. §7's grep ritual catches
    stragglers.
16. **Ship** — §7.

---

## 3. Choosing physics properties

Start from the nearest sibling in this table (guide §4.1 has the full one),
then probe. Never invent numbers from theory.

| you want | copy from | key values |
|---|---|---|
| a light blowable ball | ball_beach | density 0.0006, restitution 0.72 |
| a heavy slammer | ball_marble | density 0.006, restitution 0.12 |
| a hero-like roller | berry | density 0.0015, restitution 0.3 |
| a floater | balloon | density 0.0004 + per-frame buoyancy force |
| a static machine | any machine | `isStatic: true`, friction 0.2–0.4, restitution 0.1–0.2 |
| a tippable prop | domino | density 0.002, friction 0.2 (load-bearing!) |
| a pass-through zone | fuse/sparkle | `isSensor: true` (remember checklist #4!) |

Tuning method:
- Drop/launch the body in a probe and log `position` every 30 frames
  (guide 11.2 step 3 has the loop). Judge by numbers, not vibes.
- Respect the quiescence envelope: anything meant to keep acting must
  either keep bodies moving (speed ≥ 0.25 px/f) or carry a quiescence
  guard, or the run "settles" (campaign) / autostops (sandbox, 90 quiet
  frames = 1.5s).
- Forces: fans/hydrants scale force by `min(mass, cap) × falloff` — copy
  that pattern so heavy things resist fields naturally.
- The **don't-touch list** (guide invariant 4): domino friction, trampoline
  boost, bell/pop thresholds, magnet timings. If your probe only passes
  after changing one of these, your design is wrong, not the constant.

---

## 4. Sound: designing a part's voice

Architecture (guide §8 for depth): `audio.js` is 100% synthesized WebAudio.
One-shots live in `RECIPES` (name → function building oscillators + noise);
continuous sounds are refcounted **loops** (`startLoop/stopLoop`); events
from the core are mapped in `handleEvents`.

Recipe for a new one-shot:
1. Describe the sound in words first: attack (click? scratch?), body
   (tone? sweep? noise?), tail (ring-out? none?). Keep impacts < 0.3s.
2. Build it from the house ingredients: `tone(t, wave, freq, dur, vol,
   attack, detuneCents)` for pitched bodies, `noiseHit(t, dur, filterType,
   freq, Q, vol)` for texture, frequency ramps for sweeps ("PEW" = sawtooth
   1500→210Hz over 0.16s), `shot(...)` to schedule cleanup.
3. **Detune every trigger** with `rnd(...)` so repeats never sound
   machine-gun identical (house rule — every existing recipe does it).
4. Wire it: event case in `handleEvents` (core events) or `A.sfx('name')`
   (UI). Reuse existing voices where the meaning matches: bulb clicks
   reuse the switch's clicks; the lens reuses the laser zap — same meaning,
   same sound keeps the vocabulary small for kids.
5. Loops: start/stop ONLY from events (`fan_on/off`, `water_on/off`
   pattern) — never from `startLoops()` except the catch-up-on-sfx-re-enable
   path. Every run-ending path already force-stops all loops (invariant 7);
   don't add new loop lifecycles outside that.
6. `node test/audio-shape.mjs` must stay green (API surface + pre-unlock
   safety).

---

## 5. Look & feel — Lory, the toy-box style, and editor UX

The deep normative spec is [`design/visual-spec.md`](../design/visual-spec.md)
(full 16-color palette with contrast guarantees, per-part drawing recipes,
Lory's construction in ~40 canvas statements). This section is what you must
internalize before drawing anything.

### 5.1 Lory the lorikeet (the bird)

Lory is 100% code — `drawLory(ctx, pose, t, opts)` in render.js paints her
into a 100×100 box, facing right, layer by layer: three swaying tail
feathers (leaf/sunny/sky rounded rects), a `leaf` body ellipse clipped with
a `tangerine` chest and `poppy` bib, a pose-driven wing, `tangerine` feet,
a `loryBlue` head circle with a `blossom` cheek, a `poppy` teardrop beak
with a `paper` glint, a white eye whose `ink` pupil looks toward the beak —
and her signature charm: **aviator goggles pushed up on her forehead**
(`woodDark` rims, `sky` lenses). She's an inventor bird.

**Poses are transforms of ONE recipe — never redraw new art.** Each pose is
a body transform + wing rotation + pupil offset:
- `idle` — gentle 2.4s bob, blink every ~3.2s
- `think` — head tilts −8°, wing raised to the chin, pupils up-left
- `cheer` — 12px hops at 6Hz, 1.08 vertical stretch, wing thrown up
- `oops` — squashed 1.10×0.85 and dropped 8px, wing drooping

A new pose = a new parameter set for those knobs (plus eye/wing tweaks),
about ten lines. If you find yourself drawing new bird anatomy, stop.

Where she appears: the corner mascot on the game screen (with the
`drawBubble` speech bubble), the title screen, the win overlay, and even
the PWA app icons — all the same function at different scales.

**Lory IS the UX voice.** Hints, part explanations (?), warnings, failure
("oops" pose + an encouraging line) and success (cheer) all speak through
her. Rules: failure/danger is communicated by her reaction, never by harsh
visuals; anything narrative or instructional goes in her bubble via
`setLory(pose, text, secs)`; terse status uses `toast()`. She speaks
first-person, action-first, one idea per sentence, child-readable.

### 5.2 The toy-box visual rules

- **Zero binary assets**: all art is Canvas 2D paths + the 16 palette
  tokens (`C.*` in render.js). No pure black or gray anywhere — `ink`
  (#43342B, warm dark brown) is the darkest value.
- **Palette semantics** (use meaning, not taste): `loryBlue` interactive /
  primary · `leaf` go / success · `poppy` stop / danger / delete · `sunny`
  reward & attention (stars, tray arrows) · `tangerine` warm accents &
  toggles · `sky` glass / water / cool · woods for furniture · `paper`
  surfaces. `sunny` and `sky` are fill-only, never text on cream.
- **Toy rules** for every part: 2px `C.outline` outline, ground shadow,
  corner radius ≥ 6px, no interior angle a child could read as "pointy",
  ONE charm detail (a star bolt, a flower, a glint), ONE motion touch
  (driven by the `anim` map or `o.t`), and a visibly distinct look per
  physics state (§1.5).
- **Juice is render-only**: squash & stretch, screen shake, ball trails,
  dust, and the particle pool never touch physics — level proofs must be
  unaffected by anything visual.

### 5.3 UI/UX interaction style

- **Two worlds**: the board + tray are canvas; screens, dialogs, and the
  topbar are DOM styled by the toy-block CSS system in index.html —
  `.chip` pill buttons, `.big` candy buttons, `.card` level tiles, all in
  the `ui-rounded` font stack, bold, ≥ 44px touch targets.
- **Physical buttons**: the signature style is a hard bottom-edge shadow
  (`box-shadow: 0 5px 0 <darker>`); `:active` translates the button down
  3px and removes the shadow — it visibly "presses". Reuse this on any new
  control (the tray's ‹ › arrows draw the same idea on canvas).
- **Kid-flow heuristics**: one primary action per screen; no confirmation
  dialogs except destructive ones (delete uses the two-tap "✕ → Sure?"
  pattern, no modal); everything reversible; errors always speak kid
  language through Lory, never technical text.
- **Dialogs** painted into `.overlay-root` MUST close via
  `showScreen(S.screen)` — it owns both the content and pointer-events. A
  bare `innerHTML='' + pointerEvents='none'` strands the screen (shipped
  bug). Give every dialog three exits: corner ✕ (44px), dim-click, Escape.
- **Selection buttons**: add ids to the `drawSelection` list and the
  pointerdown dispatch; icons show the ACTION, not the state.
- **The tray paginates** past ~15 wells; never shrink wells below 64px.
- **User text** (puzzle names): render via `textContent` or canvas only;
  foreign puzzle data enters ONLY through `puzzleCode.decode` (invariant 16).
- **Phase guards**: every new button/entry point checks `S.phase` /
  `S.pluckMode` (guide 11.6 lists the historical bugs).

---

## 6. The experiment harnesses (copy-paste these)

### 6.1 Headless behaviour probe
```bash
node -e "
const Core = require('./src/core.js');
const sim = Core.createSim({ goalType: 'bell', fixed: [
  { type: 'bell', x: 1200, y: 100 },        // unreachable goal = neutral scene
  /* your fixture parts */
] }, [ /* placements */ ]);
const evs = [];
for (let f = 0; f < 400; f++) for (const e of sim.step()) evs.push(e.type);
// inspect part state directly:
const m = sim.parts.find(p => p.spec.type === 'lens').bodies[0].plugin.lab;
console.log('events:', evs.join(','), '| state:', JSON.stringify(m.lens));
"
```
Use `Core.simulate(level, placements, {maxSeconds, collectEvents})` when you
only need won/settled/events. 60 frames = 1 second.

### 6.2 Visual review (REQUIRED for painters)
Write a scratch HTML that loads `vendor/matter.min.js`, `src/core.js`,
`src/render.js` via absolute `file://` paths, creates the sim with your part
in several states/rotations (force internal state directly:
`part.bodies[0].plugin.lab.lens.firing = 5`), calls `R.init(canvas)` +
`R.draw({sim, tray: null, lory: {pose:'idle'}, cam: {z:1,x:0,y:0}, t: 1.2,
dt: 1/60, uiBoost: 1, running: true})` once, then:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --disable-gpu --screenshot=look.png --window-size=1400,900 --hide-scrollbars \
  "file://$PWD/look.html"
```
Open the PNG. Ask: does it read at ANY rotation? Do on/off states differ?
Does it sit in the family style next to a fist/hydrant? Iterate until yes.

### 6.3 Full-game E2E (flows, dialogs, input)
Copy `index.html`, inject after `<head>`: a `<base href="file:///abs/repo/">`
plus a seed script (set `localStorage['lorys-lab-save-v1']` BEFORE game.js
loads, and the rAF polyfill). Append a driver script; run headless Chrome
with `--virtual-time-budget` and `--dump-dom`, grep your result div. The
four traps and the polyfill line are in the guide §6 ("bare headless
Chrome") — read them before writing a driver; every one of them has burned
a session. Assert REAL clickability with `document.elementFromPoint`;
`element.click()` lies about pointer-events.

### 6.4 Smoke proof template
```js
// NN. One-line statement of the mechanic being pinned.
{
  const level = { goalType: 'bell', fixed: [ /* minimal scene */ ] };
  const idle = Core.simulate(level, [], { maxSeconds: 6 });
  check('does nothing without its trigger', !idle.won && idle.settled);
  const r = Core.simulate(level, [ /* the trigger */ ], { maxSeconds: 8, collectEvents: true });
  check('does its job when triggered', r.won && r.events.some(e => e.type === 'my_event'), `t=${r.seconds}s`);
}
```

### 6.5 Classic probe mistakes (check these BEFORE blaming the game)
- **Balloons float away** while your trigger is still falling — use a
  tethered `balloon_goal` at bob height, or time your beam/flame for where
  the balloon actually IS.
- **Spawns overlapping other bodies** (a ball clipping a rope anchor or
  sitting on the machine you meant to trigger) deflect trajectories.
- **Off-by-a-few-px tolerances**: flame/beam radii are ~14–28px; place
  probe targets well inside, not at the boundary.
- **Resting bodies fire `collisionStart` once** — a resting ball cannot
  re-press a button; a bouncing `ball_beach` can (bounce period ~30 frames).
- **Rolling balls barely decelerate** (circles have no rolling friction):
  scenes meant to FAIL should seat bodies so nothing moves, or they take
  ages to settle.
- **Seating formula**: resting ball `y = surface_top − r − 1`; part standing
  on the floor `y = 690 − h/2`.

---

## 7. The ship ritual (every change, in order)

```bash
node --check src/*.js
node test/smoke.mjs        # N/N — grow N, never shrink
node test/verify.mjs       # 24/24 ALWAYS (campaign is sacred)
node test/puzzlecode.mjs   # if core/codec touched
node test/audio-shape.mjs  # if audio touched
```
1. **Guide sync** — update: part table row, events table, tray/proof
   counts, constants you added. Then grep the guide for every NUMBER your
   change made stale (`grep -n "68 physics\|31 entries\|..."`). The guide
   lies to the next agent if you skip this.
2. **Bump `sw.js`** cache version (`lorys-lab-vN` → `vN+1`) — this is what
   makes deployed players receive the update.
3. **`node build.mjs`** — regenerates `dist/` (committed!).
4. **Commit**: subject = what changed for players; body = why + what was
   verified + proof counts + `SW vN`. No Claude co-author line. Push.
5. If it's a feature the user can feel, say what to try; if you deferred
   anything, say so explicitly.

---

## 8. Worked example: the bulb + lens (how a session actually goes)

Condensed from the real build — imitate this shape:

1. **Design against §1**: bulb = toggle-state part, button trigger with a
   face (`dir`), switch-wireable; light harmless alone. Lens = converter:
   lit bulb within reach + line of sight → the SAME beam as the laser
   (reuse `castBeam`, don't fork it). One-sentence test passes for both.
   Interactions chosen: beam system, switch system, occlusion (walls block
   light). Rejected: light igniting things directly (lens must matter).
2. **Core first**, checklist #1–8. Beam engine extracted to `castBeam`
   rather than copied — shared behaviour must have one home.
3. **Probes**: four scenes (button toggle, lens fires, wall blocks, switch
   drive). Two FAILED — and both were probe geometry (balloon had floated
   above the beam; the test bulb sat on its own switch). Diagnosed as §6.5
   cases, fixture fixed, probes green. THEN one real tuning bug surfaced:
   the button cooldown (45) swallowed bounce re-presses → cooldown 20,
   probed again: `bulb_on,bulb_off`.
4. **Freeze**: 7 smoke proofs (idle, toggle, side-face rejected, dark-lens,
   chain, occlusion, switch-wire).
5. **Painters** + screenshot at 4 rotations, off/on/firing/fed states; the
   golden feed-ray was added because the first screenshot didn't show WHY
   the lens fired.
6. **Shell**: tray entries, PART_INFO sentences, guide rows/tables/counts,
   SW bump, build, commit with proof counts, push.

Total: ~6 probe scripts, 2 screenshots, 7 permanent proofs, 1 refactor,
0 constants changed. That ratio — many experiments, few code changes —
is what "working properly" looks like here.

---

## 9. When you are stuck

- Re-run the LAST green state (`git stash` / `git checkout -p`) and re-apply
  in smaller steps; the matrix is fast, use it between steps.
- Guide 11.7 is the debugging playbook (symptom → first moves).
- A failing NEW probe = suspect the probe (§6.5). A failing OLD proof =
  you broke a behaviour someone depends on; do not edit the old proof to
  pass unless you can argue the behaviour change is the point of your work
  — and then the guide and the commit message must say so out loud.
- Never `git push --force`, never rewrite `levels.js` by hand (it's
  generated data), never bypass `puzzleCode.decode` for foreign data.

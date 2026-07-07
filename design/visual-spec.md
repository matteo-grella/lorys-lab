# Lory's Lab — Visual Identity Spec v1.0

Everything below is drawn in Canvas 2D at runtime. No image assets. Reference resolution 1280x720 logical px, scale by `devicePixelRatio`. One shared rule set first, then the deliverables.

**Global toy rules (apply to every part unless overridden)**
- No pure black, no pure gray. Darkest value is `ink` (#43342B).
- Every physics part gets a 2px outline of `rgba(67,52,43,0.35)` and a ground shadow: ellipse under the part, `rgba(67,52,43,0.12)`, width = part width x 0.9, height 8px.
- Minimum corner radius 6px. No interior angle sharper than 60 degrees anywhere a child could read it as "pointy".
- Static parts are pre-rendered once to offscreen canvases and blitted; only animated overlays redraw per frame.

---

## 1. Palette (16 colors)

| Token | Hex | Role |
|---|---|---|
| `wallCream` | `#FBF1DE` | Board background, gradient top |
| `wallPeach` | `#F5DFC3` | Board background, gradient bottom |
| `woodLight` | `#EABF85` | Plank faces, tray body, floor |
| `woodMid` | `#C9915A` | Wood shading, skirting, pots |
| `woodDark` | `#8F6238` | Wood grain, brackets, goggle rims |
| `ink` | `#43342B` | Primary text, pupils, outlines |
| `inkSoft` | `#8C7A6B` | Secondary text, strings, screws |
| `paper` | `#FFF9EE` | UI surfaces, dominoes, highlights |
| `loryBlue` | `#4E86E0` | Primary accent: Lory's head, buttons, hints |
| `blueDeep` | `#3563B8` | Button undersides, pressed states |
| `sunny` | `#FFC53D` | Stars, bell, bolts, hint bulb |
| `tangerine` | `#FF8E3C` | Lory's chest, reset button, warm accents |
| `poppy` | `#E8563F` | Danger/stop, bumpers, Lory's bib and beak |
| `leaf` | `#5FB358` | Success/play, wings, cactus |
| `sky` | `#7CC7E8` | Marble, bucket, balloons, goggle lenses |
| `blossom` | `#F2A0BD` | Balloons, cheeks, cactus flower |

Utility alpha token: `shadow = rgba(67,52,43,0.12)`.
Contrast guarantees: `ink` on `paper`/`wallCream` is ~9.5:1 (body text safe). `paper` text on `loryBlue`, `leaf`, `poppy` all >= 3.4:1 at bold 18px+ (UI labels are always bold). Never put `sunny` or `sky` text on cream — those two are fill-only.

---

## 2. Lory the Lorikeet

Drawn facing right in a 100x100 box, origin top-left; scale via `ctx.scale`. Layer order = list order. This is the whole bird in ~40 statements:

```
1  tail: 3 rounded rects 8x26 r4, anchored (30,70), rotated -25/0/+25 deg
       pointing down-left; fills: leaf, sunny, sky (back to front)
2  body: ellipse c(50,62) rx26 ry30, fill leaf
3  save + clip(body path)
4    chest: ellipse c(58,68) rx16 ry20, fill tangerine
5    bib:   ellipse c(60,54) rx13 ry11, fill poppy
6  restore
7  wing (pivot 40,50; rotation = pose): ellipse c(38,62) rx12 ry18
       rotated -15 deg, fill leaf, then refill same path rgba(67,52,43,0.15)
8  feet: 2 rounded rects 6x8 r3 at (42,88) and (54,88), fill tangerine
9  head: circle c(62,34) r19, fill loryBlue
10 cheek: circle c(57,41) r4, fill blossom @ 0.6
11 beak: teardrop — moveTo(76,32), quad to (90,36), quad to (76,42),
       close via quad through (73,37); fill poppy; glint circle (80,34) r1.5 paper
12 eye: circle c(67,30) r5.5 fill paper; pupil circle r2.8 fill ink,
       offset (+1.5,+0.5) toward beak; glint circle r1 paper at (65,28)
13 goggles (on forehead): strap line ink 3px along arc y~20 across head;
       lenses: circles r7 at (56,18) and (70,19), fill sky @ 0.45,
       stroke woodDark 2.5px; rivet dots sunny r1.2 at outer edges
14 outline: stroke head + body silhouette rgba(67,52,43,0.3), 2px
```

**Poses** (transform the recipe, never redraw new art):

| Pose | Recipe |
|---|---|
| **Idle blink** | Body bobs `y += 1.5*sin(t/2.4s)`. Tail group sways rotate +-3 deg, same period, 0.3s phase lag. Blink every 3.2s: draw a `loryBlue` circle clipped to the eye, sliding down to cover it for 120ms. |
| **Thinking** | Head group rotates -8 deg about neck (58,45). Pupils offset up-left (-2,-2). Wing pivots to -100 deg so the tip touches the beak. Three `paper` circles r3/r4/r5 rise diagonally above the head, each fading in over 400ms, looping. |
| **Cheer (win)** | Draw wing twice, rotated -150 and mirrored +150 (both up). Eyes become happy arcs: ink 3px, arc r5 from 200 to 340 deg (closed-smile eyes). Add lower-beak wedge (open beak). Body `scaleY 1.08`. Hop: `y -= 12*|sin(t*6)|` for 1.2s. Sparkle stars (Sec. 3.18) pop around him. |
| **Oops (lose)** | Body squash `scaleX 1.10, scaleY 0.85`. Goggles translate down 12px onto the eyes, group rotated 12 deg (askew — comedic, not sad). Eyes r6.5 paper with tiny r1.5 pupils dead center. Wings droop rotate +40 deg down. One `sky` teardrop 4x6 slides down the temple over 800ms. Small dust poof at feet. |

---

## 3. Part Specs

Nominal sizes at 1x zoom. "Charm" = the one detail that makes it a toy. "Motion" = its one animation touch.

**3.1 Plank** — 180x24, rounded rect r8. Vertical gradient `woodLight -> woodMid` (last 30%). Grain: 2 horizontal wavy strokes, `woodDark` @ 0.25, 1.5px, amplitude 2px. Charm: one knot — circle r4 `woodDark` @ 0.35 with a half-arc ring around it. Motion: on placement, drops in with 0.9/1.1 squash and a dust poof; otherwise static (cache it).

**3.2 Trampoline** — 140 wide. Legs: two rounded rects 10x34 `woodMid`, splayed 12 deg. Mat: rounded rect 140x14 r7, fill `loryBlue`, top edge stroke `blueDeep` 2px. Springs: 3 tiny zigzags each side, `inkSoft` 2px. Charm: stitched border — `paper` dashed line `[5,4]` inset 3px along the mat. Motion: on impact the mat's mid-edge becomes a quadratic curve dipping up to 10px (scaled by impact speed), rebounding with two decaying overshoots over 300ms; a sparkle star at strong bounces.

**3.3 Seesaw** — plank spec at 200x18 on fulcrum: rounded triangle 44x36, fill `woodDark`, r8 corners. Charm: pivot bolt — circle r6 `sunny`, ink cross-slot 2px. Motion: rotation eased (spring, damping 0.85); hitting the rotation limit fires a 1-frame 4% squash on the plank plus a dust puff at the touching end.

**3.4 Fan** — base: rounded rect 36x20 `woodMid`; casing: circle r26 `sky`, inner circle r22 `paper` @ 0.25. Blades: 3 rounded petals (ellipse rx14 ry6) around a `sunny` hub r5, fill `paper`, drawn rotated. Charm: power light — `leaf` dot r2.5 on the base, blinking 1s when on. Motion: blades spin 540 deg/s when on, ease-out spin-down over 700ms when off; 3 airflow streamlines (`paper` @ 0.5, 2px, dash `[10,8]`) with scrolling dash offset in the wind zone.

**3.5 Domino** — 22x60 rounded rect r6, fill `paper`, stroke `ink` @ 0.35 2px, midline stroke same. Pips: `loryBlue` dots r3.5 (top 2, bottom 3). Charm: the center bottom pip is a tiny `sunny` 4-point star instead of a dot. Motion: 3% squash toward contact normal for 80ms on each clack; small dust poof when it settles.

**3.6 Beach ball** — circle r26. Six wedge panels via arcs from center, alternating `poppy, sunny, leaf, sky, blossom, paper`; polar cap circle r7 `paper` at the rotation pole. Charm: glossy glint — ellipse rx7 ry4 `paper` @ 0.8 at upper-left, fixed in screen space. Motion: panels rotate with physical roll; 12% squash along the contact normal on bounce, restored via spring in 160ms. The glint does NOT rotate.

**3.7 Marble** — circle r14, radial gradient (offset light: center at upper-left third): `paper -> sky -> blueDeep`. Interior: one `loryBlue` @ 0.5 ribbon arc (candy swirl), rotates with roll. Charm: fixed glint — circle r3 `paper` + satellite dot r1. Motion: above 400px/s add 2 trailing motion streaks (`sky` @ 0.3, fading over 120ms); glint stays light-locked for glossiness.

**3.8 Conveyor** — capsule 200x28. Body fill `woodMid`; belt = capsule outline stroke `woodDark` 10px; tread = `paper` dashes `[6,10]` 4px stroked along the same path, dash offset scrolled at belt speed. End wheels: circles r10 `sunny` with `woodMid` hub r4 and one spoke line, rotating with the belt. Charm: two small `paper` arrowheads on the top run showing direction. Motion: dash scroll + wheel spin, both exactly synced to physics surface velocity.

**3.9 Bumper** — circle r22 `poppy`; inset ring r16 stroke `paper` 4px; center `sunny` 4-point star r9. Charm: the star. Motion: on hit — scale ping 1.0 -> 1.25 -> 1.0 with easeOutBack 220ms, plus an expanding shockwave ring (stroke `paper` 3px, r22 -> r38, alpha 0.9 -> 0, 250ms).

**3.10 Balloon** — ellipse rx20 ry24 (fill per-instance from `blossom / sky / sunny / leaf`), tiny triangle knot at bottom, string = quadratic curve 60px, `inkSoft` 1.5px. Charm: `paper` oval glint upper-left + double-loop knot detail. Motion: buoyant bob (`y += 2*sin(t/1.8s)`); the string's control point lags the balloon by 120ms (store previous position) so it wiggles like real string. Pop: expanding ring + 6 shard triangles in the balloon's color + a poof; never a scary bang flash.

**3.11 Bucket** — trapezoid, top 64 / bottom 48 / height 52, corners r6, fill `sky`; rim band: rounded rect 68x10 `paper` with `blueDeep` bottom edge line. Handle: arc stroke `woodDark` 3px. Charm: stenciled `sunny` star on the front face @ 0.9. Motion: rocks +-4 deg with easeOut when something lands inside; if it is the goal catch, a stars-and-ring burst from the rim.

**3.12 Shelf** — plank 140x14 + two right-triangle brackets 18x18 (r4 corners) `woodDark` beneath. Charm: two `inkSoft` screw dots per bracket. Motion: static; mounting poof on placement only.

**3.13 Wall** — vertical rounded rect r10, built from 24px vertical boards alternating `woodLight` and `woodLight` + `shadow` overlay, each with one grain squiggle. Charm: exactly one board has a heart-shaped knot (two small circles + triangle, `woodDark` @ 0.35). Motion: static; dust poof on hard impacts.

**3.14 Berry (collectible)** — circle r11 `poppy` with `shadow` refill on lower-right quarter; two `leaf` ellipse leaves rx6 ry3 at 10 and 2 o'clock; 2px `woodDark` stem. Subtle face (only when radius >= 10px on screen): two sleeping-eye arcs `ink` 1.5px and a 4px smile arc — asleep by default. Charm: the face wakes (open dot eyes) when a moving object comes within 80px. Motion: breathing pulse scale 1.0 -> 1.05, 2.6s sine; on collect it pops into 5 sparkle stars + ring.

**3.15 Bowl (goal)** — lower-half ellipse rx34 ry22 fill `loryBlue`, inner rim ellipse rx30 ry8 `paper`, foot rect 24x6 `blueDeep`. Charm: a `sunny` berry stencil painted on the front. Motion: idle goal glow — soft radial `sunny` @ 0.15 pulse beneath, 2s period; on goal delivery the bowl hops 8px with squash, ring burst + 3-star fountain, Lory switches to Cheer.

**3.16 Bell** — dome: arc r18 + flared skirt (two outward quads), fill `sunny`, left-side vertical glint stripe `paper` @ 0.6; hanger: `woodMid` rounded mount; clapper: `ink` circle r4 peeking under the rim. Charm: tiny `poppy` bow at the hanger. Motion: on ring, swings rotate 20 -> -14 -> 8 -> 0 deg (decay, pivot at mount) while 3 short `sunny` arcs flash on each side for 150ms.

**3.17 Spikes as cactus (hazard)** — pot: trapezoid 48 top / 36 bottom / 26 high, `woodMid`, rim band `woodDark`. Cactus: rounded capsule 26x44 r13 `leaf` + one side arm capsule 12x20; spines: soft `paper` V-marks 3px in a diamond grid (no triangles, no points). Charm: one `blossom` flower (5 overlapping circles r3 + `sunny` center) on top. Motion: idle shiver wobble +-2 deg every 5s; on contact it wiggles fast, emits a poof, the touching object gets a comedy bounce-away, and Lory goes to Oops. Danger is signaled by behavior + Lory, never by gore.

**3.18 Sparkle stars (FX)** — 4-point star: 4 quadratic-pinched points, outer r 4-9 (random), fill `sunny`, center circle r30% `paper`. Motion: spawn at scale 0 rotate 0, pop to full with easeOutBack while rotating 90 deg, twinkle alpha sine, die at 500ms. Used by every success moment; the visual glue of the game.

---

## 4. Background (the playroom)

Painted once to an offscreen canvas per resize; costs zero per frame.

1. **Wall gradient**: vertical `wallCream` (y=0) -> `wallPeach` (y=H).
2. **Wallpaper pattern**: polka dots r3, `woodMid` @ 0.07, on a 64px grid with every other row offset 32px. (At @0.07 it is texture, not content — parts always win.)
3. **Vignette**: radial gradient from center, transparent to `rgba(67,52,43,0.05)` at corners.
4. **Skirting board**: bottom strip — floor 44px of `woodLight` with vertical seam lines every 96px (`woodDark` @ 0.15, 1.5px); above it the skirting: 26px `woodMid` band, top edge `woodDark` 3px, `paper` @ 0.25 highlight line 1px below that, and `shadow` 6px cast onto the floor.
5. **Decor (optional, top 15% of screen only)**: one or two crayon-doodle frames — rounded rect `paper` @ 0.5 with `woodMid` border and a scribble of 3 `inkSoft` @ 0.4 strokes. Never inside the play zone, alpha capped at 0.5.

---

## 5. UI Kit

**Typography** — `font-family: ui-rounded, -apple-system, "Segoe UI", system-ui, sans-serif`. Weights: 800 titles, 700 buttons/badges, 600 body. Sizes: title 28px, button label 18px, body 15px, badge 12px. All text `ink` on `paper` surfaces; `paper` on colored buttons. Letter-spacing 0.2px.

**Buttons (toy-block style)** — Minimum touch size 64x64. Rounded rect r20. Fill = role color with a hard (unblurred) 4px bottom edge in its deep tone — the "wooden block" look: primary `loryBlue`/`blueDeep`; play `leaf`/(leaf + `shadow`x2); stop-and-reset `tangerine`; destructive/stop-sim `poppy`. Icon 28px centered, 13px label under it for adults. Hover: scale 1.04 (120ms). Pressed: translate down 3px, edge shrinks to 1px. Disabled: fill `inkSoft` @ 0.35, no edge.

**Parts tray** — Bottom-docked wooden tray: rounded rect (top corners r24 only), fill `woodLight`, top edge `woodDark` 2px, height 104px. Inside: `paper` wells 72x72 r16 with inner shadow (`shadow` inset top), one part preview per well drawn at 0.6 scale, count badge = `loryBlue` circle r11 top-right with `paper` 12px/700 number. Horizontal scroll with snap. Dragging out of a well spawns the part under the finger with a poof; empty wells show the part as an `inkSoft` @ 0.25 silhouette.

**Top bar** — No solid bar; floating pills, 56px tall, 12px from edges. Left: level chip (`paper` r28, ink title "Lab 1-3", three tiny result stars). Right cluster: Reset (`tangerine`), Hint (`sunny` bulb icon), Menu (`paper`, ink lines). Bottom-right, above the tray: the big 88px round Play button (`leaf`, `paper` triangle) that morphs into a `poppy` rounded-square Stop while the sim runs (150ms cross-morph).

**Win overlay** — Backdrop `rgba(67,52,43,0.35)` fading in 200ms. Card: `paper`, r32, with a 6px `woodLight` border + 2px `woodDark` outer line (a picture frame). Lory in Cheer pose overlapping the card's top edge. Three stars r34, fill `sunny`, stroke `ink` @ 0.4 3px: pop in sequentially, 150ms apart, scale 0 -> 1.25 -> 1.0 easeOutBack, each with its own poof ring; unearned stars stay as `inkSoft` @ 0.25 outlines. Buttons: Replay (`loryBlue`), Next (`leaf`, wider). Confetti falls behind the card, not over it.

**Hint ghost** — The suggested part drawn in place: fill `loryBlue` @ 0.08, stroke `loryBlue` 3px, dash `[8,6]` with dash offset marching at 20px/s; whole ghost pulses alpha 0.5 -> 0.9 -> 0.5 over 1.2s. When the player drops the right part within 24px, the ghost flashes `leaf` once and dissolves into 3 sparkles.

**Motion and juice rules**
- Durations: micro-feedback 120ms, standard transitions 220ms, celebrations 600ms. Easing: easeOutBack (s=1.2) for anything popping in; easeOutQuad for movement; springs (stiffness 220, damping 18) for physical recoil.
- **Squash on impact**: every dynamic body scales 0.85 along the contact normal and 1.12 tangentially, proportional to impact speed (clamped), recovering by spring in ~180ms. Rendering-only; never touches physics.
- **Confetti (win)**: 80 rects 6x10 from `[poppy, sunny, leaf, sky, blossom, loryBlue]`, launched upward in a 60-degree fan, gravity 900px/s^2, individual rotation + horizontal flutter (`sin` on x), despawn at 2.5s.
- **Poof**: 5-7 `paper` @ 0.9 circles r 4-10 expanding 1.6x and fading to 0 over 350ms. Used for spawn, despawn, dust, cactus contact.
- Restraint rules: max one screen-wide effect at a time; ambient idle motion amplitude <= 2px; every particle system hard-capped (confetti 80, sparkles 12, poof 7); all static art lives on cached offscreen canvases so the 60fps budget is spent only on physics bodies and FX.
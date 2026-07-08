// Physics behaviour smoke tests — validates every part does its job headlessly.
// Run: node test/smoke.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Core = require('../src/core.js');

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// Run a sim watching one body; returns stats + outcome.
function run(level, placements, seconds = 12, watch = null) {
  const sim = Core.createSim(level, placements);
  const body = watch ? sim.bodies().find(b => b.plugin?.lab?.type === watch) : null;
  let minY = body ? body.position.y : Infinity, maxX = body ? body.position.x : -Infinity;
  for (let f = 0; f < seconds * 60; f++) {
    sim.step();
    if (body) { minY = Math.min(minY, body.position.y); maxX = Math.max(maxX, body.position.x); }
    if (sim.state.won) break;
  }
  return { won: sim.state.won, t: +(sim.state.frames / 60).toFixed(2), minY, maxX, sim };
}

// 1. Null test + plank redirect into bowl.
{
  const level = {
    goalType: 'catch',
    fixed: [
      { type: 'shelf', x: 300, y: 300, w: 200, h: 24, angle: 7 },
      { type: 'berry', x: 260, y: 270 },
      { type: 'bowl', x: 640, y: 640 },
    ],
  };
  const noWin = Core.simulate(level, [], { maxSeconds: 10 });
  check('null-test: level alone does not win', !noWin.won);
  const r = run(level, [{ type: 'plank', x: 470, y: 390, angle: 18 }], 14);
  check('berry rolls down tilted shelf, redirected by plank into bowl', r.won, `t=${r.t}s`);
}

// 2. Trampoline: marble rebounds to ~spawn height, stable (no energy gain).
{
  const r = run({
    goalType: 'catch',
    fixed: [{ type: 'ball_marble', x: 400, y: 200 }, { type: 'bowl', x: 1100, y: 640 }],
  }, [{ type: 'trampoline', x: 400, y: 600 }], 6, 'ball_marble');
  check('trampoline rebounds marble to ~spawn height', r.minY < 230 && r.minY > 100, `peak y=${r.minY.toFixed(0)} (spawn 200)`);
}

// 3. Fan: strong enough for beach ball, too weak for marble.
{
  const mk = (ball) => ({
    goalType: 'bell',
    fixed: [
      { type: 'shelf', x: 500, y: 500, w: 400, h: 24 },
      { type: ball, x: 420, y: 459 },
      { type: 'bell', x: 700, y: 460 },
    ],
  });
  const r1 = run(mk('ball_beach'), [{ type: 'fan', x: 320, y: 460, dir: 'right' }], 12);
  check('fan blows beach ball into bell', r1.won, `t=${r1.t}s`);
  const r2 = run(mk('ball_marble'), [{ type: 'fan', x: 320, y: 460, dir: 'right' }], 8);
  check('fan too weak to push marble into bell', !r2.won);
}

// 4. Dominoes: ramp-launched marble starts a 5-chain; last domino topples off
//    the shelf edge onto a hanging bell.
{
  const r = run({
    goalType: 'bell',
    fixed: [
      { type: 'shelf', x: 390, y: 400, w: 280, h: 24 },
      { type: 'plank', x: 240, y: 330, angle: 18 },
      { type: 'ball_marble', x: 175, y: 290 },
      { type: 'bell', x: 545, y: 555 },
    ],
  }, [0, 1, 2, 3, 4, 5].map(i => ({ type: 'domino', x: 330 + i * 34, y: 360 })), 14);
  check('domino chain topples off shelf edge and rings bell', r.won, `t=${r.t}s`);
}

// 5. Goal balloon pops when hit by a dropped marble.
{
  const r = run({
    goalType: 'pop',
    fixed: [{ type: 'balloon_goal', x: 500, y: 400 }, { type: 'spikes', x: 1000, y: 150 }],
  }, [{ type: 'ball_marble', x: 500, y: 150 }], 8);
  check('marble drop pops goal balloon', r.won, `t=${r.t}s`);
}

// 6. Fan pushes tethered goal balloon sideways into spikes.
{
  const r = run({
    goalType: 'pop',
    fixed: [
      { type: 'balloon_goal', x: 600, y: 350 },
      { type: 'spikes', x: 685, y: 390, angle: 90 },
    ],
  }, [{ type: 'fan', x: 430, y: 360, dir: 'right' }], 10);
  check('fan pushes goal balloon into spikes', r.won, `t=${r.t}s`);
}

// 7. Placeable balloon rises and pops ONLY on spikes (goal balloon untouched).
{
  const level = {
    goalType: 'pop',
    fixed: [
      { type: 'balloon_goal', x: 800, y: 500 },
      { type: 'spikes', x: 400, y: 200 },
    ],
  };
  const r = Core.simulate(level, [{ type: 'balloon', x: 400, y: 600 }], { maxSeconds: 10, collectEvents: true });
  const pops = r.events.filter(e => e.type === 'pop');
  check('placeable balloon rises, pops on spikes; goal balloon unaffected',
    !r.won && pops.length === 1 && !pops[0].goal, `pops=${pops.length}`);
}

// 8. Seesaw: marble drop flings berry far across the board.
{
  const r = run({
    goalType: 'catch',
    fixed: [
      { type: 'ball_marble', x: 405, y: 200 },
      { type: 'berry', x: 595, y: 470 },
      { type: 'bowl', x: 1150, y: 640 },
    ],
  }, [{ type: 'seesaw', x: 500, y: 500 }], 8, 'berry');
  check('seesaw flings berry across the board (>250px)', r.maxX > 850, `maxX=${r.maxX.toFixed(0)} from 595`);
}

// 9. Conveyor carries berry into bowl.
{
  const r = run({
    goalType: 'catch',
    fixed: [{ type: 'berry', x: 400, y: 300 }, { type: 'bowl', x: 650, y: 640 }],
  }, [{ type: 'conveyor', x: 450, y: 380, dir: 'right' }], 10);
  check('conveyor carries berry into bowl', r.won, `t=${r.t}s`);
}

// 10. Control: straight fall into bowl + sparkle collection.
{
  const r = Core.simulate({
    goalType: 'catch',
    fixed: [{ type: 'berry', x: 500, y: 150 }, { type: 'bowl', x: 500, y: 640 }],
    sparkles: [{ x: 500, y: 300 }, { x: 500, y: 420 }, { x: 500, y: 540 }],
  }, [], { maxSeconds: 8 });
  check('falling berry wins and collects 3 sparkles', r.won && r.sparkles === 3, `sparkles=${r.sparkles}/3`);
}

// 11. Bucket holds a berry (no win, settles).
{
  const r = Core.simulate({
    goalType: 'catch',
    fixed: [{ type: 'berry', x: 500, y: 100 }, { type: 'bowl', x: 900, y: 640 }],
  }, [{ type: 'bucket', x: 500, y: 400 }], { maxSeconds: 8 });
  check('bucket catches and holds berry', !r.won && r.settled);
}

// 12. Bumper deflects a falling beach ball sideways with energy.
{
  const r = run({
    goalType: 'catch',
    fixed: [{ type: 'ball_beach', x: 480, y: 150 }, { type: 'bowl', x: 900, y: 640 }],
  }, [{ type: 'bumper', x: 500, y: 450 }], 8, 'ball_beach');
  check('bumper deflects beach ball leftwards away', r.sim.bodies().find(b => b.plugin?.lab?.type === 'ball_beach').position.x < 400, '');
}

// 13. Magnet: asleep it ignores the marble; woken by a dropped ball it yanks
//     the marble off its shelf across a gap, ringing a bell on the way.
{
  const level = {
    goalType: 'bell',
    fixed: [
      { type: 'shelf', x: 340, y: 460, w: 200, h: 24 },
      { type: 'ball_marble', x: 420, y: 429 },
      { type: 'bell', x: 550, y: 430 },
      { type: 'shelf', x: 700, y: 500, w: 160, h: 24 },
    ],
  };
  const asleep = Core.simulate(level, [{ type: 'magnet', x: 700, y: 460 }], { maxSeconds: 6 });
  check('sleeping magnet ignores nearby marble', !asleep.won && asleep.settled);

  const r = Core.simulate(level, [
    { type: 'magnet', x: 700, y: 460 },
    { type: 'ball_beach', x: 700, y: 250 }, // dropped on the magnet's button
  ], { maxSeconds: 10, collectEvents: true });
  const on = r.events.some(e => e.type === 'magnet_on');
  check('bumped magnet wakes, yanks marble across gap into bell', r.won && on, `t=${r.seconds}s on=${on}`);
}

// 14. Magnet only attracts metal: berry unaffected.
{
  const level = {
    goalType: 'catch',
    fixed: [
      { type: 'shelf', x: 300, y: 460, w: 200, h: 24 },
      { type: 'berry', x: 360, y: 431 },
      { type: 'bowl', x: 700, y: 640 },
      { type: 'shelf', x: 700, y: 500, w: 160, h: 24 },
    ],
  };
  const r = Core.simulate(level, [
    { type: 'magnet', x: 700, y: 460 },
    { type: 'ball_beach', x: 700, y: 250 },
  ], { maxSeconds: 8 });
  check('magnet ignores non-metal berry', !r.won && r.settled);
}

// 15. Magnet releases: after the pulse ends, a caught marble drops.
{
  const level = {
    goalType: 'catch',
    fixed: [
      { type: 'shelf', x: 340, y: 460, w: 200, h: 24 },
      { type: 'ball_marble', x: 430, y: 429 },
      { type: 'bowl', x: 700, y: 640 },
      { type: 'shelf', x: 840, y: 500, w: 100, h: 24 },
    ],
  };
  const r = run(level, [
    { type: 'magnet', x: 700, y: 420 },
    { type: 'ball_beach', x: 700, y: 250 },
  ], 12, 'ball_marble');
  const marble = r.sim.bodies().find(b => b.plugin?.lab?.type === 'ball_marble');
  check('magnet releases marble after pulse (marble ends below magnet)',
    marble.position.x > 600 && marble.position.y > 560, `final=(${marble.position.x.toFixed(0)},${marble.position.y.toFixed(0)})`);
}

// ---------------------------------------------------------------------------
// machine-shop parts (sandbox): rope/scissors/candle/fuse/hydrant/switch/fist
// ---------------------------------------------------------------------------

// 16. Rope ties the nearest ball and holds it; scissors cut it down.
{
  const level = {
    goalType: 'catch',
    fixed: [
      { type: 'rope', x: 500, y: 200 },
      { type: 'berry', x: 505, y: 355 },       // near rope end (200+150)
      { type: 'bowl', x: 500, y: 655 },
    ],
  };
  const hold = Core.simulate(level, [], { maxSeconds: 8 });
  check('rope ties nearby berry and holds it (no win, settles)', !hold.won && hold.settled);
  const idle = Core.simulate(level, [{ type: 'scissors', x: 500, y: 280 }], { maxSeconds: 8 });
  check('untriggered scissors do NOT cut the rope', !idle.won && idle.settled);
  const cut = Core.simulate(level, [
    { type: 'scissors', x: 500, y: 280 },
    { type: 'ball_marble', x: 455, y: 140 },  // falls onto the blades: snap!
  ], { maxSeconds: 10, collectEvents: true });
  check('touched scissors snap and cut the rope -> berry falls into bowl',
    cut.won && cut.events.some(e => e.type === 'snip') && cut.events.some(e => e.type === 'snipclick'), `t=${cut.seconds}s`);
}

// 17. Candle lights a fuse; the burning front pops a goal balloon later
//     (fuse as a delay line), and the delay is real.
{
  const level = {
    goalType: 'pop',
    fixed: [
      { type: 'candle', x: 390, y: 400 },
      { type: 'balloon_goal', x: 540, y: 360 },
    ],
  };
  const noFuse = Core.simulate(level, [], { maxSeconds: 6 });
  check('candle alone cannot reach the balloon', !noFuse.won);
  const r = Core.simulate(level, [{ type: 'fuse', x: 440, y: 366 }], { maxSeconds: 10, collectEvents: true });
  check('candle lights fuse; burning front pops balloon after a delay',
    r.won && r.seconds > 0.8 && r.events.some(e => e.type === 'ignite'), `t=${r.seconds}s`);
}

// 18. Fuse chain: fire crosses from one fuse to another.
{
  const level = {
    goalType: 'pop',
    fixed: [
      { type: 'candle', x: 360, y: 400 },
      { type: 'balloon_goal', x: 640, y: 360 },
    ],
  };
  const oneFuse = Core.simulate(level, [{ type: 'fuse', x: 420, y: 366 }], { maxSeconds: 10 });
  check('single fuse too short to reach far balloon', !oneFuse.won);
  const r = Core.simulate(level, [
    { type: 'fuse', x: 420, y: 366 },
    { type: 'fuse', x: 540, y: 366 },
  ], { maxSeconds: 12 });
  check('two chained fuses carry the flame to the balloon', r.won, `t=${r.seconds}s`);
}

// 19. Hydrant pushes a BERRY (water is stronger than wind — fans never can).
{
  const level = {
    goalType: 'catch',
    fixed: [
      { type: 'shelf', x: 500, y: 500, w: 360, h: 24 },
      { type: 'berry', x: 420, y: 471 },
      { type: 'bowl', x: 850, y: 655 },
    ],
  };
  const fan = Core.simulate(level, [{ type: 'fan', x: 300, y: 470, dir: 'right' }], { maxSeconds: 8 });
  check('fan cannot move the berry (teaching rule intact)', !fan.won);
  const idle = Core.simulate(level, [{ type: 'hydrant', x: 300, y: 468, dir: 'right' }], { maxSeconds: 8 });
  check('idle hydrant does nothing (needs a trigger)', !idle.won && idle.settled);
  const jet = Core.simulate(level, [
    { type: 'hydrant', x: 300, y: 468, dir: 'right' },
    { type: 'ball_beach', x: 300, y: 330 },   // falls onto the hydrant: valve opens
  ], { maxSeconds: 10, collectEvents: true });
  check('bumped hydrant sprays; water pushes the berry into the bowl',
    jet.won && jet.events.some(e => e.type === 'water_on'), `t=${jet.seconds}s`);
}

// 20. Hydrant extinguishes a burning fuse -> balloon at the end survives.
{
  const level = {
    goalType: 'pop',
    fixed: [
      { type: 'candle', x: 420, y: 400 },
      { type: 'fuse', x: 470, y: 366 },
      { type: 'balloon_goal', x: 566, y: 360 },
      { type: 'hydrant', x: 470, y: 250, dir: 'up' },
    ],
  };
  // hydrant points up, away from the fuse: balloon pops
  const r1 = Core.simulate(level, [], { maxSeconds: 10 });
  check('control: flame survives when water points away', r1.won);
  // hydrant re-aimed down over the fuse: flame doused, balloon survives
  const level2 = JSON.parse(JSON.stringify(level));
  level2.fixed[3] = { type: 'hydrant', x: 470, y: 250, dir: 'right' };
  level2.fixed.push({ type: 'hydrant', x: 240, y: 366, dir: 'right' });
  level2.fixed.push({ type: 'ball_marble', x: 240, y: 260 }); // triggers the douser
  const r2 = Core.simulate(level2, [], { maxSeconds: 10, collectEvents: true });
  check('water dousing the fuse front stops the fire (balloon survives)',
    !r2.won && r2.events.some(e => e.type === 'extinguish'), `settled=${r2.settled}`);
}

// 20b. A spraying hydrant is pending action: quiescence waits for water_off
// (this is what keeps the sandbox autostop from cutting a fountain short).
{
  const level = {
    goalType: 'bell',
    fixed: [
      { type: 'hydrant', x: 300, y: 468, dir: 'right' },
      { type: 'bell', x: 900, y: 200 },
    ],
  };
  const sim = Core.createSim(level, [
    { type: 'ball_marble', x: 290, y: 330 },   // bumps the valve open, rolls clear
  ]);
  let onAt = 0, offAt = 0;
  while (sim.state.frames < 12 * 60 && !sim.state.settled) {
    for (const e of sim.step()) {
      if (e.type === 'water_on' && !onAt) onAt = sim.state.frames;
      if (e.type === 'water_off') offAt = sim.state.frames;
    }
  }
  check('spraying hydrant defers settle until the water stops',
    onAt > 0 && offAt > onAt && sim.state.settled && sim.state.frames >= offAt + 100,
    `on@${onAt}f off@${offAt}f settled@${sim.state.frames}f`);
}

// 21. Switch powers a fan only while something presses the plate.
{
  const level = {
    goalType: 'bell',
    fixed: [
      { type: 'shelf', x: 500, y: 500, w: 400, h: 24 },
      { type: 'ball_beach', x: 420, y: 459 },
      { type: 'bell', x: 700, y: 460 },
      { type: 'fan', x: 320, y: 460, dir: 'right' },
      { type: 'switch', x: 220, y: 590 },
      { type: 'shelf', x: 220, y: 610, w: 120, h: 16 },
    ],
  };
  const idle = Core.simulate(level, [], { maxSeconds: 6 });
  check('switch-wired fan stays OFF with nothing on the plate', !idle.won && idle.settled);
  const r = Core.simulate(level, [{ type: 'ball_marble', x: 220, y: 480 }], { maxSeconds: 10, collectEvents: true });
  check('marble lands on switch -> fan powers on -> ball rings bell',
    r.won && r.events.some(e => e.type === 'switch_on'), `t=${r.seconds}s`);
}

// 22. Spring fist launches a landing marble far higher than any trampoline.
{
  const mk = (part) => ({
    goalType: 'catch',
    fixed: [{ type: 'ball_marble', x: 400, y: 400 }, { type: 'bowl', x: 1100, y: 655 }],
  });
  const runPeak = (placements) => {
    const sim = Core.createSim(mk(), placements);
    const b = sim.bodies().find(x => x.plugin?.lab?.type === 'ball_marble');
    let minY = 400;
    for (let f = 0; f < 300; f++) { sim.step(); minY = Math.min(minY, b.position.y); }
    return minY;
  };
  const tramp = runPeak([{ type: 'trampoline', x: 400, y: 600 }]);
  const fist = runPeak([{ type: 'fist', x: 400, y: 600 }]);
  check('fist launches marble far above trampoline rebound height',
    fist < tramp - 120 && fist < 200, `fist peak y=${fist.toFixed(0)} vs trampoline ${tramp.toFixed(0)}`);
}

// 23. Flame burns a rope: candle under the rope line drops the hanging ball.
{
  const level = {
    goalType: 'catch',
    fixed: [
      { type: 'rope', x: 500, y: 150 },
      { type: 'berry', x: 503, y: 305 },
      { type: 'bowl', x: 500, y: 655 },
    ],
  };
  const r = Core.simulate(level, [{ type: 'candle', x: 505, y: 255 }], { maxSeconds: 10, collectEvents: true });
  check('candle flame burns through the rope -> berry drops into bowl',
    r.won && r.events.some(e => e.type === 'snip' && e.cause === 'fire'), `t=${r.seconds}s`);
}

// 24. Scissors cut a goal balloon's tether string -> it floats up into spikes.
{
  const level = {
    goalType: 'pop',
    fixed: [
      { type: 'balloon_goal', x: 500, y: 500 },
      { type: 'spikes', x: 500, y: 300, angle: 180 },
    ],
  };
  const uncut = Core.simulate(level, [{ type: 'scissors', x: 520, y: 570 }], { maxSeconds: 8 });
  check('tethered goal balloon bobs in place (idle scissors, no win)', !uncut.won && uncut.settled);
  const r = Core.simulate(level, [
    { type: 'scissors', x: 520, y: 570 },
    { type: 'ball_marble', x: 550, y: 430 },  // skims past the balloon, taps the blades
  ], { maxSeconds: 14, collectEvents: true });
  check('triggered scissors snip the balloon string -> balloon rises into cactus',
    r.won && r.events.some(e => e.type === 'snip'), `t=${r.seconds}s`);
}

// 25. Switch drives a hydrant directly (wired device, no bump needed).
{
  const level = {
    goalType: 'catch',
    fixed: [
      { type: 'shelf', x: 500, y: 500, w: 360, h: 24 },
      { type: 'berry', x: 420, y: 471 },
      { type: 'bowl', x: 760, y: 655 },
      { type: 'hydrant', x: 300, y: 468, dir: 'right' },
      { type: 'switch', x: 300, y: 590 },
      { type: 'shelf', x: 300, y: 610, w: 120, h: 16 },
    ],
  };
  const idle = Core.simulate(level, [], { maxSeconds: 6 });
  check('switch-wired hydrant stays dry with nothing on the plate', !idle.won && idle.settled);
  const r = Core.simulate(level, [{ type: 'ball_marble', x: 300, y: 520 }], { maxSeconds: 10, collectEvents: true });
  check('weight on switch -> hydrant sprays -> berry pushed into bowl',
    r.won && r.events.some(e => e.type === 'water_on'), `t=${r.seconds}s`);
}

// 26. Fist rotated 90 degrees punches sideways along its facing.
{
  const level = {
    goalType: 'bell',
    fixed: [
      { type: 'fist', x: 400, y: 640, angle: 90 },   // glove points right
      { type: 'plank', x: 300, y: 500, angle: 30 },  // marble slide into the glove
      { type: 'ball_marble', x: 245, y: 460 },
      { type: 'bell', x: 900, y: 640 },
    ],
  };
  const r = Core.simulate(level, [], { maxSeconds: 10, collectEvents: true });
  check('sideways fist punches marble horizontally into a far bell',
    r.won && r.events.some(e => e.type === 'thwack'), `t=${r.seconds}s`);
}

// 27. Back plunger: a pre-loaded fist fires like a cannon when something
//     presses the button on its back.
{
  const level = {
    goalType: 'bell',
    fixed: [
      { type: 'fist', x: 500, y: 650, angle: 90 },      // glove points right
      { type: 'ball_beach', x: 552, y: 660 },           // loaded against the glove
      { type: 'bell', x: 950, y: 645 },
    ],
  };
  const idle = Core.simulate(level, [], { maxSeconds: 6 });
  check('loaded fist waits (nothing presses the back button)', !idle.won && idle.settled);
  const r = Core.simulate(level, [{ type: 'ball_marble', x: 467, y: 480 }], { maxSeconds: 10, collectEvents: true });
  check('marble on back plunger fires the loaded ball into the bell',
    r.won && r.events.some(e => e.type === 'thwack'), `t=${r.seconds}s`);
}

// 28. Candle initial state: spec.lit === false places it cold — it must not
//     act as a flame (control), and any passing flame lights it back.
{
  const level = {
    goalType: 'pop',
    fixed: [
      { type: 'candle', x: 470, y: 400, lit: false },
      { type: 'fuse', x: 520, y: 366 },
      { type: 'balloon_goal', x: 616, y: 360 },
    ],
  };
  const cold = Core.simulate(level, [], { maxSeconds: 8 });
  check('unlit candle is not a flame (fuse never lights, balloon lives)', !cold.won && cold.settled);
  // lit candle -> fuse -> the burning front reaches the cold candle's wick
  const level2 = {
    goalType: 'bell',
    fixed: [
      { type: 'candle', x: 420, y: 400 },              // lit: ignites the fuse
      { type: 'fuse', x: 470, y: 366 },                // burns to its right end (535, 366)
      { type: 'candle', x: 535, y: 403, lit: false },  // wick tip right there
      { type: 'bell', x: 1200, y: 100 },
    ],
  };
  const sim = Core.createSim(level2, []);
  for (let f = 0; f < 400; f++) sim.step();
  const coldCandle = sim.parts.find(p => p.spec.type === 'candle' && p.spec.lit === false);
  check('fuse fire relights the placed-cold candle', coldCandle.bodies[0].plugin.lab.candle.lit === true);
}

// 29. Match: a bump strikes it, the flare lights a cold candle beside it,
//     then the match burns out spent (one-shot).
{
  const level = {
    goalType: 'bell',
    fixed: [
      { type: 'match', x: 500, y: 663 },
      { type: 'candle', x: 522, y: 661, lit: false },
      { type: 'bell', x: 1200, y: 100 },
    ],
  };
  const idle = Core.simulate(level, [], { maxSeconds: 6 });
  check('fresh match waits (nothing strikes it)', !idle.won && idle.settled);
  const sim = Core.createSim(level, [{ type: 'ball_marble', x: 500, y: 560 }]);
  let ignites = 0, burnout = false;
  for (let f = 0; f < 400; f++) for (const e of sim.step()) {
    if (e.type === 'ignite') ignites++;
    if (e.type === 'extinguish') burnout = true;
  }
  const mm = sim.parts.find(p => p.spec.type === 'match').bodies[0].plugin.lab.match;
  const cm = sim.parts.find(p => p.spec.type === 'candle').bodies[0].plugin.lab.candle;
  check('struck match lights the cold candle, then burns out spent',
    ignites >= 2 && cm.lit && burnout && mm.dead && !mm.lit, `ignites=${ignites}`);
}

// 30. A soaked match is spent: hydrant water kills the flare for good.
{
  const level = {
    goalType: 'bell',
    fixed: [
      { type: 'match', x: 500, y: 663 },
      { type: 'hydrant', x: 300, y: 659, dir: 'right' },
      { type: 'ball_beach', x: 300, y: 560 },   // wakes the hydrant
      { type: 'ball_marble', x: 500, y: 560 },  // strikes the match
      { type: 'bell', x: 1200, y: 100 },
    ],
  };
  const sim = Core.createSim(level, []);
  let doused = false;
  for (let f = 0; f < 400; f++) for (const e of sim.step()) if (e.type === 'extinguish') doused = true;
  const mm = sim.parts.find(p => p.spec.type === 'match').bodies[0].plugin.lab.match;
  check('water douses the flaring match — spent, never relights', doused && mm.dead && !mm.lit);
}

// 31. Laser cannon: a touch fires the beam; it pops a tethered balloon at
//     range, and a wall between them shields the shot.
{
  const mk = (block) => {
    const fixed = [
      { type: 'laser', x: 400, y: 560, angle: 90 },   // beam points right
      { type: 'ball_marble', x: 400, y: 480 },        // falls onto the cannon
      { type: 'balloon_goal', x: 700, y: 560 },
    ];
    if (block) fixed.push({ type: 'wall', x: 550, y: 560 });
    return { goalType: 'pop', fixed };
  };
  const open = Core.simulate(mk(false), [], { maxSeconds: 8, collectEvents: true });
  check('touched laser fires; beam pops the balloon across the gap',
    open.won && open.events.some(e => e.type === 'laser'), `t=${open.seconds}s`);
  const shielded = Core.simulate(mk(true), [], { maxSeconds: 8, collectEvents: true });
  check('wall blocks the beam — balloon behind it survives',
    !shielded.won && shielded.events.some(e => e.type === 'laser'));
}

// 32. Laser as igniter: the beam lights a cold candle wick and ignites a
//     fuse mid-span (sensors never block it).
{
  const level = {
    goalType: 'bell',
    fixed: [
      { type: 'laser', x: 400, y: 285, angle: 90 },
      { type: 'ball_marble', x: 400, y: 200 },
      { type: 'candle', x: 700, y: 322, lit: false },  // wick tip right on the beam line
      { type: 'fuse', x: 550, y: 285 },                // crossed on the way
      { type: 'bell', x: 1200, y: 650 },
    ],
  };
  const sim = Core.createSim(level, []);
  for (let f = 0; f < 300; f++) sim.step();
  const cm = sim.parts.find(p => p.spec.type === 'candle').bodies[0].plugin.lab.candle;
  const fm = sim.parts.find(p => p.spec.type === 'fuse').bodies[0].plugin.lab.fuse;
  check('beam lights the cold candle and ignites the fuse it crosses', cm.lit && fm.ignited);
}

// 33. Switch-wired laser: beam only while something presses the plate.
{
  const level = {
    goalType: 'pop',
    fixed: [
      { type: 'laser', x: 430, y: 560, angle: 90 },
      { type: 'switch', x: 430, y: 680 },              // wires to the cannon
      { type: 'balloon_goal', x: 720, y: 560 },
    ],
  };
  const idle = Core.simulate(level, [], { maxSeconds: 6 });
  check('switch-wired laser stays dark with nothing on the plate', !idle.won && idle.settled);
  const r = Core.simulate(level, [{ type: 'ball_marble', x: 430, y: 600 }], { maxSeconds: 8, collectEvents: true });
  check('weight on the plate -> continuous beam pops the balloon',
    r.won && r.events.some(e => e.type === 'laser'), `t=${r.seconds}s`);
}

// 34. Candle fire frees a tethered balloon: the flame burns the string and
//     the balloon floats up into the cactus (the fire way to pop goals).
{
  const level = {
    goalType: 'pop',
    fixed: [
      { type: 'balloon_goal', x: 600, y: 400 },   // string hangs 600,424 -> 600,495
      { type: 'candle', x: 600, y: 490 },         // lit tip at (600,453), on the string
      { type: 'spikes', x: 600, y: 150 },
    ],
  };
  const r = Core.simulate(level, [], { maxSeconds: 10, collectEvents: true });
  check('candle flame burns the balloon string; freed balloon pops on the cactus',
    r.won && r.events.some(e => e.type === 'snip' && e.cause === 'fire'), `t=${r.seconds}s`);
}

const fails = results.filter(r => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);

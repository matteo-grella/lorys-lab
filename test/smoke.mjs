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
  // the classic kid move: drop a ball ON the cannon. The trigger ball then
  // rests on the lens — it must NOT eat the beam (point-blank punch-through).
  const selfTrig = {
    goalType: 'pop',
    fixed: [
      { type: 'laser', x: 400, y: 660 },                // default: fires straight up
      { type: 'ball_marble', x: 400, y: 560 },          // falls onto the lens
      { type: 'balloon_goal', x: 400, y: 300 },         // high above, in the beam line
    ],
  };
  const up = Core.simulate(selfTrig, [], { maxSeconds: 8, collectEvents: true });
  check('ball resting on the lens does not block its own shot',
    up.won && up.events.some(e => e.type === 'laser'), `t=${up.seconds}s`);
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

// 35. Lightbulb button: a press on the chosen face toggles the light; a
//     resting object presses once; a bouncing one toggles on and off again.
{
  const level = {
    goalType: 'bell',
    fixed: [{ type: 'bulb', x: 400, y: 660, dir: 'up' }, { type: 'bell', x: 1200, y: 100 }],
  };
  const once = Core.createSim(level, [{ type: 'ball_marble', x: 400, y: 560 }]);
  const evs1 = [];
  for (let f = 0; f < 600; f++) for (const e of once.step()) if (e.type.startsWith('bulb_')) evs1.push(e.type);
  check('resting marble presses the button exactly once (light on)',
    evs1.length === 1 && evs1[0] === 'bulb_on');
  const bounce = Core.createSim(level, [{ type: 'ball_beach', x: 400, y: 560 }]);
  const evs2 = [];
  for (let f = 0; f < 600; f++) for (const e of bounce.step()) if (e.type.startsWith('bulb_')) evs2.push(e.type);
  check('bouncing ball presses again — light toggles back off',
    evs2[0] === 'bulb_on' && evs2[1] === 'bulb_off', evs2.join(','));
  const side = Core.createSim(level, [{ type: 'ball_marble', x: 460, y: 560 }]); // lands beside, touches the flank
  const evs3 = [];
  for (let f = 0; f < 400; f++) for (const e of side.step()) if (e.type.startsWith('bulb_')) evs3.push(e.type);
  check('touching a non-button face does nothing', evs3.length === 0, evs3.join(','));
}

// 36. Lens focuses a lit bulb's light into the laser beam; solids block the
//     light path; a wired switch can drive the bulb directly.
{
  const mk = (extra) => ({
    goalType: 'pop',
    fixed: [
      { type: 'bulb', x: 400, y: 660, dir: 'up' },
      { type: 'lens', x: 600, y: 660, angle: 90 },
      { type: 'balloon_goal', x: 800, y: 640 },
      ...(extra || []),
    ],
  });
  const dark = Core.simulate(mk(), [], { maxSeconds: 6, collectEvents: true });
  check('dark bulb feeds nothing (lens stays cold)', !dark.won && !dark.events.some(e => e.type === 'laser'));
  const lit = Core.simulate(mk(), [{ type: 'ball_marble', x: 400, y: 560 }], { maxSeconds: 8, collectEvents: true });
  check('button press -> bulb -> lens -> beam pops the balloon',
    lit.won && lit.events.some(e => e.type === 'bulb_on') && lit.events.some(e => e.type === 'laser'), `t=${lit.seconds}s`);
  const blocked = Core.simulate(mk([{ type: 'wall', x: 500, y: 620 }]), [{ type: 'ball_marble', x: 400, y: 560 }], { maxSeconds: 8, collectEvents: true });
  check('wall between bulb and lens blocks the light — no beam',
    !blocked.won && blocked.events.some(e => e.type === 'bulb_on') && !blocked.events.some(e => e.type === 'laser'));
  const wired = Core.createSim({
    goalType: 'bell',
    fixed: [
      { type: 'bulb', x: 450, y: 659, dir: 'right' },
      { type: 'switch', x: 600, y: 680 },
      { type: 'bell', x: 1200, y: 100 },
    ],
  }, [{ type: 'ball_marble', x: 600, y: 600 }]);
  let on = false;
  for (let f = 0; f < 300; f++) for (const e of wired.step()) if (e.type === 'bulb_on') on = true;
  check('switch-wired bulb lights while the plate is pressed',
    on && wired.parts.find(p => p.spec.type === 'bulb').bodies[0].plugin.lab.bulb.on);
}

// 37. Fan initial state: spec.on === false places it stopped — only a wired
//     pressure switch can run it (the switch always takes over, as before).
{
  const level = (fanSpec, extra) => ({
    goalType: 'bell',
    fixed: [
      { type: 'shelf', x: 500, y: 500, w: 400, h: 24 },
      { type: 'ball_beach', x: 420, y: 459 },
      { type: 'bell', x: 700, y: 460 },
      fanSpec,
      ...(extra || []),
    ],
  });
  const stopped = Core.simulate(level({ type: 'fan', x: 320, y: 460, dir: 'right', on: false }), [], { maxSeconds: 8, collectEvents: true });
  check('stopped fan never blows (ball stays, bell silent)', !stopped.won && stopped.settled);
  check('stopped fan never announces a hum (no fan_on)', !stopped.events.some(e => e.type === 'fan_on'));
  const wired = Core.simulate(
    level({ type: 'fan', x: 320, y: 460, dir: 'right', on: false },
      [{ type: 'switch', x: 320, y: 680 }]),
    [{ type: 'ball_marble', x: 320, y: 600 }], { maxSeconds: 8, collectEvents: true });
  check('weight on the plate wakes the stopped fan -> bell rings', wired.won, `t=${wired.seconds}s`);
  check('waking mid-run emits fan_on (drives the hum)', wired.events.some(e => e.type === 'fan_on'));
  const plain = Core.simulate(level({ type: 'fan', x: 320, y: 460, dir: 'right' }), [], { maxSeconds: 4, collectEvents: true });
  check('a default fan hums from the first frame', plain.events.some(e => e.type === 'fan_on'));
}

// 38. A rope grabs buoyant bodies too — and behaves like a STRING, not a
//     rod: the tied balloon floats up and is held taut above the anchor
//     (a stiff constraint used to push it down like a stick).
{
  const level = {
    goalType: 'bell',
    fixed: [
      { type: 'rope', x: 400, y: 370 },       // end hangs at (400, 520)
      { type: 'balloon', x: 405, y: 515 },
      { type: 'bell', x: 1200, y: 100 },
    ],
  };
  const sim = Core.createSim(level, []);
  const balloon = sim.parts.find(p => p.spec.type === 'balloon').bodies[0];
  for (let f = 0; f < 700; f++) sim.step();
  check('tied balloon floats up on a taut string (no rod-push-down)',
    balloon.position.y < 300 && balloon.position.y > 180, 'y=' + Math.round(balloon.position.y));
  // and a heavy berry still hangs at full rope length (stiff for weights)
  const sim2 = Core.createSim({ goalType: 'bell', fixed: [
    { type: 'rope', x: 400, y: 370 }, { type: 'berry', x: 405, y: 515 }, { type: 'bell', x: 1200, y: 100 },
  ] }, []);
  const berry = sim2.parts.find(p => p.spec.type === 'berry').bodies[0];
  for (let f = 0; f < 400; f++) sim2.step();
  check('heavy loads still hang firm at rope length',
    berry.position.y > 500 && berry.position.y < 540, 'y=' + Math.round(berry.position.y));
}

// 39. Cannon happy path: a roller falling on the open hatch loads it (door
//     shuts), a candle flame on the breech fuse fires it along the barrel;
//     dir mirrors the shot and elevation shapes the arc.
{
  const mk = (angle, dir, bx) => ({
    goalType: 'bell',
    fixed: [
      { type: 'cannon', x: 300, y: 659, angle, dir },
      { type: 'berry', x: bx, y: 560 },                 // falls into the hatch
      { type: 'candle', x: dir === 'left' ? 354 : 246, y: 661 }, // lit, at the breech
      { type: 'bell', x: 1250, y: 60 },
    ],
  });
  const fly = (angle, dir) => {
    const sim = Core.createSim(mk(angle, dir, dir === 'left' ? 318 : 282), []);
    const berry = sim.parts.find(p => p.spec.type === 'berry').bodies[0];
    const evs = [];
    let minY = 1e9, maxX = -1e9, minX = 1e9, fired = false;
    for (let f = 0; f < 360; f++) {
      for (const e of sim.step()) evs.push(e.type);
      if (evs.includes('cannon_fire')) fired = true;
      if (fired) {
        minY = Math.min(minY, berry.position.y);
        maxX = Math.max(maxX, berry.position.x);
        minX = Math.min(minX, berry.position.x);
      }
    }
    return { evs, minY, maxX, minX };
  };
  const r45 = fly(45);
  check('cannon loads a falling berry then a candle-lit fuse fires it',
    r45.evs.includes('cannon_load') && r45.evs.includes('ignite') && r45.evs.includes('cannon_fire'),
    r45.evs.filter(e => e.startsWith('cannon') || e === 'ignite').slice(0, 3).join(','));
  check('45° right shot flies high and far right', r45.minY < 450 && r45.maxX > 900,
    `peak y=${Math.round(r45.minY)} maxX=${Math.round(r45.maxX)}`);
  const rL = fly(45, 'left');
  check('dir:left mirrors the shot', rL.evs.includes('cannon_fire') && rL.minX < 120,
    `minX=${Math.round(rL.minX)}`);
  const r15 = fly(15), r75 = fly(75);
  check('elevation shapes the arc: 75° flies higher, 15° flies farther',
    r75.minY < r15.minY - 150 && r15.maxX > r75.maxX,
    `peak75=${Math.round(r75.minY)} peak15=${Math.round(r15.minY)} maxX15=${Math.round(r15.maxX)} maxX75=${Math.round(r75.maxX)}`);
}

// 40. Cannon doesn't do what it shouldn't: unlit it just holds its ball and
//     settles; the shut door turns a second ball away; water on the sizzling
//     fuse stops the shot; an empty cannon coughs a harmless dud.
{
  const unlit = Core.simulate({
    goalType: 'bell',
    fixed: [
      { type: 'cannon', x: 300, y: 659, angle: 45 },
      { type: 'ball_marble', x: 282, y: 560 },
      { type: 'bell', x: 1250, y: 60 },
    ],
  }, [], { maxSeconds: 8, collectEvents: true });
  check('unlit cannon holds its ball and settles (pending nothing)',
    unlit.settled && unlit.events.some(e => e.type === 'cannon_load')
    && !unlit.events.some(e => e.type === 'cannon_fire'), `t=${unlit.seconds}s`);

  const sim2 = Core.createSim({
    goalType: 'bell',
    fixed: [
      { type: 'cannon', x: 300, y: 659, angle: 45 },
      { type: 'ball_marble', x: 282, y: 560 },
      { type: 'ball_marble', x: 282, y: 460 },   // arrives at a shut door
      { type: 'bell', x: 1250, y: 60 },
    ],
  }, []);
  for (let f = 0; f < 360; f++) sim2.step();
  const cm2 = sim2.parts.find(p => p.spec.type === 'cannon').bodies[0].plugin.lab.cannon;
  const out = sim2.bodies().filter(b => b.plugin.lab && b.plugin.lab.type === 'ball_marble');
  check('shut door: second marble bounces off and stays outside',
    cm2.loaded && out.length === 1, `outside=${out.length}`);

  const dous = Core.simulate({
    goalType: 'bell',
    fixed: [
      { type: 'cannon', x: 500, y: 659, angle: 45 },
      { type: 'ball_marble', x: 482, y: 560 },
      { type: 'candle', x: 446, y: 661 },        // lights the breech fuse...
      { type: 'hydrant', x: 300, y: 659 },       // ...and the hydrant kills it
      { type: 'ball_beach', x: 300, y: 560 },    // bump wakes the hydrant
      { type: 'bell', x: 1250, y: 60 },
    ],
  }, [], { maxSeconds: 8, collectEvents: true });
  check('hydrant water douses the lit cannon fuse — no shot',
    dous.events.some(e => e.type === 'ignite') && dous.events.some(e => e.type === 'extinguish')
    && !dous.events.some(e => e.type === 'cannon_fire'));

  const dud = Core.simulate({
    goalType: 'bell',
    fixed: [
      { type: 'cannon', x: 300, y: 659, angle: 45 },
      { type: 'candle', x: 246, y: 661 },
      { type: 'bell', x: 1250, y: 60 },
    ],
  }, [], { maxSeconds: 4, collectEvents: true });
  check('empty cannon duds (visible poof, nothing fired)',
    dud.events.some(e => e.type === 'cannon_dud') && !dud.events.some(e => e.type === 'cannon_fire'));
}

// 41. Cannon cross-part chains: the laser beam lights the breech fuse from
//     afar, and a 75° lob drops the berry straight into Lory's bowl.
{
  const lz = Core.simulate({
    goalType: 'bell',
    fixed: [
      { type: 'laser', x: 100, y: 636, angle: 90 },  // beam fires to the right
      { type: 'ball_marble', x: 100, y: 560 },       // falls on it -> PEW
      { type: 'cannon', x: 400, y: 659, angle: 45 },
      { type: 'berry', x: 382, y: 600 },
      { type: 'bell', x: 1250, y: 60 },
    ],
  }, [], { maxSeconds: 6, collectEvents: true });
  check('laser beam lights the cannon fuse from across the room',
    lz.events.some(e => e.type === 'laser') && lz.events.some(e => e.type === 'cannon_fire'));

  const r = run({
    goalType: 'catch',
    fixed: [
      { type: 'cannon', x: 300, y: 659, angle: 75 },
      { type: 'berry', x: 282, y: 600 },
      { type: 'candle', x: 246, y: 661 },
      { type: 'bowl', x: 705, y: 640 },
    ],
  }, [], 12);
  check('75° lob drops the berry into the bowl — Lory is fed', r.won, `t=${r.t}s`);
}

// 42. One shot each: burnout (shot or dud) spends the cannon for good — the
//     fuse never relights, the lid stays down, nothing more is swallowed.
//     Kills the candle-parked infinite auto-cannon: the world SETTLES.
{
  const sim = Core.createSim({
    goalType: 'bell',
    fixed: [
      { type: 'cannon', x: 300, y: 659, angle: 45 },
      { type: 'candle', x: 246, y: 661 },          // parked flame at the breech
      { type: 'berry', x: 282, y: 560 },           // loads + fires (~1.3s)
      { type: 'berry', x: 282, y: -2000 },         // arrives AFTER the shot
      { type: 'bell', x: 1250, y: 60 },
    ],
  }, []);
  const evs = [];
  for (let f = 0; f < 720; f++) for (const e of sim.step()) evs.push(e.type);
  const n = t => evs.filter(e => e === t).length;
  const cm = sim.parts.find(p => p.spec.type === 'cannon').bodies[0].plugin.lab.cannon;
  const berries = sim.bodies().filter(b => b.plugin.lab && b.plugin.lab.type === 'berry');
  check('fired cannon is spent: one ignite, one shot, no duds, no relight',
    n('ignite') === 1 && n('cannon_fire') === 1 && n('cannon_dud') === 0,
    `ignite=${n('ignite')} fire=${n('cannon_fire')} dud=${n('cannon_dud')}`);
  check('spent cannon swallows nothing: the late berry stays outside',
    cm.dead && !cm.loaded && berries.length === 2, `berriesInWorld=${berries.length}`);
  check('parked candle no longer loops the machine: the world settles',
    sim.state.settled);

  const dud = Core.createSim({
    goalType: 'bell',
    fixed: [
      { type: 'cannon', x: 300, y: 659, angle: 45 },
      { type: 'candle', x: 246, y: 661 },
      { type: 'bell', x: 1250, y: 60 },
    ],
  }, []);
  const evs2 = [];
  for (let f = 0; f < 600; f++) for (const e of dud.step()) evs2.push(e.type);
  const n2 = t => evs2.filter(e => e === t).length;
  const cm2 = dud.parts.find(p => p.spec.type === 'cannon').bodies[0].plugin.lab.cannon;
  check('a dud also spends it: one ignite, one poof, then quiet for good',
    n2('ignite') === 1 && n2('cannon_dud') === 1 && cm2.dead && dud.state.settled,
    `ignite=${n2('ignite')} dud=${n2('cannon_dud')} settled=${dud.state.settled}`);
}

// 43. Mirror: the shiny face bounces the beam (specular), the wooden back
//     absorbs it, two mirrors chain, and reflected legs carry the full
//     beam powers (here: lighting a cold candle two bounces away).
{
  const mk = (extra) => ({
    goalType: 'pop',
    fixed: [
      { type: 'laser', x: 100, y: 636, angle: 90 },   // fires right
      { type: 'ball_marble', x: 100, y: 560 },        // falls on it -> PEW
      ...extra,
    ],
  });
  const r1 = Core.simulate(mk([
    { type: 'mirror', x: 500, y: 636, angle: -45 },
    { type: 'balloon_goal', x: 500, y: 400 },         // around the corner, straight up
  ]), [], { maxSeconds: 5, collectEvents: true });
  check('mirror bounces the beam 90° up — balloon around the corner pops', r1.won);
  const r2 = Core.simulate(mk([
    { type: 'mirror', x: 500, y: 636, angle: 135 },   // wooden back to the beam
    { type: 'balloon_goal', x: 500, y: 400 },
  ]), [], { maxSeconds: 5, collectEvents: true });
  check('the wooden back absorbs the beam — balloon survives', !r2.won);
  const r3 = Core.simulate(mk([
    { type: 'mirror', x: 500, y: 636, angle: -45 },
    { type: 'mirror', x: 500, y: 300, angle: 135 },
    { type: 'balloon_goal', x: 800, y: 300 },
  ]), [], { maxSeconds: 5, collectEvents: true });
  check('two mirrors chain: up then right, pops the far balloon', r3.won);
  const r4 = Core.simulate({
    goalType: 'bell',
    fixed: [
      { type: 'laser', x: 100, y: 636, angle: 90 },
      { type: 'ball_marble', x: 100, y: 560 },
      { type: 'mirror', x: 500, y: 636, angle: -45 },
      { type: 'mirror', x: 500, y: 300, angle: 135 },
      { type: 'candle', x: 800, y: 345, lit: false }, // wick sits on the 2nd reflected leg
      { type: 'bell', x: 1250, y: 60 },
    ],
  }, [], { maxSeconds: 4, collectEvents: true });
  check('a twice-reflected beam still lights a cold candle',
    r4.events.some(e => e.type === 'ignite'));
}

// 44. Drawbridge + pullcord: a weight dropped on the ring yanks the cord
//     once, the wired bridge creaks down and becomes a road; unpulled it
//     stays a wall. One-shot; an unwired cord still clicks but moves nothing.
{
  const level = {
    goalType: 'catch',
    fixed: [
      { type: 'shelf', x: 330, y: 500, w: 340, h: 24, angle: 10 },
      { type: 'berry', x: 200, y: 445 },
      { type: 'drawbridge', x: 505, y: 525 },
      { type: 'pullcord', x: 300, y: 250 },
      { type: 'ball_marble', x: 300, y: 300 },        // falls onto the ring
      { type: 'bowl', x: 672, y: 640 },               // under the lowered tip
    ],
  };
  const r = Core.simulate(level, [], { maxSeconds: 20, collectEvents: true });
  const seq = r.events.filter(e => ['cord_pull', 'bridge_down', 'bridge_landed'].includes(e.type)).map(e => e.type);
  check('marble yanks the ring, bridge lowers, berry crosses into the bowl',
    r.won && seq.join(',') === 'cord_pull,bridge_down,bridge_landed', `t=${r.seconds}s [${seq}]`);
  const ctrl = Core.simulate({ ...level, fixed: level.fixed.filter(s => s.type !== 'ball_marble') },
    [], { maxSeconds: 14, collectEvents: true });
  check('unpulled bridge stays a wall — the berry waits, nothing wins',
    !ctrl.won && !ctrl.events.some(e => e.type === 'bridge_down'));
  const twice = Core.simulate({
    ...level,
    fixed: level.fixed.concat([{ type: 'ball_marble', x: 300, y: -1600 }]), // a later drop
  }, [], { maxSeconds: 20, collectEvents: true });
  check('the cord is one-shot: a second weight yanks nothing',
    twice.events.filter(e => e.type === 'cord_pull').length === 1);
  const loose = Core.simulate({
    goalType: 'bell',
    fixed: [
      { type: 'pullcord', x: 300, y: 250 },
      { type: 'ball_marble', x: 300, y: 300 },
      { type: 'bell', x: 1250, y: 60 },
    ],
  }, [], { maxSeconds: 5, collectEvents: true });
  check('an unwired cord clicks its one yank and nothing breaks',
    loose.events.filter(e => e.type === 'cord_pull').length === 1
    && !loose.events.some(e => e.type === 'bridge_down'));
}

// 45. Basket: a basketball falling through the hoop is a WIN signal
//     (goalType 'basket'); baskets only count basketballs; and the cannon
//     can bank one in off the backboard.
{
  const mk = ball => ({
    goalType: 'basket',
    fixed: [
      { type: 'basket', x: 600, y: 400 },
      { type: ball, x: 592, y: 200 },
    ],
  });
  const r1 = Core.simulate(mk('ball_basket'), [], { maxSeconds: 5, collectEvents: true });
  check('basketball through the hoop: swish event + basket goal won',
    r1.won && r1.events.some(e => e.type === 'basket'), `t=${r1.seconds}s`);
  const r2 = Core.simulate(mk('ball_marble'), [], { maxSeconds: 5, collectEvents: true });
  check('baskets only count basketballs: a marble scores nothing',
    !r2.won && !r2.events.some(e => e.type === 'basket'));
  const r3 = Core.simulate({
    goalType: 'basket',
    fixed: [
      { type: 'cannon', x: 200, y: 659, angle: 60 },
      { type: 'ball_basket', x: 182, y: 560 },        // loads the cannon
      { type: 'candle', x: 146, y: 661 },             // lights the fuse
      { type: 'basket', x: 770, y: 320 },
    ],
  }, [], { maxSeconds: 8, collectEvents: true });
  check('cannon three-pointer: lobbed basketball banks in — win', r3.won, `t=${r3.seconds}s`);
}

const fails = results.filter(r => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);

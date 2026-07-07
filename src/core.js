/*
 * Lory's Lab — core simulation module.
 * Runs in the browser (window.LoryCore) and in Node (module.exports) so levels
 * can be verified headlessly. All physics behaviour lives here; rendering,
 * audio and UI live elsewhere and only consume bodies + events.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../vendor/matter.min.js'));
  } else {
    root.LoryCore = factory(root.Matter);
  }
})(typeof self !== 'undefined' ? self : this, function (Matter) {
  'use strict';

  const { Engine, Bodies, Body, Composite, Constraint, Events, Query, Vector } = Matter;

  const WORLD = { w: 1280, h: 720, floorY: 690 };

  // Single source of truth for part geometry + behaviour flags.
  // placeable: can appear in the tray. rot: player-rotatable. dir: has a direction.
  const PART_DEFS = {
    plank:       { w: 160, h: 20,  static: true,  placeable: true, rot: true },
    trampoline:  { w: 110, h: 24,  static: true,  placeable: true },
    seesaw:      { w: 220, h: 16,  static: false, placeable: true },
    fan:         { w: 56,  h: 56,  static: true,  placeable: true, dir: ['right', 'left', 'up'] },
    domino:      { w: 16,  h: 56,  static: false, placeable: true },
    conveyor:    { w: 140, h: 26,  static: true,  placeable: true, dir: ['right', 'left'] },
    bumper:      { r: 26,          static: true,  placeable: true },
    magnet:      { w: 56,  h: 56,  static: true,  placeable: true },
    balloon:     { r: 24,          static: false, placeable: true },
    bucket:      { w: 120, h: 90,  static: true,  placeable: true },
    ball_beach:  { r: 28,          static: false, placeable: true },
    ball_marble: { r: 18,          static: false, placeable: true },
    // Level furniture (not placeable by the player)
    shelf:       { w: 200, h: 24,  static: true,  rot: true, sizable: true },
    wall:        { w: 24,  h: 200, static: true,  sizable: true },
    berry:       { r: 16,          static: false },
    bowl:        { w: 130, h: 70,  static: true },
    bell:        { r: 30,          static: true },
    balloon_goal:{ r: 24,          static: false },
    spikes:      { w: 56,  h: 64,  static: true },  // potted cactus
    sparkle:     { r: 14,          static: true },
  };

  // Material sound classes used by the audio layer.
  const MATERIAL = {
    plank: 'wood', shelf: 'wood', wall: 'wood', seesaw: 'wood', domino: 'domino',
    bucket: 'wood', conveyor: 'wood', trampoline: 'tramp', bumper: 'bumper',
    ball_beach: 'rubber', ball_marble: 'marble', berry: 'berry', magnet: 'magnet',
    balloon: 'balloon', balloon_goal: 'balloon', bell: 'bell', bowl: 'wood', spikes: 'wood',
  };

  const FAN_REACH = 280;
  const FAN_HALF_WIDTH = 52;
  const CONVEYOR_SPEED = 3.2;
  const MAGNET_REACH = 340;
  const MAGNET_ACTIVE_FRAMES = 120; // ~2s pull, then it "gets tired" and releases
  const MAGNET_COOLDOWN_FRAMES = 30;

  let nextId = 1;

  // matter reports collision pairs on compound *part* bodies (bucket/bowl
  // walls), which carry no tag — resolve through the parent.
  function lab(body) {
    const l = body.plugin && body.plugin.lab;
    if (l) return l;
    const p = body.parent;
    return (p && p !== body && p.plugin && p.plugin.lab) || undefined;
  }

  function dirVector(dir) {
    if (dir === 'left') return { x: -1, y: 0 };
    if (dir === 'up') return { x: 0, y: -1 };
    return { x: 1, y: 0 };
  }

  // Create the Matter body (or bodies) for one part instance.
  // Returns { bodies: [...], constraints: [...] } — all get plugin.lab metadata.
  function makePart(spec) {
    const def = PART_DEFS[spec.type];
    if (!def) throw new Error('Unknown part type: ' + spec.type);
    const x = spec.x, y = spec.y;
    const angle = (spec.angle || 0) * Math.PI / 180;
    const w = spec.w || def.w, h = spec.h || def.h;
    const meta = {
      id: 'p' + (nextId++), type: spec.type, dir: spec.dir || (def.dir ? def.dir[0] : null),
      w, h, r: def.r, placed: !!spec.placed, spec,
    };
    const bodies = [], constraints = [];
    const tag = (b, extra) => {
      b.plugin = b.plugin || {};
      b.plugin.lab = Object.assign({}, meta, extra || {});
      b.label = spec.type;
      return b;
    };

    switch (spec.type) {
      case 'plank': case 'shelf': case 'wall': case 'conveyor': case 'spikes':
        bodies.push(tag(Bodies.rectangle(x, y, w, h, {
          isStatic: true, angle, friction: spec.type === 'conveyor' ? 0.9 : 0.4, restitution: 0.1,
        })));
        break;

      case 'trampoline':
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.1, restitution: 0.4 })));
        break;

      case 'bumper':
        bodies.push(tag(Bodies.circle(x, y, def.r, { isStatic: true, restitution: 1.0, friction: 0 })));
        break;

      case 'fan':
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.3, restitution: 0.1 })));
        break;

      case 'magnet':
        // Sleepy magnet: a bump wakes it up (see collisionStart), then it pulls
        // metal marbles for MAGNET_ACTIVE_FRAMES before releasing them.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.4, restitution: 0.2 }),
          { magnet: { active: false, timer: 0, cooldown: 0 } }));
        break;

      case 'domino':
        // friction 0.2 is load-bearing: chains propagate at ~34px spacing
        // (higher friction stalls the chain, lower slides instead of tipping).
        bodies.push(tag(Bodies.rectangle(x, y, w, h, {
          density: 0.002, friction: 0.2, frictionStatic: 0.5, restitution: 0.05,
        })));
        break;

      case 'seesaw': {
        const plank = tag(Bodies.rectangle(x, y, w, h, {
          density: 0.0008, friction: 0.5, restitution: 0.1, frictionAir: 0.008, chamfer: { radius: 4 },
        }));
        bodies.push(plank);
        constraints.push(Constraint.create({
          pointA: { x, y }, bodyB: plank, pointB: { x: 0, y: 0 }, length: 0, stiffness: 0.95,
        }));
        break;
      }

      case 'balloon': case 'balloon_goal': {
        const b = tag(Bodies.circle(x, y, def.r, {
          density: 0.0004, restitution: 0.5, friction: 0.05, frictionAir: 0.045,
        }), { buoyant: true, poppable: true, goalBalloon: spec.type === 'balloon_goal' });
        bodies.push(b);
        if (spec.type === 'balloon_goal') {
          // Tethered so goal balloons bob in place instead of floating away.
          constraints.push(Constraint.create({
            pointA: { x, y: y + 95 }, bodyB: b, pointB: { x: 0, y: 0 },
            length: 95, stiffness: 0.01, damping: 0.05,
          }));
          b.plugin.lab.tetherAnchor = { x, y: y + 95 };
        }
        break;
      }

      case 'bucket': case 'bowl': {
        const wallT = 14;
        const isBowl = spec.type === 'bowl';
        const height = isBowl ? 62 : h;
        const bottom = Bodies.rectangle(x, y + height / 2 - wallT / 2, w, wallT, {});
        const lw = Bodies.rectangle(x - w / 2 + wallT / 2, y, wallT, height, { angle: -0.12 });
        const rw = Bodies.rectangle(x + w / 2 - wallT / 2, y, wallT, height, { angle: 0.12 });
        const compound = Body.create({ parts: [bottom, lw, rw], isStatic: true, friction: 0.4, restitution: 0.05 });
        Body.setPosition(compound, { x, y });
        tag(compound, { height });
        bodies.push(compound);
        if (isBowl) {
          const sensor = Bodies.rectangle(x, y + 8, w - 2 * wallT - 6, height - 24, { isStatic: true, isSensor: true });
          tag(sensor, { sensor: 'bowl' });
          sensor.label = 'bowl_sensor';
          bodies.push(sensor);
        }
        break;
      }

      case 'bell':
        bodies.push(tag(Bodies.circle(x, y, def.r, { isStatic: true, restitution: 0.4, friction: 0.1 })));
        break;

      case 'sparkle': {
        const s = tag(Bodies.circle(x, y, def.r, { isStatic: true, isSensor: true }), { sensor: 'sparkle' });
        s.label = 'sparkle';
        bodies.push(s);
        break;
      }

      case 'berry':
        bodies.push(tag(Bodies.circle(x, y, def.r, {
          density: 0.0015, restitution: 0.3, friction: 0.08, frictionAir: 0.005,
        }), { isBerry: true }));
        break;

      case 'ball_beach':
        bodies.push(tag(Bodies.circle(x, y, def.r, {
          density: 0.0006, restitution: 0.72, friction: 0.03, frictionAir: 0.006,
        })));
        break;

      case 'ball_marble':
        bodies.push(tag(Bodies.circle(x, y, def.r, {
          density: 0.006, restitution: 0.12, friction: 0.02, frictionAir: 0.002,
        })));
        break;

      default:
        throw new Error('makePart: unhandled type ' + spec.type);
    }
    return { bodies, constraints };
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  function createSim(levelDef, placements, opts) {
    opts = opts || {};
    const engine = Engine.create();
    engine.gravity.y = 1;
    engine.positionIterations = 8;
    engine.velocityIterations = 6;

    const state = {
      t: 0, frames: 0, won: false, settled: false,
      goalType: levelDef.goalType || 'catch',
      caughtFrames: 0, bellRung: false,
      balloonsLeft: 0, sparkles: 0, sparkleTotal: 0,
      events: [],   // drained by renderer/audio every frame
      quietFrames: 0,
    };

    const world = engine.world;
    const parts = []; // {spec, bodies, constraints, meta}

    function addSpec(spec) {
      const made = makePart(spec);
      Composite.add(world, made.bodies);
      if (made.constraints.length) Composite.add(world, made.constraints);
      parts.push({ spec, bodies: made.bodies, constraints: made.constraints });
      const m = lab(made.bodies[0]);
      if (m.goalBalloon) state.balloonsLeft++;
      if (spec.type === 'sparkle') state.sparkleTotal++;
      return made;
    }

    // Static world bounds: floor + side walls (ceiling open).
    const bounds = [
      Bodies.rectangle(WORLD.w / 2, WORLD.floorY + 40, WORLD.w + 400, 80, { isStatic: true, friction: 0.5 }),
      Bodies.rectangle(-40, WORLD.h / 2, 80, WORLD.h * 3, { isStatic: true }),
      Bodies.rectangle(WORLD.w + 40, WORLD.h / 2, 80, WORLD.h * 3, { isStatic: true }),
    ];
    bounds.forEach(b => { b.label = 'bounds'; b.plugin = { lab: { type: 'bounds', id: 'bounds' } }; });
    Composite.add(world, bounds);

    (levelDef.fixed || []).forEach(s => addSpec(s));
    (levelDef.sparkles || []).forEach(s => addSpec({ type: 'sparkle', x: s.x, y: s.y }));
    (placements || []).forEach(s => addSpec(Object.assign({ placed: true }, s)));

    const dynamicBodies = () => Composite.allBodies(world).filter(b => !b.isStatic);

    // --- collision handling -------------------------------------------------
    function popBalloon(b) {
      const m = lab(b);
      if (!m || m.popped) return;
      m.popped = true;
      state.events.push({ type: 'pop', x: b.position.x, y: b.position.y, goal: !!m.goalBalloon });
      if (m.goalBalloon) state.balloonsLeft--;
      const part = parts.find(p => p.bodies.includes(b));
      Composite.remove(world, b);
      if (part) part.constraints.forEach(c => Composite.remove(world, c));
    }

    Events.on(engine, 'collisionStart', (ev) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        const la = lab(a), lb = lab(b);
        if (!la || !lb) continue;

        // Sparkle pickup — any dynamic body collects (balloons included:
        // in pop levels the balloon is the hero riding the sparkle path).
        for (const [s, o] of [[a, b], [b, a]]) {
          if (lab(s).sensor === 'sparkle' && !o.isStatic && !lab(s).collected) {
            lab(s).collected = true;
            state.sparkles++;
            state.events.push({ type: 'sparkle', x: s.position.x, y: s.position.y, n: state.sparkles });
            Composite.remove(world, s);
          }
        }

        const relSpeed = Math.hypot(
          a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);

        // Balloon popping: spikes always pop; goal balloons also pop from fast hits.
        for (const [x1, x2] of [[a, b], [b, a]]) {
          const m1 = lab(x1), m2 = lab(x2);
          if (m1.poppable && (m2.type === 'spikes' || (m1.goalBalloon && !x2.isSensor && relSpeed >= 3.5)))
            popBalloon(x1);
        }

        // Bell ring.
        for (const [bell, o] of [[a, b], [b, a]]) {
          if (lab(bell).type === 'bell' && !o.isSensor && relSpeed >= 1.8 && !state.bellRung) {
            state.bellRung = true;
            state.events.push({ type: 'bell', x: bell.position.x, y: bell.position.y });
          }
        }

        // Trampoline boost: reliable, satisfying vertical launch.
        for (const [tr, o] of [[a, b], [b, a]]) {
          if (lab(tr).type === 'trampoline' && !o.isStatic) {
            const vy = o.velocity.y;
            if (vy > 1.5 && o.position.y < tr.position.y) {
              Body.setVelocity(o, { x: o.velocity.x, y: -Math.max(vy * 1.06, 8) });
              state.events.push({ type: 'boing', x: o.position.x, y: tr.position.y, impact: vy, bodyId: o.id, partId: lab(tr).id });
            }
          }
        }

        // Magnet activation: any decent bump wakes a sleeping magnet
        // (and re-bumping an active one keeps it awake longer).
        for (const [mg, o] of [[a, b], [b, a]]) {
          const mm = lab(mg).magnet;
          if (mm && !o.isStatic && !o.isSensor && relSpeed >= 1.6 && mm.cooldown <= 0) {
            const wasOff = !mm.active;
            mm.active = true;
            mm.timer = MAGNET_ACTIVE_FRAMES;
            if (wasOff) state.events.push({ type: 'magnet_on', x: mg.position.x, y: mg.position.y });
          }
        }

        // Bumper ping event (physics handled by restitution).
        if ((la.type === 'bumper' || lb.type === 'bumper') && relSpeed > 1.5) {
          const bump = la.type === 'bumper' ? a : b;
          state.events.push({ type: 'bumper', x: bump.position.x, y: bump.position.y, impact: relSpeed, partId: lab(bump).id });
        }

        // Generic impact event for audio (skip sensors & tiny taps).
        if (!a.isSensor && !b.isSensor && relSpeed > 1.2) {
          const dyn = a.isStatic ? b : a;
          const other = a.isStatic ? a : b;
          state.events.push({
            type: 'hit', impact: relSpeed, bodyId: dyn.id,
            x: pair.collision.supports[0] ? pair.collision.supports[0].x : dyn.position.x,
            y: pair.collision.supports[0] ? pair.collision.supports[0].y : dyn.position.y,
            nx: pair.collision.normal.x, ny: pair.collision.normal.y,
            matA: MATERIAL[lab(dyn).type] || 'wood',
            matB: MATERIAL[lab(other).type] || 'wood',
          });
        }
      }
    });

    // Bowl catch detection via active sensor overlap.
    Events.on(engine, 'collisionActive', (ev) => {
      for (const pair of ev.pairs) {
        for (const [s, o] of [[pair.bodyA, pair.bodyB], [pair.bodyB, pair.bodyA]]) {
          const ls = lab(s);
          if (ls && ls.sensor === 'bowl' && lab(o) && lab(o).isBerry) {
            state.caughtFrames++;
          }
        }
      }
    });

    // --- per-frame forces -----------------------------------------------------
    function applyBehaviours() {
      const all = Composite.allBodies(world);
      for (const p of parts) {
        const spec = p.spec;
        if (spec.type === 'fan') {
          const fanBody = p.bodies[0];
          const m = lab(fanBody);
          const dv = dirVector(m.dir);
          const fx = fanBody.position.x, fy = fanBody.position.y;
          const cx = fx + dv.x * (28 + FAN_REACH / 2);
          const cy = fy + dv.y * (28 + FAN_REACH / 2);
          const hw = dv.x === 0 ? FAN_HALF_WIDTH : FAN_REACH / 2;
          const hh = dv.x === 0 ? FAN_REACH / 2 : FAN_HALF_WIDTH;
          const region = { min: { x: cx - hw, y: cy - hh }, max: { x: cx + hw, y: cy + hh } };
          for (const b of Query.region(all, region)) {
            // berries are immune to wind — a core teaching insight (level 12:
            // "wind can't move a berry, but a wind-blown beach ball can")
            if (b.isStatic || b.isSensor || (lab(b) && lab(b).isBerry)) continue;
            const dist = Math.abs(dv.x !== 0 ? b.position.x - fx : b.position.y - fy);
            const falloff = Math.max(0.35, 1 - dist / (FAN_REACH + 40));
            const heavy = b.density > 0.004;
            const mag = (heavy ? 0.00035 : 0.0019) * Math.min(b.mass, 2.4) * falloff;
            Body.applyForce(b, b.position, { x: dv.x * mag, y: dv.y * mag });
          }
        }
        if (spec.type === 'magnet') {
          const mg = p.bodies[0];
          const mm = lab(mg).magnet;
          if (mm.cooldown > 0) mm.cooldown--;
          if (mm.active) {
            mm.timer--;
            if (mm.timer <= 0) {
              mm.active = false;
              mm.cooldown = MAGNET_COOLDOWN_FRAMES;
              state.events.push({ type: 'magnet_off', x: mg.position.x, y: mg.position.y });
            } else {
              // Pull metal marbles toward the magnet; strong enough to lift
              // against gravity up close, gentle tug at the edge of its reach.
              for (const b of all) {
                if (b.isStatic || lab(b).type !== 'ball_marble') continue;
                const dx = mg.position.x - b.position.x, dy = mg.position.y - b.position.y;
                const dist = Math.hypot(dx, dy);
                if (dist > MAGNET_REACH || dist < 1) continue;
                const ux = dx / dist, uy = dy / dist;
                const approach = b.velocity.x * ux + b.velocity.y * uy;
                if (approach > 9) continue; // speed cap: no slingshots
                const strength = dist < 150 ? 0.0026 : 0.0026 - (dist - 150) * 0.0000074;
                Body.applyForce(b, b.position, { x: ux * strength * b.mass, y: uy * strength * b.mass });
              }
            }
          }
        }
        if (spec.type === 'balloon' || spec.type === 'balloon_goal') {
          const b = p.bodies[0];
          const m = lab(b);
          if (!m.popped) {
            // Net upward: buoyancy 1.65x gravity; frictionAir caps rise speed.
            Body.applyForce(b, b.position, { x: 0, y: -b.mass * engine.gravity.y * 0.001 * 1.65 });
          }
        }
      }

      // Conveyor surface drive: steer contacting bodies toward belt speed.
      const pairs = engine.pairs.list;
      for (const pair of pairs) {
        if (!pair.isActive) continue;
        const la = lab(pair.bodyA), lb = lab(pair.bodyB);
        for (const [belt, o] of [[la, pair.bodyB], [lb, pair.bodyA]]) {
          if (belt && belt.type === 'conveyor' && !o.isStatic) {
            const target = (belt.dir === 'left' ? -1 : 1) * CONVEYOR_SPEED;
            const dvx = target - o.velocity.x;
            Body.setVelocity(o, { x: o.velocity.x + Math.max(-0.4, Math.min(0.4, dvx)), y: o.velocity.y });
            Body.setAngularVelocity(o, o.angularVelocity * 0.9);
          }
        }
      }
    }

    function checkGoal() {
      if (state.won) return;
      if (state.goalType === 'catch' && state.caughtFrames >= 18) state.won = true;
      if (state.goalType === 'bell' && state.bellRung) state.won = true;
      if (state.goalType === 'pop' && state.sparkleTotal >= 0 && state.balloonsLeft === 0 && countGoalBalloons() > 0) state.won = true;
      if (state.won) state.events.push({ type: 'win' });
    }

    function countGoalBalloons() {
      let n = 0;
      for (const p of parts) if (p.spec.type === 'balloon_goal') n++;
      return n;
    }

    function isQuiescent() {
      let maxV = 0;
      for (const b of dynamicBodies()) {
        maxV = Math.max(maxV, Math.hypot(b.velocity.x, b.velocity.y), Math.abs(b.angularVelocity) * 30);
      }
      return maxV < 0.25;
    }

    const sim = {
      engine, world, parts, state, WORLD,
      bodies: () => Composite.allBodies(world),
      constraintsAll: () => Composite.allConstraints(world),
      step() {
        applyBehaviours();
        Engine.update(engine, 1000 / 60);
        state.frames++;
        state.t = state.frames / 60;
        checkGoal();
        if (state.t > 1.5 && !state.won) {
          state.quietFrames = isQuiescent() ? state.quietFrames + 1 : 0;
          if (state.quietFrames >= 100) state.settled = true;
        }
        const ev = state.events;
        state.events = [];
        return ev;
      },
    };
    return sim;
  }

  // Headless verification: run a level with given placements; report outcome.
  function simulate(levelDef, placements, opts) {
    opts = opts || {};
    const maxFrames = Math.round((opts.maxSeconds || 30) * 60);
    const sim = createSim(levelDef, placements, opts);
    const allEvents = [];
    while (sim.state.frames < maxFrames && !sim.state.won) {
      const evs = sim.step();
      if (opts.collectEvents) allEvents.push(...evs);
      if (sim.state.settled) break;
    }
    return {
      won: sim.state.won,
      seconds: +(sim.state.frames / 60).toFixed(2),
      settled: sim.state.settled,
      sparkles: sim.state.sparkles,
      sparkleTotal: sim.state.sparkleTotal,
      events: allEvents,
    };
  }

  // Placement validity: part footprint must not overlap solids (used by editor
  // ghost + also by tests to ensure solutions are legally placeable).
  function placementOverlaps(sim, spec) {
    const made = makePart(spec);
    let overlaps = false;
    // include floor/side walls so parts can't be buried in them (flush contact
    // stays legal via the depth > 2 tolerance)
    const solids = sim.bodies().filter(b => !b.isSensor && lab(b));
    // test compound bodies leaf-by-leaf: the parent hull would seal the open
    // mouth of buckets and bowls
    const leaves = b => (b.parts && b.parts.length > 1 ? b.parts.slice(1) : [b]);
    for (const nb of made.bodies) {
      if (nb.isSensor) continue;
      for (const nleaf of leaves(nb)) {
        for (const sb of solids) {
          for (const sleaf of leaves(sb)) {
            const coll = Matter.Collision.collides(nleaf, sleaf);
            if (coll && coll.collided && coll.depth > 2) { overlaps = true; break; }
          }
          if (overlaps) break;
        }
        if (overlaps) break;
      }
      if (overlaps) break;
    }
    return overlaps;
  }

  return { PART_DEFS, MATERIAL, WORLD, makePart, createSim, simulate, placementOverlaps, Matter };
});

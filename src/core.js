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
    // machine-shop parts (sandbox tray; fully simulated, campaign untouched)
    rope:        { w: 28,  h: 18,  static: true,  placeable: true },  // anchor plate; tether hangs below
    scissors:    { w: 74,  h: 40,  static: true,  placeable: true, rot: true },
    candle:      { w: 26,  h: 58,  static: true,  placeable: true },
    fuse:        { w: 130, h: 12,  static: true,  placeable: true, rot: true },
    hydrant:     { w: 52,  h: 62,  static: true,  placeable: true, dir: ['right', 'left', 'up'] },
    switch:      { w: 84,  h: 20,  static: true,  placeable: true },
    fist:        { w: 66,  h: 46,  static: true,  placeable: true, rot: true },
    match:       { w: 12,  h: 54,  static: true,  placeable: true, rot: true },
    laser:       { w: 44,  h: 56,  static: true,  placeable: true, rot: true },
    bulb:        { w: 44,  h: 58,  static: true,  placeable: true, dir: ['right', 'left', 'up'] },
    lens:        { w: 46,  h: 26,  static: true,  placeable: true, rot: true },
    // the first part with BOTH orientation extras (the wire format holds
    // exactly two, one of each kind): dir mirrors the cannon, `angle` is the
    // BARREL ELEVATION 0–75° — the body itself never rotates, so the loading
    // hatch on top keeps working at every aim
    cannon:      { w: 92,  h: 62,  static: true,  placeable: true, rot: true, dir: ['right', 'left'] },
    mirror:      { w: 68,  h: 14,  static: true,  placeable: true, rot: true },
    drawbridge:  { w: 150, h: 16,  static: true,  placeable: true, dir: ['right', 'left'] }, // anchor = hinge
    pullcord:    { w: 28,  h: 18,  static: true,  placeable: true },  // anchor plate; ring dangles below
    basket:      { w: 96,  h: 120, static: true,  placeable: true, dir: ['right', 'left'] }, // backboard side
    ball_basket: { r: 22,          static: false, placeable: true },
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
    rope: 'wood', scissors: 'magnet', candle: 'wood', fuse: 'wood',
    hydrant: 'magnet', switch: 'wood', fist: 'bumper', match: 'wood', laser: 'magnet',
    bulb: 'magnet', lens: 'magnet', cannon: 'magnet',
    mirror: 'magnet', drawbridge: 'wood', pullcord: 'wood', basket: 'magnet', ball_basket: 'rubber',
  };

  const FAN_REACH = 280;
  const FAN_HALF_WIDTH = 52;
  const CONVEYOR_SPEED = 3.2;
  const MAGNET_REACH = 340;
  const MAGNET_ACTIVE_FRAMES = 120; // ~2s pull, then it "gets tired" and releases
  const MAGNET_COOLDOWN_FRAMES = 30;
  const ROPE_LENGTH = 150;          // anchor to hanging point
  const ROPE_SNAP = 70;             // grab radius around the rope end at sim start
  const FUSE_BURN_FRAMES = 150;     // full fuse burns in ~2.5s
  const FLAME_R = 22;               // ignition/pop radius around a flame point
  const HYDRANT_REACH = 240;
  const HYDRANT_HALF_WIDTH = 46;
  const HYDRANT_ACTIVE_FRAMES = 180; // ~3s of water per bump, then it rests
  const HYDRANT_COOLDOWN_FRAMES = 20;
  const SWITCH_WIRE_REACH = 260;    // links to the nearest fan/conveyor/magnet
  const FIST_LAUNCH = 15;           // punch speed straight up (px/frame)
  const FIST_COOLDOWN = 60;
  const MATCH_FLARE_FRAMES = 150;   // a struck match burns ~2.5s, then it's spent
  const LASER_REACH = 420;
  const LASER_FIRE_FRAMES = 30;     // one trigger buys ~0.5s of beam
  const LASER_COOLDOWN_FRAMES = 50;
  const BULB_BUTTON_COOLDOWN = 20;  // absorbs one landing's contact rattle,
                                    // short enough that a re-bounce re-presses
  const LENS_REACH = 220;           // how close a lit bulb must be to feed a lens
  const CANNON_LAUNCH = 17;         // muzzle speed (px/frame), a touch over the fist's 15
  const CANNON_FUSE_FRAMES = 80;    // breech fuse sizzles ~1.3s of anticipation, then BOOM
  const CANNON_COOLDOWN_FRAMES = 60;// re-arm time before the fuse can be lit again
  const CANNON_MOUTH_HW = 20;       // half-width of the loading-hatch capture zone
  const CANNON_ELEV_MAX = 75;       // barrel elevation clamp (editor + hostile codes)
  const MIRROR_MAX_BOUNCES = 4;     // beam legs after the first — enough for ping-pong tricks
  const BRIDGE_LOWER_FRAMES = 55;   // the drawbridge creaks down in ~0.9s
  const BRIDGE_DIP = 4 * Math.PI / 180; // lands 4° PAST flat, draining toward the tip —
                                    // slow rollers cross instead of stalling mid-deck
  const PULLCORD_DROP = 95;         // anchor to the dangling ring's center
  const PULLCORD_RING_R = 24;       // forgiving grab zone around the ring
  const PULLCORD_WIRE_REACH = 380;  // links to the nearest drawbridge (bridges span far gaps)
  const BASKET_SWISH_COOLDOWN = 40; // one swish per pass-through

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

  // --- small geometry helpers for the machine-shop parts ---------------------
  function toLocal(body, p) {
    const c = Math.cos(-body.angle), s = Math.sin(-body.angle);
    const dx = p.x - body.position.x, dy = p.y - body.position.y;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }
  function pointInOBB(body, p, hw, hh, pad) {
    const l = toLocal(body, p);
    return Math.abs(l.x) <= hw + (pad || 0) && Math.abs(l.y) <= hh + (pad || 0);
  }
  // segment vs oriented box (in the box's local frame, conservative sampling)
  function segIntersectsOBB(a, b, body, hw, hh, pad) {
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const p = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps };
      if (pointInOBB(body, p, hw, hh, pad)) return true;
    }
    return false;
  }
  function distPointSeg(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
  }
  // nearest sampled point of segment a1-a2 that comes within r of segment
  // b1-b2, or null (conservative sampling, same spirit as segIntersectsOBB)
  function segHitSeg(a1, a2, b1, b2, r) {
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const p = { x: a1.x + (a2.x - a1.x) * i / steps, y: a1.y + (a2.y - a1.y) * i / steps };
      if (distPointSeg(p, b1, b2) <= r) return p;
    }
    return null;
  }
  // point on a fuse's long axis for parameter u in [0,1]
  function fusePoint(body, len, u) {
    const c = Math.cos(body.angle), s = Math.sin(body.angle);
    const lx = (u - 0.5) * len;
    return { x: body.position.x + lx * c, y: body.position.y + lx * s };
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

      case 'rope':
        // Anchor plate; at sim start the tether grabs the nearest dynamic body
        // near the rope's hanging end (see createSim). Cut by scissors/flame.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.4, restitution: 0.1 }),
          { rope: { attached: null, cut: false, endY: y + ROPE_LENGTH } }));
        break;

      case 'scissors':
        // Triggered like the other sleepy machines: anything touching them
        // makes the blades snap once (a short cutting window), then re-arm.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, angle, friction: 0.2, restitution: 0.1 }),
          { snips: 0, scis: { snip: 0, cooldown: 0 } }));
        break;

      case 'candle':
        // spec.lit === false places it cold (lightable by any flame/laser);
        // default stays lit so every existing level keeps its behaviour.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.4, restitution: 0.1 }),
          { candle: { lit: spec.lit !== false } }));
        break;

      case 'fuse':
        // Thin sensor strip: bodies pass through; only flames interact with it.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, isSensor: true, angle }),
          { fuse: { active: false, ignited: false, dead: false, a: 0.5, b: 0.5, len: w } }));
        break;

      case 'hydrant':
        // Sleepy like the magnet: a bump on the housing wakes it and it sprays
        // for HYDRANT_ACTIVE_FRAMES; a wired pressure switch can also drive it.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.4, restitution: 0.2 }),
          { hyd: { active: false, timer: 0, cooldown: 0 } }));
        break;

      case 'switch':
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.6, restitution: 0 }),
          { sw: { pressed: 0, target: null, linger: 0 } }));
        break;

      case 'fist':
        // Rotatable 360°: punches along its local "up", i.e. wherever the
        // glove points after rotation.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, angle, friction: 0.4, restitution: 0.1 }),
          { fist: { cooldown: 0 } }));
        break;

      case 'match':
        // Strike-anywhere match: a decent bump flares the head into a real
        // flame for MATCH_FLARE_FRAMES, then the match is spent for good.
        // Rotatable so the head can point at whatever should catch fire.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, angle, friction: 0.4, restitution: 0.1 }),
          { match: { lit: false, timer: 0, dead: false } }));
        break;

      case 'laser':
        // Toy laser cannon, rotatable 360°: fires along its local "up" when
        // touched (or while a wired switch is pressed). The beam stops at the
        // first solid body; see applyBehaviours for what it does on the way.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, angle, friction: 0.3, restitution: 0.2 }),
          { laz: { firing: 0, cooldown: 0, beamLen: 0 } }));
        break;

      case 'bulb':
        // Lightbulb with a real button on the side spec.dir points to: each
        // press toggles the light; a wired switch drives it instead. The glow
        // is harmless by itself — a lens turns it into a beam.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.4, restitution: 0.15 }),
          { bulb: { on: false, cooldown: 0 } }));
        break;

      case 'lens':
        // Focusing lens, rotatable 360°: while a LIT bulb sits within
        // LENS_REACH with a clear line of sight, it fires the same beam as
        // the laser cannon along its local "up".
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, angle, friction: 0.2, restitution: 0.1 }),
          { lens: { firing: 0, beamLen: 0 } }));
        break;

      case 'cannon':
        // Toy cannon. A roller that drops onto the open top hatch is
        // swallowed and the door snaps shut (closed door = loaded & ready);
        // any flame or beam on the breech fuse fires it CANNON_FUSE_FRAMES
        // later. ONE SHOT EACH: once the fuse burns down (shot or dud) the
        // cannon is dead — it never relights and never swallows again, so a
        // parked candle can't make an infinite auto-cannon. spec.angle is
        // barrel ELEVATION (render + launch vector only), deliberately NOT
        // applied to the body: the hatch must stay on top at every aim.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.4, restitution: 0.15 }),
          { cannon: { loaded: false, ball: null, fuseLit: false, fuseT: 0, cooldown: 0, dead: false, doorAnim: 0, fireAnim: 0 } }));
        break;

      case 'mirror':
        // Rotatable 360°: the SHINY face (local "up") reflects laser/lens
        // beams specularly (see castBeam); the wooden back just blocks them.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, angle, friction: 0.2, restitution: 0.3 })));
        break;

      case 'drawbridge': {
        // Hinged at the placement point, starts RAISED (a vertical wall).
        // A wired pullcord lowers it once — smoothstep swing around the
        // hinge over BRIDGE_LOWER_FRAMES — then it is a floor toward
        // spec.dir forever. The body is static but moved per-frame while
        // lowering (see applyBehaviours).
        const s = spec.dir === 'left' ? -1 : 1;
        bodies.push(tag(Bodies.rectangle(x, y - w / 2, w, h, {
          isStatic: true, angle: -s * Math.PI / 2, friction: 0.4, restitution: 0.05, // plank-sibling friction: berries must roll across
        }), { bridge: { t: 0, lowering: false, down: false, hinge: { x, y } } }));
        break;
      }

      case 'pullcord':
        // Anchor plate with a cord + ring dangling PULLCORD_DROP below.
        // Anything falling onto the ring gives ONE yank, which lowers the
        // nearest drawbridge (wired at sim start). One-shot & spent.
        bodies.push(tag(Bodies.rectangle(x, y, w, h, { isStatic: true, friction: 0.4, restitution: 0.1 }),
          { cord: { pulled: false, target: null, yank: 0 } }));
        break;

      case 'basket': {
        // Basketball hoop: solid backboard on the spec.dir side + two rim
        // nubs (balls really bounce off the rim); a net sensor below the
        // rim scores BASKETBALLS ONLY, falling through from above.
        const s = spec.dir === 'left' ? -1 : 1;
        const rimY = y - 14;
        const board = Bodies.rectangle(x + s * (w / 2 - 5), y - 8, 10, 84);
        const nubA = Bodies.circle(x - s * (w / 2 - 6), rimY, 4.5);
        const nubB = Bodies.circle(x + s * (w / 2 - 12), rimY, 4.5);
        const compound = Body.create({ parts: [board, nubA, nubB], isStatic: true, friction: 0.2, restitution: 0.35 });
        tag(compound, {});
        bodies.push(compound);
        const sensor = Bodies.rectangle(x - s * 2, rimY + 26, 52, 30, { isStatic: true, isSensor: true });
        tag(sensor, { sensor: 'basket', swishCd: 0 });
        sensor.label = 'basket_sensor';
        bodies.push(sensor);
        break;
      }

      case 'ball_basket':
        bodies.push(tag(Bodies.circle(x, y, def.r, {
          density: 0.0011, restitution: 0.62, friction: 0.05, frictionAir: 0.004,
        })));
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
      caughtFrames: 0, bellRung: false, basketScored: false,
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

    // --- machine-shop wiring (runs once, after all parts exist) --------------
    // Ropes grab the nearest dynamic body near their hanging end.
    for (const p of parts) {
      if (p.spec.type !== 'rope') continue;
      const anchor = p.bodies[0];
      const m = lab(anchor);
      const end = { x: anchor.position.x, y: anchor.position.y + ROPE_LENGTH };
      let best = null, bd = ROPE_SNAP;
      for (const b of dynamicBodies()) {
        const d = Math.hypot(b.position.x - end.x, b.position.y - end.y);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) {
        // stiff for hanging weights; soft for buoyant bodies — a rigid
        // constraint would PUSH a balloon down like a rod, when a kid
        // expects a balloon-on-a-string that floats up taut (same trick
        // as the goal-balloon tether)
        const c = Constraint.create({
          pointA: { x: anchor.position.x, y: anchor.position.y + m.h / 2 },
          bodyB: best, pointB: { x: 0, y: 0 },
          length: ROPE_LENGTH - m.h / 2,
          stiffness: lab(best).buoyant ? 0.01 : 0.9, damping: 0.05,
        });
        Composite.add(world, c);
        m.rope.attached = best;
        m.rope.constraint = c;
      }
    }
    // Switches wire themselves to the nearest fan/conveyor/magnet.
    for (const p of parts) {
      if (p.spec.type !== 'switch') continue;
      const swBody = p.bodies[0];
      let best = null, bd = SWITCH_WIRE_REACH;
      for (const q of parts) {
        if (!['fan', 'conveyor', 'magnet', 'hydrant', 'laser', 'bulb'].includes(q.spec.type)) continue;
        const d = Math.hypot(q.bodies[0].position.x - swBody.position.x, q.bodies[0].position.y - swBody.position.y);
        if (d < bd) { bd = d; best = q; }
      }
      if (best) {
        lab(swBody).sw.target = lab(best.bodies[0]).id;
        lab(best.bodies[0]).switchControlled = true;
      }
    }
    // Pullcords rope themselves to the nearest drawbridge.
    for (const p of parts) {
      if (p.spec.type !== 'pullcord') continue;
      const cb = p.bodies[0];
      let best = null, bd = PULLCORD_WIRE_REACH;
      for (const q of parts) {
        if (q.spec.type !== 'drawbridge') continue;
        const d = Math.hypot(q.spec.x - cb.position.x, q.spec.y - cb.position.y);
        if (d < bd) { bd = d; best = q; }
      }
      if (best) lab(cb).cord.target = lab(best.bodies[0]).id;
    }

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

        // Pressure plates are memory foam: whatever LANDS on one is absorbed
        // dead instead of bouncing. Matter resolves each pair with the MAX
        // restitution of the two bodies, so a bouncy ball would chatter the
        // plate on/off (or ricochet clean off it) despite the plate's own
        // restitution 0 — kill the fall and most of the roll on contact.
        for (const [sw, o] of [[a, b], [b, a]]) {
          if (lab(sw).type === 'switch' && !o.isStatic && !o.isSensor
            && o.velocity.y > 0.5 && o.position.y < sw.position.y) {
            Body.setVelocity(o, { x: o.velocity.x * 0.4, y: 0 });
            Body.setAngularVelocity(o, o.angularVelocity * 0.4);
          }
        }

        // Magnet activation: any decent bump wakes a sleeping magnet
        // (and re-bumping an active one keeps it awake longer). Switch-wired
        // magnets ignore bumps — the switch decides.
        for (const [mg, o] of [[a, b], [b, a]]) {
          const mm = lab(mg).magnet;
          if (mm && !lab(mg).switchControlled && !o.isStatic && !o.isSensor && relSpeed >= 1.6 && mm.cooldown <= 0) {
            const wasOff = !mm.active;
            mm.active = true;
            mm.timer = MAGNET_ACTIVE_FRAMES;
            if (wasOff) state.events.push({ type: 'magnet_on', x: mg.position.x, y: mg.position.y });
          }
        }

        // Hydrant wake-up: a bump on the housing opens the valve for ~3s.
        for (const [hb, o] of [[a, b], [b, a]]) {
          const hm = lab(hb).hyd;
          if (hm && !lab(hb).switchControlled && !o.isStatic && !o.isSensor
            && relSpeed >= 1.6 && hm.cooldown <= 0) {
            const wasOff = !hm.active;
            hm.active = true;
            hm.timer = HYDRANT_ACTIVE_FRAMES;
            if (wasOff) state.events.push({ type: 'water_on', x: hb.position.x, y: hb.position.y });
          }
        }

        // Scissors trigger: any touch makes the blades snap once (the actual
        // cutting happens during the short snip window in applyBehaviours).
        for (const [sb, o] of [[a, b], [b, a]]) {
          const sc = lab(sb).scis;
          if (sc && !o.isStatic && !o.isSensor && sc.cooldown <= 0 && sc.snip <= 0) {
            sc.snip = 12;                      // ~0.2s cutting window
            sc.cooldown = 45;
            state.events.push({ type: 'snipclick', x: sb.position.x, y: sb.position.y });
          }
        }

        // Match strike: a decent bump anywhere on the stick flares the head.
        for (const [ms, o] of [[a, b], [b, a]]) {
          if (lab(ms).match && !o.isStatic && !o.isSensor && relSpeed >= 1.6) strikeMatch(ms);
        }

        // Laser trigger: any touch fires one beam burst (switch-wired
        // cannons ignore touches — the switch decides).
        for (const [lc, o] of [[a, b], [b, a]]) {
          const meta = lab(lc), lz = meta.laz;
          if (!lz || meta.switchControlled || o.isStatic || o.isSensor) continue;
          if (lz.cooldown > 0 || lz.firing > 0) continue;
          lz.firing = LASER_FIRE_FRAMES;
          lz.cooldown = LASER_FIRE_FRAMES + LASER_COOLDOWN_FRAMES;
          const nx = Math.sin(lc.angle), ny = -Math.cos(lc.angle);
          state.events.push({ type: 'laser', x: lc.position.x + nx * (meta.h / 2 + 4), y: lc.position.y + ny * (meta.h / 2 + 4) });
        }

        // Bulb button: a press on the face spec.dir points to toggles the
        // light (switch-wired bulbs ignore the button — the switch decides).
        for (const [bb, o] of [[a, b], [b, a]]) {
          const meta = lab(bb), bm = meta.bulb;
          if (!bm || meta.switchControlled || o.isStatic || o.isSensor) continue;
          if (bm.cooldown > 0 || relSpeed < 1) continue;
          const dv = dirVector(meta.dir);
          const rel = { x: o.position.x - bb.position.x, y: o.position.y - bb.position.y };
          const along = rel.x * dv.x + rel.y * dv.y;
          const across = Math.abs(rel.x * dv.y - rel.y * dv.x);
          const half = dv.x !== 0 ? meta.w / 2 : meta.h / 2;
          const side = dv.x !== 0 ? meta.h / 2 : meta.w / 2;
          if (along > half - 8 && across < side + 6) {
            bm.on = !bm.on;
            bm.cooldown = BULB_BUTTON_COOLDOWN;
            state.events.push({ type: bm.on ? 'bulb_on' : 'bulb_off', x: bb.position.x, y: bb.position.y });
          }
        }

        // Spring-loaded fist. Two triggers:
        //  - GLOVE side (local -y): punches the toucher itself, as before;
        //  - BACK plunger (local +y): fires the glove remotely, launching
        //    whatever is loaded in front of it — a cannon you can pre-load.
        for (const [fb, o] of [[a, b], [b, a]]) {
          const fm = lab(fb).fist;
          if (!fm || o.isStatic || o.isSensor || fm.cooldown > 0 || relSpeed < 1) continue;
          const meta = lab(fb);
          const l = toLocal(fb, o.position);
          const nx = Math.sin(fb.angle), ny = -Math.cos(fb.angle);
          const launch = (body) => {
            const vn = body.velocity.x * nx + body.velocity.y * ny;
            Body.setVelocity(body, {
              x: body.velocity.x - vn * nx + nx * FIST_LAUNCH,
              y: body.velocity.y - vn * ny + ny * FIST_LAUNCH,
            });
          };
          if (l.y < -6) {
            // direct hit on the glove: punch the toucher
            fm.cooldown = FIST_COOLDOWN;
            launch(o);
            state.events.push({ type: 'thwack', x: fb.position.x + nx * 24, y: fb.position.y + ny * 24, bodyId: o.id, partId: meta.id });
          } else if (l.y > meta.h / 2 - 4) {
            // back plunger pressed: fire, launching everything in the muzzle
            // zone in front of the glove (up to ~55px out)
            fm.cooldown = FIST_COOLDOWN;
            let hit = null;
            for (const bb of Composite.allBodies(world)) {
              if (bb.isStatic || bb.isSensor || bb === o) continue;
              const lb2 = toLocal(fb, bb.position);
              if (Math.abs(lb2.x) <= meta.w / 2 + 12 && lb2.y <= -meta.h / 2 + 6 && lb2.y >= -meta.h / 2 - 55) {
                launch(bb);
                hit = bb;
              }
            }
            state.events.push({ type: 'thwack', x: fb.position.x + nx * 24, y: fb.position.y + ny * 24, bodyId: hit ? hit.id : undefined, partId: meta.id });
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

    // Bowl catch detection via active sensor overlap. The basket net scores
    // the same way — but only BASKETBALLS, only falling through (a swish is
    // transient, so one downward overlap counts; the cooldown stops a single
    // pass from scoring twice).
    Events.on(engine, 'collisionActive', (ev) => {
      for (const pair of ev.pairs) {
        for (const [s, o] of [[pair.bodyA, pair.bodyB], [pair.bodyB, pair.bodyA]]) {
          const ls = lab(s);
          if (ls && ls.sensor === 'bowl' && lab(o) && lab(o).isBerry) {
            state.caughtFrames++;
          }
          if (ls && ls.sensor === 'basket' && lab(o) && lab(o).type === 'ball_basket'
            && o.velocity.y > 1 && ls.swishCd <= 0) {
            ls.swishCd = BASKET_SWISH_COOLDOWN;
            state.basketScored = true;
            state.events.push({ type: 'basket', x: s.position.x, y: s.position.y - 10 });
          }
        }
      }
    });

    // --- machine-shop helpers -------------------------------------------------
    const rectContains = (r, p) => p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y;
    const flameTip = (body, h) => ({ x: body.position.x, y: body.position.y - h / 2 - 8 });
    // the match head sits at the stick's local "up" end, wherever it points
    const matchHead = (body, h) => ({
      x: body.position.x + Math.sin(body.angle) * (h / 2 + 6),
      y: body.position.y - Math.cos(body.angle) * (h / 2 + 6),
    });
    function strikeMatch(body) {
      const m = lab(body), mm = m.match;
      if (mm.lit || mm.dead) return;
      mm.lit = true; mm.timer = MATCH_FLARE_FRAMES;
      const head = matchHead(body, m.h);
      state.events.push({ type: 'ignite', x: head.x, y: head.y });
    }
    // cannon geometry: the body never rotates, so everything is axis-aligned
    // math off dir (side) and spec.angle (barrel elevation, clamped)
    const cannonSide = (m) => m.dir === 'left' ? -1 : 1;
    const cannonElev = (m) => Math.max(0, Math.min(CANNON_ELEV_MAX, m.spec.angle || 0)) * Math.PI / 180;
    // touch-hole at the TOP of the back face: reachable by a candle standing
    // on the same floor as the cannon (flame tips sit high)
    const cannonFuseTip = (body) => {
      const m = lab(body);
      return { x: body.position.x - cannonSide(m) * (m.w / 2 + 8), y: body.position.y - m.h / 2 + 8 };
    };
    const cannonMuzzle = (body) => {
      const m = lab(body), s = cannonSide(m), e = cannonElev(m);
      return { x: body.position.x + s * (10 + Math.cos(e) * 46), y: body.position.y - 10 - Math.sin(e) * 46 };
    };
    function lightCannon(body) {
      const cm = lab(body).cannon;
      if (cm.fuseLit || cm.dead) return; // spent cannons never relight
      cm.fuseLit = true; cm.fuseT = CANNON_FUSE_FRAMES;
      const tip = cannonFuseTip(body);
      state.events.push({ type: 'ignite', x: tip.x, y: tip.y });
    }
    function ropeEnds(p) {
      const anchor = p.bodies[0], m = lab(anchor);
      if (!m.rope.attached) return null;
      return [{ x: anchor.position.x, y: anchor.position.y + m.h / 2 }, m.rope.attached.position];
    }
    function cutRope(p, x, y, cause) {
      const m = lab(p.bodies[0]);
      if (m.rope.cut || !m.rope.attached) return;
      m.rope.cut = true;
      Composite.remove(world, m.rope.constraint);
      m.rope.attached = null;
      state.events.push({ type: 'snip', x, y, cause: cause || 'blade' });
    }
    // a goal balloon's tether string, from the balloon down to its stake
    function tetherEnds(p) {
      const b = p.bodies[0], m = lab(b);
      if (!m.tetherAnchor || m.tetherCut || m.popped) return null;
      return [{ x: b.position.x, y: b.position.y + (m.r || 24) }, m.tetherAnchor];
    }
    function cutTether(p, x, y, cause) {
      const m = lab(p.bodies[0]);
      if (!m.tetherAnchor || m.tetherCut) return;
      m.tetherCut = true;
      m.tetherAnchor = null;                 // renderer switches to a loose string
      for (const c of p.constraints) Composite.remove(world, c);
      state.events.push({ type: 'snip', x, y, cause: cause || 'blade' });
    }
    function igniteFuse(fm, body, u) {
      if (fm.dead) return;
      if (!fm.ignited) {
        fm.ignited = true; fm.active = true; fm.a = u; fm.b = u;
        const pt = fusePoint(body, fm.len, u);
        state.events.push({ type: 'ignite', x: pt.x, y: pt.y });
      } else if (!fm.active && (u <= fm.a + 0.02 || u >= fm.b - 0.02)) {
        fm.active = true; // re-lit at an unburnt tip after being doused
        const pt = fusePoint(body, fm.len, u);
        state.events.push({ type: 'ignite', x: pt.x, y: pt.y });
      }
    }

    // --- per-frame forces -----------------------------------------------------
    function applyBehaviours() {
      const all = Composite.allBodies(world);

      // pressure switches first: devices read poweredNow below
      const pressedTargets = {};
      for (const p of parts) {
        if (p.spec.type !== 'switch') continue;
        const swb = p.bodies[0], m = lab(swb).sw;
        let pressed = false;
        for (const pair of engine.pairs.list) {
          if (!pair.isActive) continue;
          const other = pair.bodyA === swb ? pair.bodyB : pair.bodyB === swb ? pair.bodyA : null;
          if (other && !other.isStatic && !other.isSensor && other.position.y < swb.position.y) { pressed = true; break; }
        }
        // debounce: an absorbed landing can micro-hop ~1px for a few frames —
        // that must not blip the plate (and double-click its sound)
        if (pressed) m.linger = 5;
        else if (m.linger > 0) { m.linger--; pressed = true; }
        if (pressed !== !!m.pressedState) {
          m.pressedState = pressed;
          state.events.push({ type: pressed ? 'switch_on' : 'switch_off', x: swb.position.x, y: swb.position.y });
        }
        if (pressed && m.target) pressedTargets[m.target] = true;
      }
      for (const p of parts) {
        const m0 = lab(p.bodies[0]);
        if (m0.switchControlled) m0.poweredNow = !!pressedTargets[m0.id];
      }

      for (const p of parts) {
        const spec = p.spec;
        if (spec.type === 'fan') {
          const fanBody = p.bodies[0];
          const m = lab(fanBody);
          // spec.on === false places the fan stopped: only a wired switch can
          // run it (the switch always takes over, exactly as before). The
          // running state drives the hum via fan_on/fan_off events, so a fan
          // woken mid-run by its switch hums from that moment.
          const running = m.switchControlled ? !!m.poweredNow : spec.on !== false;
          if (running !== !!m.fanWas) {
            m.fanWas = running;
            state.events.push({ type: running ? 'fan_on' : 'fan_off', x: fanBody.position.x, y: fanBody.position.y });
          }
          if (!running) continue;
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
        if (spec.type === 'conveyor') {
          // spec.on === false places the belt stopped: only a wired switch
          // can run it. Effective-running changes drive the hum via
          // belt_on/belt_off events (fan pattern).
          const m = lab(p.bodies[0]);
          const running = m.switchControlled ? !!m.poweredNow : spec.on !== false;
          if (running !== !!m.beltWas) {
            m.beltWas = running;
            state.events.push({ type: running ? 'belt_on' : 'belt_off', x: p.bodies[0].position.x, y: p.bodies[0].position.y });
          }
        }
        if (spec.type === 'magnet') {
          const mg = p.bodies[0];
          const meta = lab(mg);
          const mm = meta.magnet;
          if (meta.switchControlled) {
            // wired to a pressure switch: powered = pulling, no timer/cooldown
            if (mm.active !== !!meta.poweredNow) {
              mm.active = !!meta.poweredNow;
              state.events.push({ type: mm.active ? 'magnet_on' : 'magnet_off', x: mg.position.x, y: mg.position.y });
            }
            mm.timer = 2;
          }
          if (mm.cooldown > 0) mm.cooldown--;
          if (mm.active) {
            if (!meta.switchControlled) mm.timer--;
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
          if (belt && belt.type === 'conveyor' && !o.isStatic
            && !(belt.switchControlled ? !belt.poweredNow : belt.spec.on === false)) {
            const target = (belt.dir === 'left' ? -1 : 1) * CONVEYOR_SPEED;
            const dvx = target - o.velocity.x;
            Body.setVelocity(o, { x: o.velocity.x + Math.max(-0.4, Math.min(0.4, dvx)), y: o.velocity.y });
            Body.setAngularVelocity(o, o.angularVelocity * 0.9);
          }
        }
      }

      // --- machine shop: water, fire, blades, fists ---------------------------
      // Hydrant jets: push EVERYTHING (water is strong — even berries, unlike
      // fans) and douse any flame they reach. Only while activated: a bump on
      // the housing (see collisionStart) buys ~3s of spray; a wired switch
      // drives it directly.
      for (const p of parts) {
        if (p.spec.type !== 'hydrant') continue;
        const hb = p.bodies[0], m = lab(hb);
        const hy2 = m.hyd;
        if (m.switchControlled) {
          if (hy2.active !== !!m.poweredNow) {
            hy2.active = !!m.poweredNow;
            state.events.push({ type: hy2.active ? 'water_on' : 'water_off', x: hb.position.x, y: hb.position.y });
          }
        } else {
          if (hy2.cooldown > 0) hy2.cooldown--;
          if (hy2.active) {
            hy2.timer--;
            if (hy2.timer <= 0) {
              hy2.active = false;
              hy2.cooldown = HYDRANT_COOLDOWN_FRAMES;
              state.events.push({ type: 'water_off', x: hb.position.x, y: hb.position.y });
            }
          }
        }
        if (!hy2.active) continue;
        const dv = dirVector(m.dir);
        const hx = hb.position.x, hy = hb.position.y;
        const cx = hx + dv.x * (30 + HYDRANT_REACH / 2), cy = hy + dv.y * (34 + HYDRANT_REACH / 2);
        const hw = dv.x === 0 ? HYDRANT_HALF_WIDTH : HYDRANT_REACH / 2;
        const hh = dv.x === 0 ? HYDRANT_REACH / 2 : HYDRANT_HALF_WIDTH;
        const region = { min: { x: cx - hw, y: cy - hh }, max: { x: cx + hw, y: cy + hh } };
        for (const b of Query.region(all, region)) {
          if (b.isStatic || b.isSensor) continue;
          const dist = Math.abs(dv.x !== 0 ? b.position.x - hx : b.position.y - hy);
          const falloff = Math.max(0.4, 1 - dist / (HYDRANT_REACH + 40));
          const heavy = b.density > 0.004;
          const mag = (heavy ? 0.0011 : 0.0032) * Math.min(b.mass, 3) * falloff;
          Body.applyForce(b, b.position, { x: dv.x * mag, y: dv.y * mag });
        }
        for (const q of parts) {
          if (q.spec.type === 'candle') {
            const cm = lab(q.bodies[0]).candle;
            const tip = flameTip(q.bodies[0], lab(q.bodies[0]).h);
            if (cm.lit && rectContains(region, tip)) {
              cm.lit = false;
              state.events.push({ type: 'extinguish', x: tip.x, y: tip.y });
            }
          } else if (q.spec.type === 'match') {
            const mm = lab(q.bodies[0]).match;
            const head = matchHead(q.bodies[0], lab(q.bodies[0]).h);
            if (mm.lit && rectContains(region, head)) {
              mm.lit = false; mm.dead = true; // a soaked match is spent
              state.events.push({ type: 'extinguish', x: head.x, y: head.y });
            }
          } else if (q.spec.type === 'fuse') {
            const fm = lab(q.bodies[0]).fuse;
            if (!fm.active) continue;
            for (const u of [fm.a > 0 ? fm.a : null, fm.b < 1 ? fm.b : null]) {
              if (u == null) continue;
              const pt = fusePoint(q.bodies[0], fm.len, u);
              if (rectContains(region, pt)) {
                fm.active = false;
                state.events.push({ type: 'extinguish', x: pt.x, y: pt.y });
                break;
              }
            }
          } else if (q.spec.type === 'cannon') {
            const cm = lab(q.bodies[0]).cannon;
            const tip = cannonFuseTip(q.bodies[0]);
            if (cm.fuseLit && rectContains(region, tip)) {
              // doused mid-burn: the cord never burned down, so it can be
              // relit — the cannon only dies at burnout (shot or dud)
              cm.fuseLit = false;
              state.events.push({ type: 'extinguish', x: tip.x, y: tip.y });
            }
          }
        }
      }

      // Advance burning fuses (the burnt interval [a,b] grows both ways).
      const burnRate = 1 / FUSE_BURN_FRAMES;
      for (const p of parts) {
        if (p.spec.type !== 'fuse') continue;
        const fm = lab(p.bodies[0]).fuse;
        if (!fm.active) continue;
        fm.a = Math.max(0, fm.a - burnRate);
        fm.b = Math.min(1, fm.b + burnRate);
        if (fm.a <= 0 && fm.b >= 1) { fm.active = false; fm.dead = true; }
      }

      // Burn down flaring matches; a spent match never lights again.
      for (const p of parts) {
        if (p.spec.type !== 'match') continue;
        const mm = lab(p.bodies[0]).match;
        if (!mm.lit) continue;
        mm.timer--;
        if (mm.timer <= 0) {
          mm.lit = false; mm.dead = true;
          const head = matchHead(p.bodies[0], lab(p.bodies[0]).h);
          state.events.push({ type: 'extinguish', x: head.x, y: head.y });
        }
      }

      // Collect live flame points: lit candles + flaring matches + fuse fronts.
      const flames = [];
      for (const p of parts) {
        if (p.spec.type === 'candle' && lab(p.bodies[0]).candle.lit) {
          flames.push(flameTip(p.bodies[0], lab(p.bodies[0]).h));
        } else if (p.spec.type === 'match' && lab(p.bodies[0]).match.lit) {
          flames.push(matchHead(p.bodies[0], lab(p.bodies[0]).h));
        } else if (p.spec.type === 'fuse') {
          const fm = lab(p.bodies[0]).fuse;
          if (!fm.active) continue;
          if (fm.a > 0) flames.push(fusePoint(p.bodies[0], fm.len, fm.a));
          if (fm.b < 1) flames.push(fusePoint(p.bodies[0], fm.len, fm.b));
        }
      }
      // Flames act on the world: pop balloons, light fuses/candles, burn ropes.
      for (const f of flames) {
        for (const b of all) {
          const mb = lab(b);
          if (mb && mb.poppable && !mb.popped
            && Math.hypot(b.position.x - f.x, b.position.y - f.y) < FLAME_R + (mb.r || 20)) popBalloon(b);
        }
        for (const q of parts) {
          if (q.spec.type === 'fuse') {
            const qb = q.bodies[0], fm = lab(qb).fuse;
            if (fm.dead) continue;
            const l = toLocal(qb, f);
            if (Math.abs(l.y) <= lab(qb).h / 2 + 10 && Math.abs(l.x) <= fm.len / 2 + 6) {
              igniteFuse(fm, qb, Math.max(0, Math.min(1, (l.x + fm.len / 2) / fm.len)));
            }
          } else if (q.spec.type === 'candle') {
            const cm = lab(q.bodies[0]).candle;
            const tip = flameTip(q.bodies[0], lab(q.bodies[0]).h);
            if (!cm.lit && Math.hypot(tip.x - f.x, tip.y - f.y) < FLAME_R * 1.3) {
              cm.lit = true;
              state.events.push({ type: 'ignite', x: tip.x, y: tip.y });
            }
          } else if (q.spec.type === 'match') {
            const mm = lab(q.bodies[0]).match;
            const head = matchHead(q.bodies[0], lab(q.bodies[0]).h);
            if (!mm.lit && !mm.dead && Math.hypot(head.x - f.x, head.y - f.y) < FLAME_R * 1.3)
              strikeMatch(q.bodies[0]);
          } else if (q.spec.type === 'cannon') {
            // deliberately one-way: the cannon's sizzling breech fuse is
            // never itself a flame point (it fires the cannon, nothing else)
            const tip = cannonFuseTip(q.bodies[0]);
            if (Math.hypot(tip.x - f.x, tip.y - f.y) < FLAME_R * 1.3)
              lightCannon(q.bodies[0]);
          } else if (q.spec.type === 'rope') {
            const ends = ropeEnds(q);
            if (ends && distPointSeg(f, ends[0], ends[1]) < 14) cutRope(q, f.x, f.y, 'fire');
          } else if (q.spec.type === 'balloon_goal') {
            const ends = tetherEnds(q);
            if (ends && distPointSeg(f, ends[0], ends[1]) < 14) cutTether(q, f.x, f.y, 'fire');
          }
        }
      }

      // Scissors: tick trigger timers; blades only cut during the snip window
      // right after something touches them.
      for (const p of parts) {
        if (p.spec.type !== 'scissors') continue;
        const sb = p.bodies[0], sm = lab(sb);
        if (sm.scis.cooldown > 0) sm.scis.cooldown--;
        if (sm.scis.snip <= 0) continue;
        sm.scis.snip--;
        for (const q of parts) {
          if (q.spec.type === 'rope') {
            const ends = ropeEnds(q);
            if (ends && segIntersectsOBB(ends[0], ends[1], sb, sm.w / 2, sm.h / 2, 2)) {
              sm.snips = (sm.snips || 0) + 1;
              cutRope(q, sb.position.x, sb.position.y, 'blade');
            }
          } else if (q.spec.type === 'balloon_goal') {
            const ends = tetherEnds(q);
            if (ends && segIntersectsOBB(ends[0], ends[1], sb, sm.w / 2, sm.h / 2, 2)) {
              sm.snips = (sm.snips || 0) + 1;
              cutTether(q, sb.position.x, sb.position.y, 'blade');
            }
          }
        }
      }

      // What one beam segment does to the world: pop balloons, light
      // candles/matches/cannon fuses, ignite fuse cords at the crossing
      // point, burn ropes and tether strings. Shared by every beam leg.
      function beamSegmentEffects(a, b) {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        for (const bb of all) {
          const mb = lab(bb);
          if (mb && mb.poppable && !mb.popped
            && distPointSeg(bb.position, a, b) < (mb.r || 20) + 4) popBalloon(bb);
        }
        for (const q of parts) {
          if (q.spec.type === 'candle') {
            const cm = lab(q.bodies[0]).candle;
            const tip = flameTip(q.bodies[0], lab(q.bodies[0]).h);
            if (!cm.lit && distPointSeg(tip, a, b) < 20) {
              cm.lit = true;
              state.events.push({ type: 'ignite', x: tip.x, y: tip.y });
            }
          } else if (q.spec.type === 'match') {
            const mm = lab(q.bodies[0]).match;
            const head = matchHead(q.bodies[0], lab(q.bodies[0]).h);
            if (!mm.lit && !mm.dead && distPointSeg(head, a, b) < 20)
              strikeMatch(q.bodies[0]);
          } else if (q.spec.type === 'cannon') {
            const tip = cannonFuseTip(q.bodies[0]);
            if (distPointSeg(tip, a, b) < 20) lightCannon(q.bodies[0]);
          } else if (q.spec.type === 'fuse') {
            const qb = q.bodies[0], fm = lab(qb).fuse;
            if (fm.dead) continue;
            for (let s = 0; s <= len; s += 6) {
              const l = toLocal(qb, { x: a.x + ux * s, y: a.y + uy * s });
              if (Math.abs(l.y) <= lab(qb).h / 2 + 6 && Math.abs(l.x) <= fm.len / 2 + 4) {
                igniteFuse(fm, qb, Math.max(0, Math.min(1, (l.x + fm.len / 2) / fm.len)));
                break;
              }
            }
          } else if (q.spec.type === 'rope') {
            const ends = ropeEnds(q);
            const hit = ends && segHitSeg(a, b, ends[0], ends[1], 8);
            if (hit) cutRope(q, hit.x, hit.y, 'fire');
          } else if (q.spec.type === 'balloon_goal') {
            const ends = tetherEnds(q);
            const hit = ends && segHitSeg(a, b, ends[0], ends[1], 8);
            if (hit) cutTether(q, hit.x, hit.y, 'fire');
          }
        }
      }

      // The beam engine, shared by the laser cannon and the lens: march from
      // the emitter's muzzle along local "up" to the first solid body — and
      // BOUNCE off mirror faces (specular reflection off the shiny front;
      // the wooden back absorbs), up to MIRROR_MAX_BOUNCES legs with fresh
      // LASER_REACH each ("mirrors give the beam new legs"). Every leg
      // applies the full beamSegmentEffects. Sensors and balloons never
      // block the beam.
      function castBeam(cb, m, bz) {
        let dx = Math.sin(cb.angle), dy = -Math.cos(cb.angle);
        let px = cb.position.x + dx * (m.h / 2 + 4), py = cb.position.y + dy * (m.h / 2 + 4);
        const path = [{ x: px, y: py }];
        // whatever is pressed right against the emitter — often the very body
        // that triggered the shot — must not eat the beam: shoot straight
        // through anything overlapping the first sample point
        const pointBlank = Query.point(all, { x: px + dx * 6, y: py + dy * 6 });
        let skipId = m.id; // the emitter on leg 0; the just-bounced mirror after
        for (let leg = 0; leg <= MIRROR_MAX_BOUNCES; leg++) {
          let len = LASER_REACH, hit = null;
          outer:
          for (let s = 6; s <= LASER_REACH; s += 6) {
            const pt = { x: px + dx * s, y: py + dy * s };
            for (const b of Query.point(all, pt)) {
              if (b.isSensor || (leg === 0 && pointBlank.includes(b))) continue;
              const mb = lab(b);
              if (mb && (mb.id === skipId || mb.poppable)) continue;
              len = s; hit = b; break outer;
            }
          }
          const end = { x: px + dx * len, y: py + dy * len };
          beamSegmentEffects({ x: px, y: py }, end);
          path.push(end);
          if (leg === 0) bz.beamLen = len; // painters read this for the muzzle glow
          const mb = hit && lab(hit);
          if (!mb || mb.type !== 'mirror') break;
          const nx = Math.sin(hit.angle), ny = -Math.cos(hit.angle); // shiny-face normal
          const dn = dx * nx + dy * ny;
          if (dn >= 0) break;                    // wooden back: absorbed
          dx = dx - 2 * dn * nx; dy = dy - 2 * dn * ny;
          px = end.x + dx * 4; py = end.y + dy * 4; // step off the glass
          skipId = mb.id;
        }
        bz.beamPath = path; // renderer draws the whole polyline from this
      }

      // Laser cannons: touch bursts (or a wired switch) drive the beam.
      for (const p of parts) {
        if (p.spec.type !== 'laser') continue;
        const cb = p.bodies[0], m = lab(cb), lz = m.laz;
        if (m.switchControlled) {
          if (m.poweredNow && lz.firing <= 0)
            state.events.push({ type: 'laser', x: cb.position.x, y: cb.position.y });
          lz.firing = m.poweredNow ? 2 : 0;
        } else {
          if (lz.cooldown > 0) lz.cooldown--;
          if (lz.firing > 0) lz.firing--;
        }
        if (lz.firing <= 0) { lz.beamLen = 0; continue; }
        castBeam(cb, m, lz);
      }

      // Bulbs tick their button cooldown; a wired switch drives them directly.
      for (const p of parts) {
        if (p.spec.type !== 'bulb') continue;
        const m = lab(p.bodies[0]), bm = m.bulb;
        if (bm.cooldown > 0) bm.cooldown--;
        if (m.switchControlled && bm.on !== !!m.poweredNow) {
          bm.on = !!m.poweredNow;
          state.events.push({ type: bm.on ? 'bulb_on' : 'bulb_off', x: p.bodies[0].position.x, y: p.bodies[0].position.y });
        }
      }

      // Lenses: a LIT bulb within LENS_REACH and in clear line of sight feeds
      // the lens, which focuses the light into the same beam as the laser.
      // Solid bodies block the light path (sensors and balloons don't).
      for (const p of parts) {
        if (p.spec.type !== 'lens') continue;
        const lb = p.bodies[0], m = lab(lb), lz = m.lens;
        let fed = null;
        for (const q of parts) {
          if (q.spec.type !== 'bulb' || !lab(q.bodies[0]).bulb.on) continue;
          const bb = q.bodies[0];
          const dist = Math.hypot(bb.position.x - lb.position.x, bb.position.y - lb.position.y);
          if (dist > LENS_REACH) continue;
          let blocked = false;
          const steps = Math.max(2, Math.ceil(dist / 8));
          for (let i = 1; i < steps && !blocked; i++) {
            const pt = { x: bb.position.x + (lb.position.x - bb.position.x) * i / steps,
                         y: bb.position.y + (lb.position.y - bb.position.y) * i / steps };
            for (const o of Query.point(all, pt)) {
              if (o.isSensor) continue;
              const mo = lab(o);
              if (mo && (mo.id === m.id || mo.id === lab(bb).id || mo.poppable)) continue;
              blocked = true; break;
            }
          }
          if (!blocked) { fed = bb; break; }
        }
        m.fedBy = fed ? fed.position : null; // renderer draws the light feed
        if (fed && lz.firing <= 0)
          state.events.push({ type: 'laser', x: lb.position.x, y: lb.position.y });
        lz.firing = fed ? 2 : 0;
        if (lz.firing <= 0) { lz.beamLen = 0; continue; }
        castBeam(lb, m, lz);
      }

      // Fist cooldown / punch animation timer.
      for (const p of parts) {
        if (p.spec.type !== 'fist') continue;
        const fm = lab(p.bodies[0]).fist;
        if (fm.cooldown > 0) fm.cooldown--;
      }

      // Cannons. Loading: a roller (any dynamic circle that isn't buoyant or
      // poppable — beach ball, marble, berry) whose center drops into the
      // hatch zone above the top face is swallowed; the door snaps shut
      // (closed door = loaded & ready — the visual cue). Firing: when the lit
      // breech fuse burns down, the stored ball reappears at the muzzle with
      // CANNON_LAUNCH speed along the barrel; empty cannons just cough a dud.
      for (const p of parts) {
        if (p.spec.type !== 'cannon') continue;
        const cb = p.bodies[0], m = lab(cb), cm = m.cannon;
        if (cm.cooldown > 0) cm.cooldown--;
        if (cm.doorAnim > 0) cm.doorAnim--;
        if (cm.fireAnim > 0) cm.fireAnim--;
        const s = cannonSide(m);
        if (!cm.loaded && !cm.dead) { // a spent cannon never swallows again
          for (const b of all) {
            if (b.isStatic || b.isSensor || !b.circleRadius) continue;
            const mb = lab(b);
            if (!mb || mb.poppable || mb.buoyant || mb.swallowed) continue;
            if (b.velocity.y < -0.5) continue; // rising bodies fly past, they don't "fall in"
            const lx = b.position.x - cb.position.x, ly = b.position.y - cb.position.y;
            if (Math.abs(lx + s * 18) > CANNON_MOUTH_HW || ly > -m.h / 2 + 4 || ly < -m.h / 2 - 36) continue;
            // a ball on an uncut rope hangs — it can't drop into the hatch
            if (parts.some(q => q.spec.type === 'rope'
              && lab(q.bodies[0]).rope.attached === b && !lab(q.bodies[0]).rope.cut)) continue;
            mb.swallowed = true;
            Composite.remove(world, b);
            cm.loaded = true; cm.ball = b; cm.doorAnim = 10;
            state.events.push({ type: 'cannon_load', x: cb.position.x - s * 18, y: cb.position.y - m.h / 2, partId: m.id });
            break;
          }
        }
        if (!cm.fuseLit) continue;
        cm.fuseT--;
        if (cm.fuseT > 0) continue;
        // burnout: one shot each — dead either way (cooldown is only the
        // renderer's smoke-wisp window now)
        cm.fuseLit = false;
        cm.dead = true;
        cm.cooldown = CANNON_COOLDOWN_FRAMES;
        const mz = cannonMuzzle(cb);
        if (cm.loaded && cm.ball) {
          const ball = cm.ball, e = cannonElev(m);
          const ux = Math.cos(e) * s, uy = -Math.sin(e);
          lab(ball).swallowed = false;
          Body.setPosition(ball, { x: mz.x + ux * (ball.circleRadius + 2), y: mz.y + uy * (ball.circleRadius + 2) });
          Body.setVelocity(ball, { x: ux * CANNON_LAUNCH, y: uy * CANNON_LAUNCH });
          Body.setAngularVelocity(ball, 0);
          Composite.add(world, ball);
          cm.loaded = false; cm.ball = null; cm.fireAnim = 14; // door stays shut: spent
          state.events.push({ type: 'cannon_fire', x: mz.x, y: mz.y, bodyId: ball.id, partId: m.id });
        } else {
          cm.doorAnim = 10; // the empty dud closes its lid for good
          state.events.push({ type: 'cannon_dud', x: mz.x, y: mz.y, partId: m.id });
        }
      }

      // Pullcords: anything falling onto the dangling ring gives ONE yank,
      // which starts the wired drawbridge's descent. One-shot & spent.
      for (const p of parts) {
        if (p.spec.type !== 'pullcord') continue;
        const cb = p.bodies[0], m = lab(cb), cm = m.cord;
        if (cm.yank > 0) cm.yank--;
        if (cm.pulled) continue;
        const ring = { x: cb.position.x, y: cb.position.y + PULLCORD_DROP };
        for (const b of all) {
          if (b.isStatic || b.isSensor || b.velocity.y < 1) continue; // must FALL onto it
          if (Math.hypot(b.position.x - ring.x, b.position.y - ring.y)
            > PULLCORD_RING_R + (b.circleRadius || 10)) continue;
          cm.pulled = true; cm.yank = 14;
          state.events.push({ type: 'cord_pull', x: ring.x, y: ring.y });
          for (const q of parts) {
            if (q.spec.type !== 'drawbridge' || lab(q.bodies[0]).id !== cm.target) continue;
            const bm = lab(q.bodies[0]).bridge;
            if (!bm.down && !bm.lowering) {
              bm.lowering = true;
              state.events.push({ type: 'bridge_down', x: bm.hinge.x, y: bm.hinge.y });
            }
          }
          break;
        }
      }

      // Drawbridges: swing down around the hinge once triggered (static
      // body moved kinematically; smoothstep so it lands softly).
      for (const p of parts) {
        if (p.spec.type !== 'drawbridge') continue;
        const bb = p.bodies[0], m = lab(bb), bm = m.bridge;
        if (!bm.lowering) continue;
        bm.t = Math.min(1, bm.t + 1 / BRIDGE_LOWER_FRAMES);
        const k = bm.t * bm.t * (3 - 2 * bm.t);
        const phi = (1 - k) * (Math.PI / 2 + BRIDGE_DIP) - BRIDGE_DIP;
        const s = m.dir === 'left' ? -1 : 1;
        Body.setPosition(bb, {
          x: bm.hinge.x + s * Math.cos(phi) * m.w / 2,
          y: bm.hinge.y - Math.sin(phi) * m.w / 2,
        });
        Body.setAngle(bb, -s * phi);
        if (bm.t >= 1) {
          bm.lowering = false; bm.down = true;
          state.events.push({ type: 'bridge_landed', x: bm.hinge.x + s * m.w, y: bm.hinge.y });
        }
      }

      // Basket nets tick their swish cooldown (one score per pass-through).
      for (const p of parts) {
        if (p.spec.type !== 'basket') continue;
        const sm = lab(p.bodies[1]);
        if (sm.swishCd > 0) sm.swishCd--;
      }
    }

    function checkGoal() {
      if (state.won) return;
      if (state.goalType === 'catch' && state.caughtFrames >= 18) state.won = true;
      if (state.goalType === 'bell' && state.bellRung) state.won = true;
      if (state.goalType === 'basket' && state.basketScored) state.won = true;
      if (state.goalType === 'pop' && state.sparkleTotal >= 0 && state.balloonsLeft === 0 && countGoalBalloons() > 0) state.won = true;
      if (state.won) state.events.push({ type: 'win' });
    }

    function countGoalBalloons() {
      let n = 0;
      for (const p of parts) if (p.spec.type === 'balloon_goal') n++;
      return n;
    }

    function isQuiescent() {
      // pending action is never "stuck": a burning fuse, a flaring match,
      // a spraying hydrant or a firing laser will still change the world
      for (const p of parts) {
        if (p.spec.type === 'fuse' && lab(p.bodies[0]).fuse.active) return false;
        if (p.spec.type === 'match' && lab(p.bodies[0]).match.lit) return false;
        if (p.spec.type === 'hydrant' && lab(p.bodies[0]).hyd.active) return false;
        if (p.spec.type === 'laser' && lab(p.bodies[0]).laz.firing > 0) return false;
        if (p.spec.type === 'lens' && lab(p.bodies[0]).lens.firing > 0) return false;
        if (p.spec.type === 'cannon' && lab(p.bodies[0]).cannon.fuseLit) return false;
        if (p.spec.type === 'drawbridge' && lab(p.bodies[0]).bridge.lowering) return false;
      }
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

  // ---------------------------------------------------------------------------
  // Puzzle wire format — share links, .lorypuzzle files, the community shelf.
  // `LORY1.<base64url(deflate-raw(json))>`, or `LORY0.<base64url(json)>` when
  // CompressionStream is unavailable. The json payload:
  //   { v:1|2, name, by?, goal?, fixed:[[type,x,y,...extras],...], plucked:[[...],...] }
  // goal is 'bell' or 'basket' (absent = the classic berry-into-bowl catch);
  // a goal-bearing puzzle encodes as v:2 ON PURPOSE so older games say
  // "needs a newer Lory's Lab" instead of mis-running it as catch — plain
  // catch puzzles keep encoding as v:1 and stay openable everywhere.
  // Up to TWO extras, at most one of each kind: number = angle (rot parts),
  // string = dir (dir parts, default omitted), false = starts off (cold
  // candle, stopped fan). Decoding trusts NOTHING: every field is validated
  // and copied into fresh objects, so no foreign key (e.g. __proto__) ever
  // reaches game state.
  // ---------------------------------------------------------------------------
  const PUZZLE_FORMAT_V = 2;      // highest payload version we understand
  const PUZZLE_MAX_PARTS = 100;   // perf guard: no puzzle needs more
  const PUZZLE_MAX_CODE = 20000;  // chars, before any decoding
  const PUZZLE_MAX_JSON = 262144; // bytes after inflate (zip-bomb guard)

  const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64uEncode(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      s += B64U[a >> 2] + B64U[((a & 3) << 4) | (b >> 4)];
      if (i + 1 < bytes.length) s += B64U[((b & 15) << 2) | (c >> 6)];
      if (i + 2 < bytes.length) s += B64U[c & 63];
    }
    return s;
  }
  function b64uDecode(s) {
    if (s.length % 4 === 1) throw new Error('bad-format');
    const idx = new Array(s.length);
    for (let i = 0; i < s.length; i++) {
      idx[i] = B64U.indexOf(s[i]);
      if (idx[i] < 0) throw new Error('bad-format');
    }
    const out = new Uint8Array(Math.floor(s.length * 3 / 4));
    let o = 0;
    for (let i = 0; i + 1 < s.length; i += 4) {
      out[o++] = (idx[i] << 2) | (idx[i + 1] >> 4);
      if (i + 2 < s.length) out[o++] = ((idx[i + 1] & 15) << 4) | (idx[i + 2] >> 2);
      if (i + 3 < s.length) out[o++] = ((idx[i + 2] & 3) << 6) | idx[i + 3];
    }
    return out;
  }

  // Run bytes through a (De)CompressionStream, capping the output size so a
  // hostile tiny code can't inflate into a memory bomb.
  async function pipeBytes(bytes, Ctor, maxLen) {
    const reader = new Blob([bytes]).stream().pipeThrough(new Ctor('deflate-raw')).getReader();
    const chunks = []; let total = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      total += r.value.length;
      if (maxLen && total > maxLen) { reader.cancel(); throw new Error('bad-format'); }
      chunks.push(r.value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // Validate one part's fields; returns a FRESH spec object or throws.
  function puzzleCheckPart(type, x, y, extras) {
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(PART_DEFS, type))
      throw new Error('newer-version'); // unknown part: likely a newer game
    const def = PART_DEFS[type];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('bad-data');
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x > WORLD.w || y < 0 || y > WORLD.h) throw new Error('bad-data');
    const spec = { type, x, y };
    for (const extra of extras) {
      if (typeof extra === 'number' && def.rot && Number.isFinite(extra) && spec.angle === undefined) {
        spec.angle = ((Math.round(extra) % 360) + 360) % 360;
      } else if (typeof extra === 'string' && def.dir && def.dir.indexOf(extra) >= 0 && spec.dir === undefined) {
        spec.dir = extra;
      } else if (extra === false && type === 'candle' && spec.lit === undefined) {
        spec.lit = false;
      } else if (extra === false && (type === 'fan' || type === 'conveyor') && spec.on === undefined) {
        spec.on = false;
      } else throw new Error('bad-data');
    }
    return spec;
  }

  // The optional extras of a local spec (encode side; junk fields on
  // non-applicable parts are silently dropped — local data is trusted-ish).
  // At most one of each kind: dir string (non-default), angle number, and
  // `false` for parts that can start switched off (cold candle, stopped fan).
  function puzzleExtras(spec) {
    const def = PART_DEFS[spec.type];
    const out = [];
    if (def && def.dir && spec.dir != null && spec.dir !== def.dir[0]) out.push(spec.dir);
    if (def && def.rot && spec.angle) {
      const a = ((Math.round(spec.angle) % 360) + 360) % 360;
      if (a) out.push(a);
    }
    if ((spec.type === 'candle' && spec.lit === false)
      || ((spec.type === 'fan' || spec.type === 'conveyor') && spec.on === false)) out.push(false);
    return out;
  }
  function puzzleTuple(spec) {
    return [spec.type, spec.x, spec.y].concat(puzzleExtras(spec));
  }

  const stripText = (s, max) => typeof s === 'string'
    ? s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

  // Normalize + validate a whole puzzle (object specs OR wire tuples).
  function puzzleSanitize(p) {
    if (!p || typeof p !== 'object') throw new Error('bad-data');
    const name = stripText(p.name, 24) || 'Puzzle';
    const by = stripText(p.by, 12);
    // goal: absent/'catch' = classic berry-into-bowl; 'bell'/'basket' are the
    // alternate endings. Anything else is not a puzzle we understand.
    let goal = p.goal == null || p.goal === 'catch' ? null : p.goal;
    if (goal !== null && goal !== 'bell' && goal !== 'basket') throw new Error('bad-data');
    const rows = { fixed: [], plucked: [] };
    for (const key of ['fixed', 'plucked']) {
      const arr = p[key];
      if (!Array.isArray(arr)) throw new Error('bad-data');
      for (const s of arr) {
        if (Array.isArray(s)) {
          if (s.length < 3 || s.length > 5) throw new Error('bad-data');
          rows[key].push(puzzleCheckPart(s[0], s[1], s[2], s.slice(3)));
        } else if (s && typeof s === 'object') {
          rows[key].push(puzzleCheckPart(s.type, s.x, s.y, puzzleExtras(s)));
        } else throw new Error('bad-data');
      }
    }
    const all = rows.fixed.concat(rows.plucked);
    if (all.length > PUZZLE_MAX_PARTS) throw new Error('bad-data');
    if (!rows.plucked.length) throw new Error('bad-data');           // no tray = not a puzzle
    // every ending needs its parts on the table
    const has = t => all.some(s => s.type === t);
    if (goal === 'bell') { if (!has('bell')) throw new Error('bad-data'); }
    else if (goal === 'basket') { if (!has('basket') || !has('ball_basket')) throw new Error('bad-data'); }
    else if (!has('berry') || !has('bowl')) throw new Error('bad-data'); // catch needs both
    const out = { name, by, fixed: rows.fixed, plucked: rows.plucked };
    if (goal) out.goal = goal;
    return out;
  }

  async function puzzleEncode(p) {
    const clean = puzzleSanitize(p);
    // catch puzzles stay v:1 (openable by every game version); a goal-bearing
    // puzzle is v:2 so old versions ask for an update instead of mis-running it
    const payload = { v: clean.goal ? 2 : 1, name: clean.name };
    if (clean.by) payload.by = clean.by;
    if (clean.goal) payload.goal = clean.goal;
    payload.fixed = clean.fixed.map(puzzleTuple);
    payload.plucked = clean.plucked.map(puzzleTuple);
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (typeof CompressionStream === 'function') {
      return 'LORY1.' + b64uEncode(await pipeBytes(bytes, CompressionStream));
    }
    return 'LORY0.' + b64uEncode(bytes); // ancient browser: plain but valid
  }

  async function puzzleDecode(code) {
    if (typeof code !== 'string' || code.length > PUZZLE_MAX_CODE) throw new Error('bad-format');
    const m = /^LORY(\d+)\.([A-Za-z0-9\-_]+)$/.exec(code.trim());
    if (!m) throw new Error('bad-format');
    let bytes = b64uDecode(m[2]);
    if (m[1] === '1') {
      if (typeof DecompressionStream !== 'function') throw new Error('newer-version');
      try { bytes = await pipeBytes(bytes, DecompressionStream, PUZZLE_MAX_JSON); }
      catch (e) { throw new Error('bad-format'); }
    } else if (m[1] !== '0') throw new Error('newer-version');
    if (bytes.length > PUZZLE_MAX_JSON) throw new Error('bad-format');
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new Error('bad-format'); }
    if (!payload || typeof payload !== 'object'
      || !Number.isInteger(payload.v) || payload.v < 1 || payload.v > PUZZLE_FORMAT_V) throw new Error('newer-version');
    return puzzleSanitize(payload);
  }

  // Stable identity for import dedupe: same name+author+goal+layout = same puzzle.
  function puzzleCanonical(p) {
    const clean = puzzleSanitize(p);
    return JSON.stringify([clean.name, clean.by, clean.goal || 'catch',
      clean.fixed.map(puzzleTuple), clean.plucked.map(puzzleTuple)]);
  }

  const puzzleCode = {
    FORMAT: PUZZLE_FORMAT_V,
    encode: puzzleEncode,
    decode: puzzleDecode,
    canonical: puzzleCanonical,
  };

  return { PART_DEFS, MATERIAL, WORLD, makePart, createSim, simulate, placementOverlaps, puzzleCode, Matter };
});

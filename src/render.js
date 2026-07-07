/*
 * Lory's Lab — canvas renderer. All art is drawn with Canvas 2D paths per the
 * visual identity spec (design/visual-spec.md); zero image assets.
 * Consumes the sim from core.js; never touches physics.
 */
(function () {
  'use strict';

  const C = {
    wallCream: '#FBF1DE', wallPeach: '#F5DFC3', woodLight: '#EABF85', woodMid: '#C9915A',
    woodDark: '#8F6238', ink: '#43342B', inkSoft: '#8C7A6B', paper: '#FFF9EE',
    loryBlue: '#4E86E0', blueDeep: '#3563B8', sunny: '#FFC53D', tangerine: '#FF8E3C',
    poppy: '#E8563F', leaf: '#5FB358', sky: '#7CC7E8', blossom: '#F2A0BD',
    shadow: 'rgba(67,52,43,0.12)', outline: 'rgba(67,52,43,0.35)', outlineSoft: 'rgba(67,52,43,0.3)',
  };
  const BOARD_W = 1280, BOARD_H = 720, TRAY_H = 110, FLOOR_Y = 690;
  const TAU = Math.PI * 2;

  let cv, ctx, dpr = 1, bgCache = null;
  const anim = new Map();   // per-part animation state, keyed by part id
  const squash = new Map(); // bodyId -> {t, nx, ny, amt}
  let particles = [];
  let shakeT = 0;
  // "juice": presentation-only speed cues (trails, exaggerated spin, lean,
  // dust). NEVER touches physics — toggled by the ✨ button.
  let juicy = true;
  const JUICE_SPIN = 1.45;        // pattern spin exaggeration while juicy
  const JUICE_MIN_SPEED = 1.0;    // px/frame before trails/dust appear (slow
                                  // shelf rolls run at ~1.5 — keep them in)
  const BALL_TYPES = { berry: 1, ball_beach: 1, ball_marble: 1 };

  // ---------------------------------------------------------------------------
  // small helpers
  // ---------------------------------------------------------------------------
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
  }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, TAU); }
  function groundShadow(c, w) {
    c.save(); c.fillStyle = C.shadow;
    c.beginPath(); c.ellipse(0, 4, w * 0.45, 5, 0, 0, TAU); c.fill(); c.restore();
  }
  function star4(c, x, y, r, rot) {
    c.save(); c.translate(x, y); c.rotate(rot || 0);
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      const m = a + Math.PI / 4;
      c.quadraticCurveTo(Math.cos(m) * r * 0.28, Math.sin(m) * r * 0.28,
        Math.cos(a + Math.PI / 2) * r, Math.sin(a + Math.PI / 2) * r);
    }
    c.closePath(); c.restore();
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOutBack = t => { const s = 1.2; t -= 1; return 1 + t * t * ((s + 1) * t + s); };

  function partAnim(id) {
    let a = anim.get(id);
    if (!a) { a = { spin: 0, dash: 0, swing: 0, prevString: null, magnetLerp: 0 }; anim.set(id, a); }
    return a;
  }

  // ---------------------------------------------------------------------------
  // background (cached)
  // ---------------------------------------------------------------------------
  function paintBackground() {
    const off = document.createElement('canvas');
    off.width = BOARD_W * dpr; off.height = (BOARD_H + TRAY_H) * dpr;
    const c = off.getContext('2d');
    c.scale(dpr, dpr);
    const g = c.createLinearGradient(0, 0, 0, BOARD_H);
    g.addColorStop(0, C.wallCream); g.addColorStop(1, C.wallPeach);
    c.fillStyle = g; c.fillRect(0, 0, BOARD_W, BOARD_H + TRAY_H);
    // polka dots
    c.fillStyle = 'rgba(201,145,90,0.07)';
    for (let y = 0, row = 0; y < FLOOR_Y - 40; y += 32, row++) {
      for (let x = (row % 2 ? 32 : 0); x < BOARD_W; x += 64) { circle(c, x, y, 3); c.fill(); }
    }
    // crayon doodle frames (decor, top area)
    c.save(); c.globalAlpha = 0.5;
    for (const [fx, fy] of [[150, 60], [1050, 72]]) {
      c.fillStyle = 'rgba(255,249,238,0.5)'; rr(c, fx - 44, fy - 34, 88, 68, 8); c.fill();
      c.strokeStyle = C.woodMid; c.lineWidth = 4; rr(c, fx - 44, fy - 34, 88, 68, 8); c.stroke();
      c.strokeStyle = 'rgba(140,122,107,0.4)'; c.lineWidth = 2.5;
      c.beginPath();
      if (fx < 600) { // scribble sun
        c.arc(fx, fy, 14, 0, TAU);
        for (let i = 0; i < 8; i++) { const a = i * TAU / 8; c.moveTo(fx + Math.cos(a) * 18, fy + Math.sin(a) * 18); c.lineTo(fx + Math.cos(a) * 26, fy + Math.sin(a) * 26); }
      } else { // scribble bird
        c.moveTo(fx - 26, fy + 6); c.quadraticCurveTo(fx - 13, fy - 16, fx, fy + 6);
        c.quadraticCurveTo(fx + 13, fy - 16, fx + 26, fy + 6);
      }
      c.stroke();
    }
    c.restore();
    // vignette
    const vg = c.createRadialGradient(BOARD_W / 2, BOARD_H / 2, 300, BOARD_W / 2, BOARD_H / 2, 900);
    vg.addColorStop(0, 'rgba(67,52,43,0)'); vg.addColorStop(1, 'rgba(67,52,43,0.05)');
    c.fillStyle = vg; c.fillRect(0, 0, BOARD_W, BOARD_H);
    // skirting + floor
    const skirtY = FLOOR_Y - 26;
    c.fillStyle = C.woodLight; c.fillRect(0, FLOOR_Y, BOARD_W, BOARD_H - FLOOR_Y);
    c.fillStyle = C.woodMid; c.fillRect(0, skirtY, BOARD_W, 26);
    c.fillStyle = C.woodDark; c.fillRect(0, skirtY, BOARD_W, 3);
    c.fillStyle = 'rgba(255,249,238,0.25)'; c.fillRect(0, skirtY + 4, BOARD_W, 1.5);
    c.fillStyle = C.shadow; c.fillRect(0, FLOOR_Y, BOARD_W, 6);
    c.strokeStyle = 'rgba(143,98,56,0.15)'; c.lineWidth = 1.5;
    for (let x = 48; x < BOARD_W; x += 96) { c.beginPath(); c.moveTo(x, FLOOR_Y + 6); c.lineTo(x, BOARD_H); c.stroke(); }
    return off;
  }

  // ---------------------------------------------------------------------------
  // part painters — draw centered at origin; caller has translated/rotated.
  // d = {type,w,h,r,dir}, a = anim state, o = {running, t}
  // ---------------------------------------------------------------------------
  function woodBlock(c, w, h, radius) {
    const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, C.woodLight); g.addColorStop(0.7, C.woodLight); g.addColorStop(1, C.woodMid);
    c.fillStyle = g; rr(c, -w / 2, -h / 2, w, h, radius); c.fill();
    c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -w / 2, -h / 2, w, h, radius); c.stroke();
    // grain
    c.strokeStyle = 'rgba(143,98,56,0.25)'; c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(-w / 2 + 10, -h / 6);
    c.quadraticCurveTo(0, -h / 6 - 3, w / 2 - 10, -h / 6 + 2);
    c.moveTo(-w / 2 + 14, h / 5);
    c.quadraticCurveTo(w / 8, h / 5 + 3, w / 2 - 8, h / 5 - 1);
    c.stroke();
    // knot
    c.fillStyle = 'rgba(143,98,56,0.35)'; circle(c, w * 0.28, 0, 3.5); c.fill();
    c.strokeStyle = 'rgba(143,98,56,0.3)'; c.lineWidth = 1;
    c.beginPath(); c.arc(w * 0.28, 0, 6, -0.5, 2.2); c.stroke();
  }

  const painters = {
    plank(c, d) { woodBlock(c, d.w, d.h, 8); },

    shelf(c, d) {
      woodBlock(c, d.w, d.h, 6);
      // brackets
      c.fillStyle = C.woodDark;
      for (const s of [-1, 1]) {
        c.save(); c.translate(s * d.w * 0.3, d.h / 2);
        c.beginPath(); c.moveTo(-9, 0); c.lineTo(9, 0); c.lineTo(s * -9, 16); c.closePath(); c.fill();
        c.fillStyle = C.inkSoft; circle(c, 0, 5, 1.5); c.fill(); circle(c, s * -4, 11, 1.5); c.fill();
        c.restore(); c.fillStyle = C.woodDark;
      }
    },

    wall(c, d) {
      const w = d.w, h = d.h;
      c.save();
      rr(c, -w / 2, -h / 2, w, h, 10); c.clip();
      const boards = Math.max(1, Math.round(h / 48));
      for (let i = 0; i < boards; i++) {
        const by = -h / 2 + i * (h / boards);
        c.fillStyle = C.woodLight; c.fillRect(-w / 2, by, w, h / boards);
        if (i % 2) { c.fillStyle = C.shadow; c.fillRect(-w / 2, by, w, h / boards); }
        c.strokeStyle = 'rgba(143,98,56,0.25)'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(-w / 2 + 4, by + h / boards / 2);
        c.quadraticCurveTo(0, by + h / boards / 2 + 4, w / 2 - 4, by + h / boards / 2 - 2); c.stroke();
      }
      // heart knot on one board
      c.fillStyle = 'rgba(143,98,56,0.35)';
      const hy = -h / 2 + h * 0.3;
      circle(c, -3, hy, 3.4); c.fill(); circle(c, 3, hy, 3.4); c.fill();
      c.beginPath(); c.moveTo(-6, hy + 1.4); c.lineTo(6, hy + 1.4); c.lineTo(0, hy + 9); c.closePath(); c.fill();
      c.restore();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -w / 2, -h / 2, w, h, 10); c.stroke();
    },

    trampoline(c, d, a, o) {
      const w = d.w, h = d.h;
      // legs
      c.fillStyle = C.woodMid;
      for (const s of [-1, 1]) {
        c.save(); c.translate(s * w * 0.32, h / 2 - 2); c.rotate(s * 0.21);
        rr(c, -5, -6, 10, 26, 5); c.fill(); c.restore();
      }
      // springs
      c.strokeStyle = C.inkSoft; c.lineWidth = 2;
      for (const s of [-1, 1]) {
        c.beginPath();
        let zx = s * (w / 2 - 8);
        c.moveTo(zx, -2);
        for (let i = 0; i < 3; i++) { c.lineTo(zx + s * 5, 2 + i * 4); c.lineTo(zx, 5 + i * 4); }
        c.stroke();
      }
      // mat with impact dip
      const dip = (a && a.matDip) || 0;
      c.fillStyle = C.loryBlue;
      c.beginPath();
      c.moveTo(-w / 2, -h / 2 + 10); c.lineTo(-w / 2, -h / 2);
      c.quadraticCurveTo(0, -h / 2 + dip, w / 2, -h / 2);
      c.lineTo(w / 2, -h / 2 + 10); c.quadraticCurveTo(0, -h / 2 + 10 + dip, -w / 2, -h / 2 + 10);
      c.closePath(); c.fill();
      c.strokeStyle = C.blueDeep; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-w / 2, -h / 2); c.quadraticCurveTo(0, -h / 2 + dip, w / 2, -h / 2); c.stroke();
      // stitched border
      c.strokeStyle = C.paper; c.lineWidth = 1.5; c.setLineDash([5, 4]);
      c.beginPath(); c.moveTo(-w / 2 + 4, -h / 2 + 5); c.quadraticCurveTo(0, -h / 2 + 5 + dip, w / 2 - 4, -h / 2 + 5); c.stroke();
      c.setLineDash([]);
    },

    seesaw(c, d) { woodBlock(c, d.w, d.h, 8); },

    seesawBase(c) { // drawn separately at pivot point (not rotated)
      c.fillStyle = C.woodDark;
      c.beginPath();
      c.moveTo(0, -2); c.lineTo(20, 30); c.quadraticCurveTo(22, 34, 17, 34);
      c.lineTo(-17, 34); c.quadraticCurveTo(-22, 34, -20, 30); c.closePath(); c.fill();
      c.fillStyle = C.sunny; circle(c, 0, 0, 6); c.fill();
      c.strokeStyle = C.ink; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-3, 0); c.lineTo(3, 0); c.moveTo(0, -3); c.lineTo(0, 3); c.stroke();
    },

    fan(c, d, a, o) {
      const dir = d.dir || 'right';
      c.save();
      if (dir === 'left') c.scale(-1, 1);
      if (dir === 'up') c.rotate(-Math.PI / 2);
      // base
      c.fillStyle = C.woodMid; rr(c, -18, 16, 36, 12, 5); c.fill();
      // power light
      c.fillStyle = (o && o.running && Math.sin(o.t * 6) > 0) ? C.leaf : 'rgba(95,179,88,0.35)';
      circle(c, 12, 22, 2.5); c.fill();
      // casing
      c.fillStyle = C.sky; circle(c, 0, 0, 26); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, 0, 0, 26); c.stroke();
      c.fillStyle = 'rgba(255,249,238,0.25)'; circle(c, 0, 0, 22); c.fill();
      // blades
      const spin = a ? a.spin : 0;
      c.save(); c.rotate(spin);
      c.fillStyle = C.paper;
      for (let i = 0; i < 3; i++) {
        c.save(); c.rotate(i * TAU / 3);
        c.beginPath(); c.ellipse(0, -11, 6, 13, 0, 0, TAU); c.fill(); c.restore();
      }
      c.restore();
      c.fillStyle = C.sunny; circle(c, 0, 0, 5); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; circle(c, 0, 0, 5); c.stroke();
      c.restore();
    },

    domino(c, d) {
      rr(c, -d.w / 2, -d.h / 2, d.w, d.h, 5);
      c.fillStyle = C.paper; c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -d.w / 2, -d.h / 2, d.w, d.h, 5); c.stroke();
      c.beginPath(); c.moveTo(-d.w / 2 + 2, 0); c.lineTo(d.w / 2 - 2, 0); c.stroke();
      c.fillStyle = C.loryBlue;
      circle(c, 0, -d.h * 0.32, 2.8); c.fill();
      circle(c, 0, -d.h * 0.14, 2.8); c.fill();
      circle(c, 0, d.h * 0.12, 2.8); c.fill();
      circle(c, 0, d.h * 0.34, 2.8); c.fill();
      c.fillStyle = C.sunny; star4(c, 0, d.h * 0.23, 3.4, 0); c.fill();
    },

    ball_beach(c, d, a, o, body) {
      const r = d.r, rot = body ? body.angle : 0;
      // drawPart already rotated the ctx by body.angle; neutralize so the
      // panels roll at 1x (or juiced spin) and the glint stays screen-aligned
      c.rotate(-rot);
      const spin = juicy ? rot * JUICE_SPIN : rot;
      const cols = [C.poppy, C.sunny, C.leaf, C.sky, C.blossom, C.paper];
      c.save();
      circle(c, 0, 0, r); c.clip();
      c.rotate(spin);
      for (let i = 0; i < 6; i++) {
        c.fillStyle = cols[i];
        c.beginPath(); c.moveTo(0, 0);
        c.arc(0, 0, r + 2, i * TAU / 6, (i + 1) * TAU / 6); c.closePath(); c.fill();
      }
      c.fillStyle = C.paper; circle(c, 0, 0, r * 0.27); c.fill();
      c.restore();
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, 0, 0, r); c.stroke();
      // screen-space glint
      c.fillStyle = 'rgba(255,249,238,0.8)';
      c.beginPath(); c.ellipse(-r * 0.35, -r * 0.4, 7, 4, -0.6, 0, TAU); c.fill();
      c.rotate(rot);
    },

    ball_marble(c, d, a, o, body) {
      const r = d.r, rot = body ? body.angle : 0;
      c.rotate(-rot); // keep gradient/glint light-locked; swirl rolls at 1x (or juiced)
      const g = c.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.1, 0, 0, r);
      g.addColorStop(0, C.paper); g.addColorStop(0.55, C.sky); g.addColorStop(1, C.blueDeep);
      c.fillStyle = g; circle(c, 0, 0, r); c.fill();
      // candy swirl rotating with roll
      c.save(); circle(c, 0, 0, r); c.clip(); c.rotate(juicy ? rot * JUICE_SPIN : rot);
      c.strokeStyle = 'rgba(78,134,224,0.5)'; c.lineWidth = r * 0.36;
      c.beginPath(); c.arc(0, 0, r * 0.5, 0.3, 2.6); c.stroke();
      c.restore();
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, 0, 0, r); c.stroke();
      c.fillStyle = C.paper; circle(c, -r * 0.38, -r * 0.4, 3); c.fill(); circle(c, -r * 0.15, -r * 0.55, 1.2); c.fill();
      c.rotate(rot);
    },

    berry(c, d, a, o, body) {
      const r = d.r;
      const pulse = 1 + 0.05 * Math.sin((o ? o.t : 0) * TAU / 2.6);
      c.save(); c.scale(pulse, pulse);
      c.fillStyle = C.poppy; circle(c, 0, 0, r); c.fill();
      c.fillStyle = C.shadow;
      c.beginPath(); c.arc(0, 0, r, -0.3, 1.6); c.arc(0, 0, r * 0.55, 1.6, -0.3, true); c.closePath(); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, 0, 0, r); c.stroke();
      // stem + leaves
      c.strokeStyle = C.woodDark; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, -r + 2); c.lineTo(2, -r - 5); c.stroke();
      c.fillStyle = C.leaf;
      c.beginPath(); c.ellipse(-5, -r - 1, 6, 3, -0.5, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(6, -r - 3, 6, 3, 0.4, 0, TAU); c.fill();
      // face: asleep normally, awake when moving
      const awake = body && (Math.hypot(body.velocity.x, body.velocity.y) > 0.5);
      c.strokeStyle = C.ink; c.lineWidth = 1.5; c.fillStyle = C.ink;
      if (awake) { circle(c, -4, -2, 1.8); c.fill(); circle(c, 4, -2, 1.8); c.fill(); }
      else {
        c.beginPath(); c.arc(-4, -2, 2.5, 0.2, Math.PI - 0.2); c.stroke();
        c.beginPath(); c.arc(4, -2, 2.5, 0.2, Math.PI - 0.2); c.stroke();
      }
      c.beginPath(); c.arc(0, 3, 3.5, 0.3, Math.PI - 0.3); c.stroke();
      c.restore();
    },

    conveyor(c, d, a, o) {
      const w = d.w, h = d.h, dir = d.dir === 'left' ? -1 : 1;
      const off = a ? a.dash : 0;
      c.fillStyle = C.woodMid; rr(c, -w / 2, -h / 2, w, h, h / 2); c.fill();
      c.strokeStyle = C.woodDark; c.lineWidth = 8; rr(c, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, (h - 8) / 2); c.stroke();
      c.save();
      rr(c, -w / 2, -h / 2, w, h, h / 2); c.clip();
      c.strokeStyle = C.paper; c.lineWidth = 3; c.setLineDash([6, 10]); c.lineDashOffset = -off * dir;
      c.beginPath(); c.moveTo(-w / 2, -h / 2 + 4); c.lineTo(w / 2, -h / 2 + 4); c.stroke();
      c.lineDashOffset = off * dir;
      c.beginPath(); c.moveTo(-w / 2, h / 2 - 4); c.lineTo(w / 2, h / 2 - 4); c.stroke();
      c.setLineDash([]);
      c.restore();
      // wheels
      for (const s of [-1, 1]) {
        c.fillStyle = C.sunny; circle(c, s * (w / 2 - h / 2), 0, h / 2 - 4); c.fill();
        c.strokeStyle = C.outline; c.lineWidth = 1.5; circle(c, s * (w / 2 - h / 2), 0, h / 2 - 4); c.stroke();
        c.save(); c.translate(s * (w / 2 - h / 2), 0); c.rotate(off / 9 * dir);
        c.strokeStyle = C.woodMid; c.lineWidth = 2;
        c.beginPath(); c.moveTo(-h / 2 + 5, 0); c.lineTo(h / 2 - 5, 0); c.stroke();
        c.fillStyle = C.woodMid; circle(c, 0, 0, 3.5); c.fill(); c.restore();
      }
      // direction arrows
      c.fillStyle = C.paper;
      for (const s of [-0.22, 0.1]) {
        c.beginPath();
        c.moveTo(s * w * dir, -1); c.lineTo((s * w + 8 * 1) * dir, -1 + 3.5); c.lineTo(s * w * dir, 6); // arrowhead
        c.closePath(); c.fill();
      }
    },

    bumper(c, d, a, o) {
      const r = d.r;
      const ping = a && a.ping > 0 ? easeOutBack(1 - a.ping) * 0.25 * a.ping + 1 : 1;
      c.save(); c.scale(ping, ping);
      c.fillStyle = C.poppy; circle(c, 0, 0, r); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, 0, 0, r); c.stroke();
      c.strokeStyle = C.paper; c.lineWidth = 4; circle(c, 0, 0, r * 0.68); c.stroke();
      c.fillStyle = C.sunny; star4(c, 0, 0, r * 0.42, 0); c.fill();
      c.restore();
    },

    magnet(c, d, a, o, body) {
      const m = body && body.plugin.lab.magnet;
      const active = m && m.active;
      const k = a ? a.magnetLerp : 0; // 0 asleep -> 1 awake
      // wooden base
      c.fillStyle = C.woodMid; rr(c, -26, 12, 52, 16, 6); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -26, 12, 52, 16, 6); c.stroke();
      // big wake-up button on the base
      c.fillStyle = C.poppy; rr(c, -12, -28 + 34 * 0 + 6, 24, 8, 4); c.fill();
      c.fillStyle = C.sunny;
      c.beginPath(); c.ellipse(0, 8, 10, 5, 0, Math.PI, 0); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(0, 8, 10, 5, 0, Math.PI, 0); c.stroke();
      // horseshoe: parked tilted when asleep, upright when awake
      c.save();
      c.translate(0, 2);
      c.rotate(lerp(0.7, 0, k));
      c.lineWidth = 13; c.lineCap = 'butt';
      c.strokeStyle = active ? C.poppy : '#C98577';
      c.beginPath(); c.arc(0, -6, 13, Math.PI, 0); c.stroke(); // U-bend (opens downward)
      c.beginPath(); c.moveTo(-13, -6); c.lineTo(-13, 6); c.moveTo(13, -6); c.lineTo(13, 6); c.stroke();
      c.fillStyle = C.paper;
      c.fillRect(-19.5, 2, 13, 7); c.fillRect(6.5, 2, 13, 7);
      c.strokeStyle = C.outline; c.lineWidth = 1.5;
      c.strokeRect(-19.5, 2, 13, 7); c.strokeRect(6.5, 2, 13, 7);
      c.restore();
      if (!active) {
        // sleeping Zz
        c.fillStyle = C.inkSoft; c.font = '700 11px ui-rounded, system-ui, sans-serif';
        const zt = (o ? o.t : 0) % 2;
        c.globalAlpha = zt < 1 ? zt : 2 - zt;
        c.fillText('z', 20, -24 - zt * 6); c.fillText('Z', 26, -32 - zt * 6);
        c.globalAlpha = 1;
      } else {
        // glow + field sparks
        c.strokeStyle = 'rgba(124,199,232,0.8)'; c.lineWidth = 2;
        const ph = (o ? o.t : 0) * 3;
        for (let i = 0; i < 3; i++) {
          const rr2 = 34 + i * 12 + (ph * 10 % 12);
          c.globalAlpha = 0.7 - i * 0.2;
          c.beginPath(); c.arc(0, -4, rr2, -2.2, -0.9); c.stroke();
          c.beginPath(); c.arc(0, -4, rr2, Math.PI + 0.9, Math.PI + 2.2); c.stroke();
        }
        c.globalAlpha = 1;
      }
    },

    balloon(c, d, a, o, body) {
      const r = d.r;
      const col = (body && body.plugin.lab.goalBalloon) || d.type === 'balloon_goal' ? C.poppy : C.sky;
      const bob = Math.sin((o ? o.t : 0) * TAU / 1.8) * 1.5;
      c.save(); c.translate(0, bob * 0.4);
      c.fillStyle = col;
      c.beginPath(); c.ellipse(0, -2, r * 0.88, r, 0, 0, TAU); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2;
      c.beginPath(); c.ellipse(0, -2, r * 0.88, r, 0, 0, TAU); c.stroke();
      // knot
      c.fillStyle = col;
      c.beginPath(); c.moveTo(-4, r - 3); c.lineTo(4, r - 3); c.lineTo(0, r + 3); c.closePath(); c.fill();
      // glint
      c.fillStyle = 'rgba(255,249,238,0.85)';
      c.beginPath(); c.ellipse(-r * 0.35, -r * 0.45, 5, 8, -0.4, 0, TAU); c.fill();
      c.restore();
    },

    bucket(c, d) {
      const w = d.w, h = d.h;
      c.fillStyle = C.sky;
      c.beginPath();
      c.moveTo(-w / 2, -h / 2); c.lineTo(-w / 2 + 8, h / 2 - 4);
      c.quadraticCurveTo(-w / 2 + 8, h / 2, -w / 2 + 14, h / 2);
      c.lineTo(w / 2 - 14, h / 2); c.quadraticCurveTo(w / 2 - 8, h / 2, w / 2 - 8, h / 2 - 4);
      c.lineTo(w / 2, -h / 2); c.closePath(); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; c.stroke();
      // rim
      c.fillStyle = C.paper; rr(c, -w / 2 - 3, -h / 2 - 5, w + 6, 10, 5); c.fill();
      c.strokeStyle = C.blueDeep; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-w / 2 - 3, h * 0 - h / 2 + 5); c.lineTo(w / 2 + 3, -h / 2 + 5); c.stroke();
      // star stencil
      c.fillStyle = 'rgba(255,197,61,0.9)'; star4(c, 0, 4, 9, 0.2); c.fill();
      // handle
      c.strokeStyle = C.woodDark; c.lineWidth = 3;
      c.beginPath(); c.arc(0, -h / 2 - 2, w * 0.32, Math.PI + 0.4, -0.4); c.stroke();
    },

    bowl(c, d, a, o) {
      const w = d.w;
      const glow = 0.15 + 0.08 * Math.sin((o ? o.t : 0) * TAU / 2);
      c.fillStyle = `rgba(255,197,61,${glow})`;
      c.beginPath(); c.ellipse(0, 8, w * 0.7, 26, 0, 0, TAU); c.fill();
      // bowl body: lower half ellipse
      c.fillStyle = C.loryBlue;
      c.beginPath(); c.ellipse(0, -2, w / 2, 30, 0, 0, Math.PI); c.closePath(); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2;
      c.beginPath(); c.ellipse(0, -2, w / 2, 30, 0, 0, Math.PI); c.stroke();
      // rim
      c.fillStyle = C.paper;
      c.beginPath(); c.ellipse(0, -2, w / 2, 8, 0, 0, TAU); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(0, -2, w / 2, 8, 0, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(53,99,184,0.35)';
      c.beginPath(); c.ellipse(0, -2, w / 2 - 8, 5, 0, 0, TAU); c.fill();
      // foot
      c.fillStyle = C.blueDeep; rr(c, -14, 24, 28, 7, 3); c.fill();
      // berry stencil
      c.fillStyle = C.sunny; circle(c, 0, 12, 6); c.fill();
      c.beginPath(); c.ellipse(-3, 4, 3.5, 1.8, -0.5, 0, TAU); c.fill();
    },

    bell(c, d, a) {
      const r = d.r;
      const sw = a && a.swing ? a.swing : 0;
      // hanger mount
      c.fillStyle = C.woodMid; rr(c, -8, -r - 12, 16, 8, 4); c.fill();
      // bow
      c.fillStyle = C.poppy;
      c.beginPath(); c.ellipse(-6, -r - 7, 5, 3.4, -0.5, 0, TAU); c.fill();
      c.beginPath(); c.ellipse(6, -r - 7, 5, 3.4, 0.5, 0, TAU); c.fill();
      circle(c, 0, -r - 7, 2.6); c.fill();
      c.save(); c.translate(0, -r - 4); c.rotate(sw); c.translate(0, r + 4);
      // dome + skirt
      c.fillStyle = C.sunny;
      c.beginPath();
      c.arc(0, -r * 0.25, r * 0.72, Math.PI, 0);
      c.quadraticCurveTo(r * 0.72 + 3, r * 0.45, r * 0.95, r * 0.62);
      c.quadraticCurveTo(0, r * 0.85, -r * 0.95, r * 0.62);
      c.quadraticCurveTo(-r * 0.72 - 3, r * 0.45, -r * 0.72, -r * 0.25);
      c.closePath(); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; c.stroke();
      // glint stripe
      c.strokeStyle = 'rgba(255,249,238,0.6)'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(-r * 0.42, -r * 0.5); c.quadraticCurveTo(-r * 0.52, 0, -r * 0.45, r * 0.4); c.stroke();
      // clapper
      c.fillStyle = C.ink; circle(c, 0, r * 0.72, 4); c.fill();
      c.restore();
    },

    spikes(c, d, a, o) { // friendly potted cactus
      const w = d.w, h = d.h;
      const wig = a && a.wiggle > 0 ? Math.sin((o ? o.t : 0) * 40) * 0.06 * a.wiggle : Math.sin((o ? o.t : 0) * TAU / 5) * 0.015;
      // pot
      c.fillStyle = C.woodMid;
      c.beginPath();
      c.moveTo(-w * 0.42, h / 2 - 24); c.lineTo(-w * 0.32, h / 2); c.lineTo(w * 0.32, h / 2); c.lineTo(w * 0.42, h / 2 - 24);
      c.closePath(); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; c.stroke();
      c.fillStyle = C.woodDark; rr(c, -w * 0.45, h / 2 - 28, w * 0.9, 8, 3); c.fill();
      // cactus body
      c.save(); c.translate(0, h / 2 - 26); c.rotate(wig);
      c.fillStyle = C.leaf;
      rr(c, -12, -h + 34, 24, h - 34, 12); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -12, -h + 34, 24, h - 34, 12); c.stroke();
      // arm
      rr(c, 8, -h * 0.55 + 10, 16, 9, 4.5); c.fillStyle = C.leaf; c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; rr(c, 8, -h * 0.55 + 10, 16, 9, 4.5); c.stroke();
      // soft spines: V marks
      c.strokeStyle = 'rgba(255,249,238,0.8)'; c.lineWidth = 1.5;
      for (let ry = -h + 42; ry < -6; ry += 10) {
        for (const rx of [-6, 4]) {
          c.beginPath(); c.moveTo(rx - 2, ry + 3); c.lineTo(rx, ry); c.lineTo(rx + 2, ry + 3); c.stroke();
        }
      }
      // flower
      c.fillStyle = C.blossom;
      for (let i = 0; i < 5; i++) {
        const ang = i * TAU / 5 - 0.3;
        circle(c, Math.cos(ang) * 4, -h + 34 + Math.sin(ang) * 4 - 2, 3); c.fill();
      }
      c.fillStyle = C.sunny; circle(c, 0, -h + 32, 2.4); c.fill();
      c.restore();
    },

    balloon_goal(c, d, a, o, body) { painters.balloon(c, d, a, o, body); },

    sparkle(c, d, a, o) {
      const t = o ? o.t : 0;
      const tw = 0.75 + 0.25 * Math.sin(t * TAU / 0.9 + (d.seed || 0));
      c.save(); c.globalAlpha = tw; c.rotate(Math.sin(t * TAU / 4) * 0.3);
      c.fillStyle = C.sunny; star4(c, 0, 0, d.r, 0); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; star4(c, 0, 0, d.r, 0); c.stroke();
      c.fillStyle = C.paper; circle(c, 0, 0, d.r * 0.3); c.fill();
      c.restore();
    },
  };

  // ---------------------------------------------------------------------------
  // Lory the lorikeet (100x100 box, origin top-left)
  // ---------------------------------------------------------------------------
  function drawLory(c, pose, t, opts) {
    opts = opts || {};
    c.save();
    const bob = pose === 'idle' ? Math.sin(t * TAU / 2.4) * 1.5 : 0;
    const hop = pose === 'cheer' ? -12 * Math.abs(Math.sin(t * 6)) : 0;
    c.translate(0, bob + hop);
    if (pose === 'oops') { c.translate(0, 8); c.scale(1.10, 0.85); }
    if (pose === 'cheer') c.scale(1, 1.08);

    // tail feathers
    const tailCols = [C.leaf, C.sunny, C.sky];
    const sway = Math.sin(t * TAU / 2.4 - 0.8) * 0.05;
    for (let i = 0; i < 3; i++) {
      c.save(); c.translate(30, 70);
      c.rotate((-25 + i * 25) * Math.PI / 180 + Math.PI * 0.75 + sway);
      c.fillStyle = tailCols[i]; rr(c, -4, 0, 8, 26, 4); c.fill();
      c.restore();
    }
    // body
    c.fillStyle = C.leaf;
    c.beginPath(); c.ellipse(50, 62, 26, 30, 0, 0, TAU); c.fill();
    c.save();
    c.beginPath(); c.ellipse(50, 62, 26, 30, 0, 0, TAU); c.clip();
    c.fillStyle = C.tangerine; c.beginPath(); c.ellipse(58, 68, 16, 20, 0, 0, TAU); c.fill();
    c.fillStyle = C.poppy; c.beginPath(); c.ellipse(60, 54, 13, 11, 0, 0, TAU); c.fill();
    c.restore();
    // wing(s)
    const wingRot = pose === 'cheer' ? -2.6 : pose === 'think' ? -1.75 : pose === 'oops' ? 0.7 : -0.26;
    const drawWing = (rot, mirror) => {
      c.save(); c.translate(40, 50); if (mirror) c.scale(-1, 1); c.rotate(rot);
      c.fillStyle = C.leaf; c.beginPath(); c.ellipse(-2, 14, 12, 18, 0, 0, TAU); c.fill();
      c.fillStyle = 'rgba(67,52,43,0.15)'; c.beginPath(); c.ellipse(-2, 14, 12, 18, 0, 0, TAU); c.fill();
      c.restore();
    };
    drawWing(wingRot, false);
    if (pose === 'cheer') { c.save(); c.translate(20, 0); drawWing(2.6, true); c.restore(); }
    // feet
    c.fillStyle = C.tangerine; rr(c, 42, 88, 6, 8, 3); c.fill(); rr(c, 54, 88, 6, 8, 3); c.fill();
    // head group
    c.save();
    if (pose === 'think') { c.translate(58, 45); c.rotate(-8 * Math.PI / 180); c.translate(-58, -45); }
    c.fillStyle = C.loryBlue; circle(c, 62, 34, 19); c.fill();
    c.fillStyle = 'rgba(242,160,189,0.6)'; circle(c, 57, 41, 4); c.fill();
    // beak
    c.fillStyle = C.poppy;
    c.beginPath(); c.moveTo(76, 32);
    c.quadraticCurveTo(88, 33, 90, 36); c.quadraticCurveTo(86, 41, 76, 42);
    c.quadraticCurveTo(73, 37, 76, 32); c.closePath(); c.fill();
    if (pose === 'cheer') { // open lower beak
      c.beginPath(); c.moveTo(76, 42); c.quadraticCurveTo(84, 46, 80, 49); c.quadraticCurveTo(74, 47, 75, 43); c.closePath(); c.fill();
    }
    c.fillStyle = C.paper; circle(c, 80, 34, 1.5); c.fill();
    // eye
    if (pose === 'cheer') {
      c.strokeStyle = C.ink; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath(); c.arc(67, 31, 5, Math.PI * 1.1, Math.PI * 1.9); c.stroke();
    } else {
      c.fillStyle = C.paper; circle(c, 67, 30, 5.5); c.fill();
      const px = pose === 'think' ? -2 : 1.5, py = pose === 'think' ? -2 : 0.5;
      const blink = pose === 'idle' && (t % 3.2) > 3.08;
      if (blink) { c.fillStyle = C.loryBlue; c.fillRect(61, 25, 12, 10); }
      else {
        c.fillStyle = C.ink; circle(c, 67 + px, 30 + py, pose === 'oops' ? 1.5 : 2.8); c.fill();
        c.fillStyle = C.paper; circle(c, 65, 28, 1); c.fill();
      }
    }
    // goggles
    const gOff = pose === 'oops' ? 12 : 0;
    c.save();
    if (pose === 'oops') { c.translate(62, 20 + gOff); c.rotate(0.21); c.translate(-62, -(20 + gOff)); }
    c.strokeStyle = C.ink; c.lineWidth = 3;
    c.beginPath(); c.arc(62, 30 + gOff, 17, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    for (const [gx, gy] of [[56, 18 + gOff], [70, 19 + gOff]]) {
      c.fillStyle = 'rgba(124,199,232,0.45)'; circle(c, gx, gy, 7); c.fill();
      c.strokeStyle = C.woodDark; c.lineWidth = 2.5; circle(c, gx, gy, 7); c.stroke();
    }
    c.fillStyle = C.sunny; circle(c, 48, 18 + gOff, 1.2); c.fill(); circle(c, 78, 20 + gOff, 1.2); c.fill();
    c.restore();
    c.restore(); // head group

    // thinking bubbles
    if (pose === 'think') {
      const ph = (t % 1.6) / 1.6;
      c.fillStyle = C.paper; c.globalAlpha = clamp(ph * 2, 0, 1) * (1 - ph * 0.5);
      circle(c, 80, 12 - ph * 8, 3); c.fill();
      circle(c, 87, 6 - ph * 10, 4); c.fill();
      c.globalAlpha = 1;
    }
    // oops teardrop
    if (pose === 'oops') {
      const ph = (t % 0.8) / 0.8;
      c.fillStyle = C.sky;
      c.beginPath(); c.ellipse(50, 30 + ph * 10, 2, 3, 0, 0, TAU); c.fill();
    }
    c.restore();
  }

  // ---------------------------------------------------------------------------
  // particles
  // ---------------------------------------------------------------------------
  const CONFETTI_COLS = [C.poppy, C.sunny, C.leaf, C.sky, C.blossom, C.loryBlue];
  function spawn(p) { if (particles.length < 260) particles.push(p); }

  const fx = {
    confetti(x, y, n) {
      for (let i = 0; i < (n || 80); i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3);
        const sp = 6 + Math.random() * 9;
        spawn({
          kind: 'confetti', x, y, vx: Math.cos(a) * sp + (Math.random() - 0.5) * 4, vy: Math.sin(a) * sp,
          rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.3, col: CONFETTI_COLS[i % 6],
          life: 2.5, t: 0, fl: Math.random() * TAU,
        });
      }
    },
    poof(x, y, n) {
      for (let i = 0; i < (n || 6); i++) {
        const a = Math.random() * TAU;
        spawn({ kind: 'poof', x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6, vx: Math.cos(a) * 1.2, vy: Math.sin(a) * 1.2 - 0.5, r: 4 + Math.random() * 6, life: 0.35, t: 0 });
      }
    },
    stars(x, y, n) {
      for (let i = 0; i < (n || 5); i++) {
        const a = Math.random() * TAU, sp = 2 + Math.random() * 3;
        spawn({ kind: 'star', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, r: 4 + Math.random() * 5, rot: Math.random() * TAU, life: 0.55, t: 0 });
      }
    },
    ring(x, y, col) { spawn({ kind: 'ring', x, y, r: 10, col: col || C.paper, life: 0.3, t: 0 }); },
    shards(x, y, col) {
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + Math.random() * 0.4, sp = 3.5 + Math.random() * 2;
        spawn({ kind: 'shard', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, rot: a, vr: (Math.random() - 0.5) * 0.4, col: col || C.poppy, life: 0.5, t: 0 });
      }
    },
    windPuff(x, y, dx, dy) {
      spawn({ kind: 'wind', x, y, vx: dx * 3.4, vy: dy * 3.4, life: 0.6, t: 0 });
    },
  };

  function stepParticles(dt) {
    const k = dt * 60; // motion constants are tuned for 60fps frames
    for (const p of particles) {
      p.t += dt;
      if (p.kind === 'confetti') {
        p.vy += 15 * dt; p.x += (p.vx + Math.sin(p.fl + p.t * 8) * 1.2) * k; p.y += p.vy * k; p.rot += p.vr * k;
        p.vx *= Math.pow(0.99, k);
      } else if (p.kind === 'wind') {
        p.x += p.vx * k; p.y += p.vy * k;
      } else {
        p.x += (p.vx || 0) * k; p.y += (p.vy || 0) * k;
        if (p.kind === 'star' || p.kind === 'shard') p.vy += 8 * dt;
        if (p.rot != null) p.rot += (p.vr || 0.15) * k;
      }
    }
    particles = particles.filter(p => p.t < p.life);
  }

  function drawParticles(c) {
    for (const p of particles) {
      const k = 1 - p.t / p.life;
      c.save(); c.globalAlpha = clamp(k * 1.4, 0, 1);
      if (p.kind === 'confetti') {
        c.translate(p.x, p.y); c.rotate(p.rot);
        c.fillStyle = p.col; c.fillRect(-3, -5, 6, 10);
      } else if (p.kind === 'poof') {
        c.fillStyle = 'rgba(255,249,238,0.9)';
        circle(c, p.x, p.y, p.r * (1 + (1 - k) * 0.6)); c.fill();
      } else if (p.kind === 'star') {
        c.fillStyle = C.sunny; star4(c, p.x, p.y, p.r * (0.5 + k * 0.5), p.rot); c.fill();
      } else if (p.kind === 'ring') {
        c.strokeStyle = p.col; c.lineWidth = 3;
        circle(c, p.x, p.y, p.r + (1 - k) * 26); c.stroke();
      } else if (p.kind === 'shard') {
        c.translate(p.x, p.y); c.rotate(p.rot);
        c.fillStyle = p.col;
        c.beginPath(); c.moveTo(0, -6); c.lineTo(5, 4); c.lineTo(-5, 4); c.closePath(); c.fill();
      } else if (p.kind === 'wind') {
        c.strokeStyle = 'rgba(255,249,238,0.6)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); c.stroke();
      }
      c.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // events -> visual reactions
  // ---------------------------------------------------------------------------
  function handleEvents(events, sim) {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          if (e.impact > 2.5) {
            squash.set(e.bodyId, { t: 0, nx: e.nx || 0, ny: e.ny || 1, amt: clamp(e.impact / 14, 0.1, 0.3) });
            if (e.impact > 5) fx.poof(e.x, e.y, 3);
          }
          break;
        case 'boing': {
          fx.stars(e.x, e.y - 10, 2);
          const a = partAnim(e.partId); a.matDipV = clamp(e.impact, 4, 12);
          if (e.bodyId != null) squash.set(e.bodyId, { t: 0, nx: 0, ny: 1, amt: 0.28 });
          break;
        }
        case 'bumper': {
          const a = partAnim(e.partId); a.ping = 1;
          fx.ring(e.x, e.y, C.paper);
          break;
        }
        case 'pop': fx.shards(e.x, e.y, e.goal ? C.poppy : C.sky); fx.poof(e.x, e.y, 5); break;
        case 'bell': fx.ring(e.x, e.y, C.sunny); fx.stars(e.x, e.y, 6); ringBell(e, sim); break;
        case 'sparkle': fx.stars(e.x, e.y, 6); fx.ring(e.x, e.y, C.sunny); break;
        case 'magnet_on': fx.ring(e.x, e.y, C.sky); break;
        case 'magnet_off': fx.poof(e.x, e.y, 4); break;
        case 'win': shakeT = 0; break;
      }
    }
  }
  function ringBell(e, sim) {
    if (!sim) return;
    for (const p of sim.parts) {
      if (p.spec.type === 'bell') {
        const b = p.bodies[0];
        if (Math.abs(b.position.x - e.x) < 5) { const a = partAnim(b.plugin.lab.id); a.swingT = 0; }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // main draw
  // ---------------------------------------------------------------------------
  // juice pass: record ball trails + kick up dust while rolling (render-only)
  function stepJuice(sim, dt, running) {
    for (const p of sim.parts) {
      const body = p.bodies[0];
      const m = body.plugin.lab;
      if (!BALL_TYPES[m.type] || m.popped) continue;
      const a = partAnim(m.id);
      if (!a.trail) a.trail = [];
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (juicy && running && speed > JUICE_MIN_SPEED) {
        a.trail.push({ x: body.position.x, y: body.position.y, v: speed });
        if (a.trail.length > 6) a.trail.shift();
        // dust puffs while rolling along a surface (moving but not falling)
        a.dustT = (a.dustT || 0) + dt;
        if (Math.abs(body.velocity.y) < 0.8 && a.dustT > 0.4) {
          a.dustT = 0;
          fx.poof(body.position.x - body.velocity.x * 2, body.position.y + (m.r || 16) - 2, 2);
        }
      } else if (a.trail.length) {
        a.trail.shift(); // fade the ribbon out quickly once slow/stopped
      }
    }
  }

  function drawTrails(c, sim) {
    if (!juicy) return;
    for (const p of sim.parts) {
      const m = p.bodies[0].plugin.lab;
      const a = anim.get(m.id);
      if (!a || !a.trail || a.trail.length < 3) continue;
      const r = m.r || 14;
      c.save();
      c.lineCap = 'round';
      for (let i = 1; i < a.trail.length; i++) {
        const k = i / a.trail.length;             // older -> fainter & thinner
        const vk = Math.min(1, (a.trail[i].v || 1) / 3); // gentler at low speed
        c.strokeStyle = `rgba(67,52,43,${0.18 * k * vk})`;
        c.lineWidth = r * 0.9 * k;
        c.beginPath();
        c.moveTo(a.trail[i - 1].x, a.trail[i - 1].y);
        c.lineTo(a.trail[i].x, a.trail[i].y);
        c.stroke();
      }
      c.restore();
    }
  }

  function stepAnims(sim, dt, running) {
    // prune anim state for parts that no longer exist (sim is rebuilt on every
    // board edit with fresh ids; without this the map grows for the session)
    if (anim.size > sim.parts.length + 24) {
      const live = new Set(sim.parts.map(p => p.bodies[0].plugin.lab.id));
      for (const id of anim.keys()) if (!live.has(id)) anim.delete(id);
    }
    for (const p of sim.parts) {
      const id = p.bodies[0].plugin.lab.id;
      const a = partAnim(id);
      const type = p.spec.type;
      if (type === 'fan') {
        a.spin += (running ? 9.4 : 0.9) * dt * TAU / 2;
      }
      if (type === 'conveyor') a.dash += (running ? 3.2 : 0) * 60 * dt;
      if (type === 'trampoline') {
        a.matDip = (a.matDip || 0) + ((a.matDipV || 0) - (a.matDip || 0)) * 0.5;
        a.matDipV = (a.matDipV || 0) * 0.72;
      }
      if (type === 'bumper' && a.ping > 0) a.ping = Math.max(0, a.ping - dt * 4.5);
      if (type === 'bell') {
        if (a.swingT != null) {
          a.swingT += dt;
          a.swing = Math.sin(a.swingT * 14) * 0.35 * Math.exp(-a.swingT * 3);
          if (a.swingT > 1.6) a.swingT = null;
        } else a.swing = 0;
      }
      if (type === 'magnet') {
        const m = p.bodies[0].plugin.lab.magnet;
        a.magnetLerp = clamp(a.magnetLerp + (m.active ? dt * 5 : -dt * 3), 0, 1);
      }
    }
    for (const [id, s] of squash) { s.t += dt; if (s.t > 0.18) squash.delete(id); }
  }

  function drawPart(c, p, o, sim) {
    const spec = p.spec, type = spec.type;
    const body = p.bodies[0];
    const m = body.plugin.lab;
    if (m.popped || m.collected) return;
    const a = anim.get(m.id);

    // seesaw base behind the plank, at the constraint anchor
    if (type === 'seesaw') {
      c.save(); c.translate(spec.x, spec.y); painters.seesawBase(c); c.restore();
    }
    // balloon strings
    if ((type === 'balloon' || type === 'balloon_goal')) {
      c.save();
      c.strokeStyle = C.inkSoft; c.lineWidth = 1.5;
      const bx = body.position.x, by = body.position.y + (PART_R(spec) || 22);
      let ex, ey;
      if (m.tetherAnchor) { ex = m.tetherAnchor.x; ey = m.tetherAnchor.y; }
      else { ex = bx + Math.sin(o.t * 2 + bx) * 6; ey = by + 30; }
      const a2 = partAnim(m.id);
      const prev = a2.prevString || { x: (bx + ex) / 2, y: (by + ey) / 2 };
      const cx = prev.x, cyy = prev.y + 6;
      c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(cx, cyy, ex, ey); c.stroke();
      a2.prevString = { x: lerp(prev.x, (bx + ex) / 2, 0.25), y: lerp(prev.y, (by + ey) / 2, 0.25) };
      if (m.tetherAnchor) { // little stake
        c.fillStyle = C.woodDark; rr(c, ex - 4, ey - 3, 8, 6, 2); c.fill();
      }
      c.restore();
    }

    c.save();
    // compound bodies (bucket/bowl): body.position is the mass centroid, which
    // sits above the drawn geometry — align art to the physical bounds center
    if (type === 'bucket' || type === 'bowl') {
      c.translate((body.bounds.min.x + body.bounds.max.x) / 2,
        (body.bounds.min.y + body.bounds.max.y) / 2);
    } else {
      c.translate(body.position.x, body.position.y);
    }
    // ground shadow for statics sitting upright
    if (body.isStatic && !body.isSensor && type !== 'wall' && type !== 'bowl') groundShadow(c, spec.w || (spec.r ? spec.r * 2 : 40) );
    c.rotate(body.angle);
    // squash & stretch (render only)
    const sq = squash.get(body.id);
    if (sq) {
      const k = 1 - sq.t / 0.18;
      const amt = sq.amt * k;
      const ang = Math.atan2(sq.ny, sq.nx) - Math.PI / 2 - body.angle;
      c.rotate(ang); c.scale(1 + amt * 0.5, 1 - amt); c.rotate(-ang);
    }
    // juice: lean into the roll — slight stretch along the velocity direction
    if (juicy && BALL_TYPES[type] && !body.isStatic) {
      const sp = Math.hypot(body.velocity.x, body.velocity.y);
      if (sp > 0.8) {
        const k2 = Math.min(0.06, sp * 0.012);
        const va = Math.atan2(body.velocity.y, body.velocity.x) - body.angle;
        c.rotate(va); c.scale(1 + k2, 1 - k2 * 0.7); c.rotate(-va);
      }
    }
    const d = { type, w: m.w, h: m.h, r: PART_R(spec), dir: m.dir, seed: body.id };
    // puzzle-maker: parts plucked into the future tray render faded
    const plucked = m.spec && m.spec._plucked;
    if (plucked) c.globalAlpha = 0.35;
    (painters[type] || painters.plank)(c, d, a, o, body);
    if (plucked) {
      c.globalAlpha = 1;
      const w2 = (d.w || d.r * 2) + 14, h2 = (d.h || d.r * 2) + 14;
      c.strokeStyle = C.tangerine; c.lineWidth = 3; c.setLineDash([7, 6]);
      c.lineDashOffset = -(o.t * 18 % 13);
      rr(c, -w2 / 2, -h2 / 2, w2, h2, 10); c.stroke();
      c.setLineDash([]);
      c.font = '700 16px ui-rounded, system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('🧩', w2 / 2 - 2, -h2 / 2 + 2);
    }
    c.restore();
  }
  function PART_R(spec) {
    const defs = window.LoryCore.PART_DEFS;
    return spec.r || (defs[spec.type] && defs[spec.type].r);
  }

  function drawWindZones(c, sim, o, faint) {
    for (const p of sim.parts) {
      if (p.spec.type !== 'fan') continue;
      const b = p.bodies[0], m = b.plugin.lab;
      const dv = m.dir === 'left' ? { x: -1, y: 0 } : m.dir === 'up' ? { x: 0, y: -1 } : { x: 1, y: 0 };
      c.save();
      c.globalAlpha = faint ? 0.25 : 0.55;
      c.strokeStyle = C.paper; c.lineWidth = 2; c.setLineDash([10, 8]);
      c.lineDashOffset = -(o.t * 120 % 18);
      for (const off of [-26, 0, 26]) {
        const sx = b.position.x + dv.x * 34 + (dv.x === 0 ? off : 0);
        const sy = b.position.y + dv.y * 34 + (dv.y === 0 ? off * 0.8 : 0);
        c.beginPath();
        c.moveTo(sx, sy);
        c.quadraticCurveTo(sx + dv.x * 140 + (dv.y !== 0 ? Math.sin(o.t * 3 + off) * 8 : 0),
          sy + dv.y * 140 + (dv.x !== 0 ? Math.sin(o.t * 3 + off) * 8 : 0),
          sx + dv.x * 270, sy + dv.y * 270);
        c.stroke();
      }
      c.setLineDash([]); c.restore();
    }
  }

  // Ghost of a part (hints, dragging)
  function drawGhost(c, spec, o, opts) {
    opts = opts || {};
    c.save();
    c.translate(spec.x, spec.y);
    c.rotate((spec.angle || 0) * Math.PI / 180);
    if (opts.style === 'hint') {
      const pulse = 0.5 + 0.4 * Math.abs(Math.sin(o.t * TAU / 1.2 / 2));
      c.globalAlpha = pulse;
      const defs = window.LoryCore.PART_DEFS[spec.type];
      const w = spec.w || defs.w || defs.r * 2, h = spec.h || defs.h || defs.r * 2;
      c.fillStyle = 'rgba(78,134,224,0.08)';
      c.strokeStyle = C.loryBlue; c.lineWidth = 3; c.setLineDash([8, 6]);
      c.lineDashOffset = -(o.t * 20 % 14);
      if (defs.r) { circle(c, 0, 0, defs.r + 4); c.fill(); c.stroke(); }
      else { rr(c, -w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 8); c.fill(); c.stroke(); }
      c.setLineDash([]);
      c.globalAlpha = pulse * 0.8;
      const d = { type: spec.type, w, h, r: defs.r, dir: spec.dir };
      (painters[spec.type] || painters.plank)(c, d, null, o, null);
    } else {
      c.globalAlpha = opts.invalid ? 0.75 : 0.9;
      const defs = window.LoryCore.PART_DEFS[spec.type];
      const d = { type: spec.type, w: spec.w || defs.w, h: spec.h || defs.h, r: defs.r, dir: spec.dir };
      c.save();
      if (opts.lift) { c.scale(1.06, 1.06); }
      (painters[spec.type] || painters.plank)(c, d, null, o, null);
      c.restore();
      if (opts.invalid) {
        c.globalAlpha = 0.45; c.fillStyle = C.poppy;
        const w2 = (d.w || d.r * 2) + 10, h2 = (d.h || d.r * 2) + 10;
        rr(c, -w2 / 2, -h2 / 2, w2, h2, 10); c.fill();
        c.globalAlpha = 0.9; c.strokeStyle = C.paper; c.lineWidth = 4; c.lineCap = 'round';
        c.beginPath(); c.moveTo(-8, -8); c.lineTo(8, 8); c.moveTo(8, -8); c.lineTo(-8, 8); c.stroke();
      }
    }
    c.restore();
  }

  // selection halo + toy buttons (positions returned for hit-testing)
  function drawSelection(c, sel, o) {
    const defs = window.LoryCore.PART_DEFS[sel.type];
    const w = (sel.w || defs.w || defs.r * 2), h = (sel.h || defs.h || defs.r * 2);
    c.save();
    c.translate(sel.x, sel.y);
    c.save(); c.rotate((sel.angle || 0) * Math.PI / 180);
    c.strokeStyle = C.loryBlue; c.lineWidth = 3; c.setLineDash([6, 5]);
    c.lineDashOffset = -(o.t * 16 % 11);
    rr(c, -w / 2 - 8, -h / 2 - 8, w + 16, h + 16, 12); c.stroke();
    c.setLineDash([]); c.restore();
    c.restore();
    const btns = [];
    // above the part normally; below it when that would collide with the topbar
    let topY = sel.y - Math.max(w, h) / 2 - 44;
    if (topY < 92) topY = sel.y + Math.max(w, h) / 2 + 44;
    const defsBtns = [];
    if (defs.rot) defsBtns.push({ id: 'rotl', icon: '⟲', col: C.loryBlue }, { id: 'rotr', icon: '⟳', col: C.loryBlue });
    if (defs.dir) defsBtns.push({ id: 'flip', icon: '⇄', col: C.tangerine });
    defsBtns.push({ id: 'del', icon: '✕', col: C.poppy, gap: 14 });
    let total = defsBtns.length * 54 - 10 + 14;
    let cx0 = clamp(sel.x - total / 2 + 22, 30, BOARD_W - total);
    let run = 0;
    defsBtns.forEach((b, i) => {
      run += b.gap || 0;
      const bx = cx0 + i * 54 + run, by = clamp(topY, 40, 655);
      c.save();
      c.fillStyle = b.col; circle(c, bx, by + 3, 22); c.fill();
      const dk = b.col === C.loryBlue ? C.blueDeep : b.col === C.poppy ? '#B93A28' : '#C96A22';
      c.fillStyle = dk;
      c.beginPath(); c.arc(bx, by + 3, 22, 0.15 * Math.PI, 0.85 * Math.PI); c.fill();
      c.fillStyle = b.col; circle(c, bx, by, 21); c.fill();
      c.fillStyle = C.paper; c.font = '800 20px ui-rounded, system-ui, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(b.icon, bx, by + 1);
      c.restore();
      btns.push({ id: b.id, x: bx, y: by, r: 28 });
    });
    return btns;
  }

  // tray
  function drawTray(c, tray, o, dragType) {
    const y0 = BOARD_H;
    c.save();
    c.fillStyle = C.woodLight;
    rr(c, -10, y0, BOARD_W + 20, TRAY_H + 10, 24); c.fill();
    c.strokeStyle = C.woodDark; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, y0 + 1); c.lineTo(BOARD_W, y0 + 1); c.stroke();
    const wells = [];
    const n = tray.length;
    const wellW = Math.min(88, (BOARD_W - 30) / Math.max(n, 1));
    const box = Math.min(68, wellW - 6);
    const total = n * wellW;
    let x = BOARD_W / 2 - total / 2;
    c.font = '700 12px ui-rounded, system-ui, sans-serif';
    for (const item of tray) {
      const cx = x + wellW / 2, cy = y0 + TRAY_H / 2 + 4;
      c.fillStyle = C.paper; rr(c, cx - box / 2, cy - box / 2, box, box, 14); c.fill();
      c.fillStyle = 'rgba(67,52,43,0.06)'; rr(c, cx - box / 2, cy - box / 2, box, 8, 6); c.fill();
      c.strokeStyle = 'rgba(67,52,43,0.15)'; c.lineWidth = 1.5; rr(c, cx - box / 2, cy - box / 2, box, box, 14); c.stroke();
      const defs = window.LoryCore.PART_DEFS[item.type];
      const dim = Math.max(defs.w || defs.r * 2, defs.h || defs.r * 2);
      const sc = Math.min(0.62, (box - 16) / dim);
      c.save();
      c.translate(cx, cy);
      c.scale(sc, sc);
      if (item.count === 0) c.globalAlpha = 0.22;
      const d = { type: item.type, w: defs.w, h: defs.h, r: defs.r, dir: item.dir || (defs.dir && defs.dir[0]) };
      (painters[item.type] || painters.plank)(c, d, null, o, null);
      c.restore();
      // count badge
      if (item.count > 0) {
        c.fillStyle = C.loryBlue; circle(c, cx + box / 2 - 8, cy - box / 2 + 8, 11); c.fill();
        c.fillStyle = C.paper; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(item.count), cx + box / 2 - 8, cy - box / 2 + 9);
      }
      wells.push({ type: item.type, x: cx, y: cy, w: wellW, h: 76, count: item.count });
      x += wellW;
    }
    c.restore();
    return wells;
  }

  // speech bubble
  function drawBubble(c, x, y, text, o) {
    c.save();
    c.font = '700 16px ui-rounded, system-ui, sans-serif';
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      if (c.measureText(line + ' ' + w).width > 230 && line) { lines.push(line); line = w; }
      else line = line ? line + ' ' + w : w;
    }
    lines.push(line);
    const bw = Math.min(260, Math.max(...lines.map(l => c.measureText(l).width)) + 28);
    const bh = lines.length * 21 + 20;
    const bx = x, by = y - bh;
    c.fillStyle = C.paper;
    rr(c, bx, by, bw, bh, 14); c.fill();
    c.beginPath(); c.moveTo(bx + 18, by + bh - 1); c.lineTo(bx + 6, by + bh + 14); c.lineTo(bx + 36, by + bh - 1); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(67,52,43,0.25)'; c.lineWidth = 2;
    rr(c, bx, by, bw, bh, 14); c.stroke();
    c.fillStyle = C.ink; c.textAlign = 'left'; c.textBaseline = 'top';
    lines.forEach((l, i) => c.fillText(l, bx + 14, by + 11 + i * 21));
    c.restore();
  }

  // ---------------------------------------------------------------------------
  // public draw
  // ---------------------------------------------------------------------------
  function draw(frame) {
    const { sim, running, t, dt, selection, dragGhost, hints, tray, lory } = frame;
    stepAnims(sim, dt, running);
    stepJuice(sim, dt, running);
    stepParticles(dt);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, BOARD_W, BOARD_H + TRAY_H);
    ctx.drawImage(bgCache, 0, 0, BOARD_W, BOARD_H + TRAY_H);

    const o = { t, running };

    // Lory + bubble (behind parts)
    if (lory) {
      ctx.save();
      ctx.translate(lory.x - 50, lory.y - 96);
      drawLory(ctx, lory.pose, t);
      ctx.restore();
      if (lory.say) drawBubble(ctx, lory.x + 40, lory.y - 100, lory.say, o);
    }

    drawWindZones(ctx, sim, o, !running);
    drawTrails(ctx, sim);

    // parts: statics first, dynamics on top, sensors (sparkles) last
    const order = { static: 0, dynamic: 1, sensor: 2 };
    const list = sim.parts.slice().sort((a, b) => {
      const ka = a.bodies[0].isSensor ? 2 : a.bodies[0].isStatic ? 0 : 1;
      const kb = b.bodies[0].isSensor ? 2 : b.bodies[0].isStatic ? 0 : 1;
      return ka - kb;
    });
    for (const p of list) drawPart(ctx, p, o, sim);

    // hint ghosts
    if (hints) for (const h of hints) drawGhost(ctx, h, o, { style: 'hint' });

    // selection
    let selButtons = null;
    if (selection) selButtons = drawSelection(ctx, selection, o);

    // drag ghost
    if (dragGhost) drawGhost(ctx, dragGhost, o, { invalid: dragGhost.invalid, lift: true });

    drawParticles(ctx);

    // tray
    let wells = null;
    if (tray) wells = drawTray(ctx, tray, o, dragGhost && dragGhost.type);

    return { selButtons, wells };
  }

  function init(canvas) {
    cv = canvas;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = BOARD_W * dpr;
    cv.height = (BOARD_H + TRAY_H) * dpr;
    ctx = cv.getContext('2d');
    bgCache = paintBackground();
  }

  window.LoryRender = {
    init, draw, fx, handleEvents, drawLory, drawBubble, C,
    BOARD_W, BOARD_H, TRAY_H, FLOOR_Y,
    setJuice(b) { juicy = !!b; if (!juicy) for (const a of anim.values()) a.trail = []; },
    juice() { return juicy; },
    resetFx() { particles = []; squash.clear(); },
  };
})();

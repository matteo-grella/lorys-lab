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
  // Full-bleed support: the canvas can be wider than the 1280px board (phones
  // in landscape). The room artwork fills viewW; the board sits centered at
  // offset ox. World/physics stay 1280 wide — this is presentation only.
  let viewW = BOARD_W;
  const boardOX = () => (viewW - BOARD_W) / 2;
  const anim = new Map();   // per-part animation state, keyed by part id
  const squash = new Map(); // bodyId -> {t, nx, ny, amt}
  let particles = [];
  let shakeT = 0;
  // "juice": presentation-only speed cues (trails, exaggerated spin, lean,
  // dust). NEVER touches physics. Always on; setJuice remains for tooling.
  let juicy = true;
  const JUICE_SPIN = 1.45;        // pattern spin exaggeration while juicy
  const JUICE_MIN_SPEED = 1.0;    // px/frame before trails/dust appear (slow
                                  // shelf rolls run at ~1.5 — keep them in)
  const BALL_TYPES = { berry: 1, ball_beach: 1, ball_marble: 1, ball_basket: 1 };
  const FIST_ANIM_T = 40; // cooldown frames above this = punch extension anim

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
    off.width = viewW * dpr; off.height = (BOARD_H + TRAY_H) * dpr;
    const c = off.getContext('2d');
    c.scale(dpr, dpr);
    const g = c.createLinearGradient(0, 0, 0, BOARD_H);
    g.addColorStop(0, C.wallCream); g.addColorStop(1, C.wallPeach);
    c.fillStyle = g; c.fillRect(0, 0, viewW, BOARD_H + TRAY_H);
    // polka dots
    c.fillStyle = 'rgba(201,145,90,0.07)';
    for (let y = 0, row = 0; y < FLOOR_Y - 40; y += 32, row++) {
      for (let x = (row % 2 ? 32 : 0); x < viewW; x += 64) { circle(c, x, y, 3); c.fill(); }
    }
    // crayon doodle frames (decor, top area)
    c.save(); c.globalAlpha = 0.5;
    for (const [fx, fy] of [[150, 60], [viewW - 230, 72]]) {
      c.fillStyle = 'rgba(255,249,238,0.5)'; rr(c, fx - 44, fy - 34, 88, 68, 8); c.fill();
      c.strokeStyle = C.woodMid; c.lineWidth = 4; rr(c, fx - 44, fy - 34, 88, 68, 8); c.stroke();
      c.strokeStyle = 'rgba(140,122,107,0.4)'; c.lineWidth = 2.5;
      c.beginPath();
      if (fx < viewW / 2) { // scribble sun
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
    const vg = c.createRadialGradient(viewW / 2, BOARD_H / 2, 300, viewW / 2, BOARD_H / 2, 900);
    vg.addColorStop(0, 'rgba(67,52,43,0)'); vg.addColorStop(1, 'rgba(67,52,43,0.05)');
    c.fillStyle = vg; c.fillRect(0, 0, viewW, BOARD_H);
    // skirting + floor
    const skirtY = FLOOR_Y - 26;
    c.fillStyle = C.woodLight; c.fillRect(0, FLOOR_Y, viewW, BOARD_H - FLOOR_Y);
    c.fillStyle = C.woodMid; c.fillRect(0, skirtY, viewW, 26);
    c.fillStyle = C.woodDark; c.fillRect(0, skirtY, viewW, 3);
    c.fillStyle = 'rgba(255,249,238,0.25)'; c.fillRect(0, skirtY + 4, viewW, 1.5);
    c.fillStyle = C.shadow; c.fillRect(0, FLOOR_Y, viewW, 6);
    c.strokeStyle = 'rgba(143,98,56,0.15)'; c.lineWidth = 1.5;
    for (let x = 48; x < viewW; x += 96) { c.beginPath(); c.moveTo(x, FLOOR_Y + 6); c.lineTo(x, BOARD_H); c.stroke(); }
    // makers' mark, carved faintly into the wall above the skirting
    try {
      const mark = atob('TWF0dGVvIEcuICYgTG9yZW56byBHLg==');
      c.save();
      c.translate(viewW - 190, skirtY - 14);
      c.rotate(-0.012);
      c.font = 'italic 600 15px ui-rounded, Georgia, serif';
      c.textAlign = 'right';
      c.fillStyle = 'rgba(143,98,56,0.16)';
      c.fillText(mark, 0, 0);
      c.fillStyle = 'rgba(255,249,238,0.10)';
      c.fillText(mark, 0.7, 0.7); // faint emboss lip: reads as carved wood
      c.restore();
    } catch (e) {}
    // when the room is wider than the board, mark the bench ends with subtle
    // wooden posts so the invisible physics walls read as intentional
    if (viewW > BOARD_W + 4) {
      const ox = boardOX();
      c.fillStyle = 'rgba(201,145,90,0.4)';
      rr(c, ox - 14, 60, 10, FLOOR_Y - 60, 5); c.fill();
      rr(c, ox + BOARD_W + 4, 60, 10, FLOOR_Y - 60, 5); c.fill();
      c.fillStyle = 'rgba(143,98,56,0.35)';
      rr(c, ox - 14, 60, 10, 8, 4); c.fill();
      rr(c, ox + BOARD_W + 4, 60, 10, 8, 4); c.fill();
    }
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

  // the laser/lens beam: layered red glow along the WORLD-SPACE beam path
  // (mirrors bend it into a polyline), glints at each bounce, sizzling
  // impact burst at the far end
  function drawBeamPath(c, path, t) {
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const [col, wdt] of [['rgba(232,86,63,0.25)', 11], ['rgba(255,120,90,0.6)', 5.5], ['#FFF3B0', 2.2]]) {
      c.strokeStyle = col; c.lineWidth = wdt;
      c.beginPath();
      c.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) c.lineTo(path[i].x, path[i].y);
      c.stroke();
    }
    for (let i = 1; i < path.length - 1; i++) { // mirror-bounce glints
      c.fillStyle = C.paper;
      star4(c, path[i].x, path[i].y, 5.5 + Math.sin(t * 15 + i * 2) * 1.5, t * 5); c.fill();
    }
    const end = path[path.length - 1];
    c.save(); c.translate(end.x, end.y); c.rotate((t * 9) % TAU);
    c.fillStyle = C.sunny; star4(c, 0, 0, 9 + Math.sin(t * 21) * 2, 0); c.fill();
    c.fillStyle = C.paper; circle(c, 0, 0, 3); c.fill();
    c.restore();
    c.restore();
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

    // --- machine-shop parts ---------------------------------------------------
    rope(c, d, a, o, body) {
      // anchor plate; the rope line itself is drawn in drawPart's pre-pass
      c.fillStyle = C.woodMid; rr(c, -d.w / 2, -d.h / 2, d.w, d.h, 5); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -d.w / 2, -d.h / 2, d.w, d.h, 5); c.stroke();
      c.fillStyle = C.inkSoft; circle(c, -d.w / 4, 0, 1.8); c.fill(); circle(c, d.w / 4, 0, 1.8); c.fill();
      c.strokeStyle = C.woodDark; c.lineWidth = 3;
      c.beginPath(); c.arc(0, d.h / 2 + 3, 5, 0, Math.PI); c.stroke(); // little hook
    },

    scissors(c, d, a, o, body) {
      const snip = a && a.snipT > 0 ? Math.sin(a.snipT * 25) * 0.25 : 0.18;
      c.fillStyle = C.sky;
      for (const s of [-1, 1]) { // handles
        c.save(); c.translate(-d.w / 2 + 12, s * 6); c.rotate(s * 0.35);
        c.beginPath(); c.ellipse(0, 0, 11, 6.5, 0, 0, TAU); c.fill();
        c.strokeStyle = C.blueDeep; c.lineWidth = 2;
        c.beginPath(); c.ellipse(0, 0, 11, 6.5, 0, 0, TAU); c.stroke();
        c.restore();
      }
      for (const s of [-1, 1]) { // blades
        c.save(); c.translate(-4, 0); c.rotate(s * snip);
        c.fillStyle = '#C9CDD4';
        c.beginPath(); c.moveTo(0, s * 3); c.lineTo(d.w / 2 + 4, s * 1);
        c.quadraticCurveTo(d.w / 2 + 8, 0, d.w / 2 + 4, s * -1.5);
        c.lineTo(2, s * -2); c.closePath(); c.fill();
        c.strokeStyle = C.outline; c.lineWidth = 1.5; c.stroke();
        c.restore();
      }
      c.fillStyle = C.sunny; circle(c, -4, 0, 4); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; circle(c, -4, 0, 4); c.stroke();
    },

    candle(c, d, a, o, body) {
      const lit = body ? body.plugin.lab.candle.lit : true;
      // holder
      c.fillStyle = C.woodMid; rr(c, -d.w / 2 - 5, d.h / 2 - 8, d.w + 10, 8, 3); c.fill();
      // wax
      const g = c.createLinearGradient(-d.w / 2, 0, d.w / 2, 0);
      g.addColorStop(0, C.paper); g.addColorStop(1, '#F1E4C8');
      c.fillStyle = g; rr(c, -d.w / 2, -d.h / 2 + 12, d.w, d.h - 12, 5); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -d.w / 2, -d.h / 2 + 12, d.w, d.h - 12, 5); c.stroke();
      // drips
      c.fillStyle = 'rgba(255,249,238,0.9)';
      c.beginPath(); c.ellipse(-d.w / 4, -d.h / 2 + 16, 3, 6, 0, 0, TAU); c.fill();
      // wick + flame
      c.strokeStyle = C.ink; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(0, -d.h / 2 + 12); c.lineTo(0, -d.h / 2 + 5); c.stroke();
      if (lit) {
        const fl = Math.sin((o ? o.t : 0) * 11 + (d.seed || 0)) * 1.5;
        const g2 = c.createRadialGradient(fl * 0.3, -d.h / 2 - 4, 1, fl * 0.3, -d.h / 2 - 4, 11);
        g2.addColorStop(0, '#FFF3B0'); g2.addColorStop(0.55, C.sunny); g2.addColorStop(1, 'rgba(255,142,60,0)');
        c.fillStyle = g2;
        c.beginPath(); c.ellipse(fl * 0.4, -d.h / 2 - 4, 6 + fl * 0.4, 10, fl * 0.05, 0, TAU); c.fill();
        c.fillStyle = C.tangerine;
        c.beginPath(); c.ellipse(fl * 0.3, -d.h / 2 - 2, 2.6, 4.5, 0, 0, TAU); c.fill();
      } else {
        c.strokeStyle = 'rgba(140,122,107,0.6)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, -d.h / 2 + 4);
        c.quadraticCurveTo(4, -d.h / 2 - 4, 1, -d.h / 2 - 10); c.stroke(); // smoke wisp
      }
    },

    fuse(c, d, a, o, body) {
      const fm = body ? body.plugin.lab.fuse : { a: 0.5, b: 0.5, ignited: false, active: false };
      const len = d.w;
      // braided cord: draw unburnt segments only
      const seg = (u0, u1, col, lw) => {
        if (u1 - u0 < 0.01) return;
        c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round';
        c.beginPath();
        for (let i = 0; i <= 16; i++) {
          const u = u0 + (u1 - u0) * i / 16;
          const x = (u - 0.5) * len;
          const y = Math.sin(u * 26) * 2.2;
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
      };
      if (!fm.ignited) {
        seg(0, 1, C.woodDark, 5); seg(0, 1, C.tangerine, 2);
      } else {
        seg(0, fm.a, C.woodDark, 5); seg(0, fm.a, C.tangerine, 2);
        seg(fm.b, 1, C.woodDark, 5); seg(fm.b, 1, C.tangerine, 2);
        // char stubs at the burnt boundary
        c.fillStyle = 'rgba(67,52,43,0.55)';
        for (const u of [fm.a > 0 ? fm.a : null, fm.b < 1 ? fm.b : null]) {
          if (u == null) continue;
          circle(c, (u - 0.5) * len, Math.sin(u * 26) * 2.2, 3); c.fill();
        }
        // glowing sparks on active fronts
        if (fm.active) {
          for (const u of [fm.a > 0 ? fm.a : null, fm.b < 1 ? fm.b : null]) {
            if (u == null) continue;
            const x = (u - 0.5) * len, y = Math.sin(u * 26) * 2.2;
            const tw = 0.7 + 0.3 * Math.sin((o ? o.t : 0) * 30 + u * 60);
            c.fillStyle = `rgba(255,197,61,${tw})`; star4(c, x, y, 7, (o ? o.t : 0) * 6); c.fill();
            c.fillStyle = '#FFF3B0'; circle(c, x, y, 2.4); c.fill();
          }
        }
      }
    },

    hydrant(c, d, a, o, body) {
      const dir = d.dir || 'right';
      const active = body && body.plugin.lab.hyd && body.plugin.lab.hyd.active;
      // sleepy Zz while idle (same language as the magnet)
      if (body && !active) {
        c.fillStyle = C.inkSoft; c.font = '700 11px ui-rounded, system-ui, sans-serif';
        const zt = (o ? o.t : 0) % 2;
        c.globalAlpha = zt < 1 ? zt : 2 - zt;
        c.fillText('z', 20, -30 - zt * 6); c.fillText('Z', 26, -38 - zt * 6);
        c.globalAlpha = 1;
      }
      c.save();
      if (dir === 'left') c.scale(-1, 1);
      // body
      c.fillStyle = C.poppy;
      rr(c, -d.w / 2 + 6, -d.h / 2 + 8, d.w - 12, d.h - 12, 9); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -d.w / 2 + 6, -d.h / 2 + 8, d.w - 12, d.h - 12, 9); c.stroke();
      // dome + base
      c.fillStyle = C.poppy;
      c.beginPath(); c.arc(0, -d.h / 2 + 9, 12, Math.PI, 0); c.fill();
      c.strokeStyle = C.outline; c.beginPath(); c.arc(0, -d.h / 2 + 9, 12, Math.PI, 0); c.stroke();
      c.fillStyle = C.sunny; circle(c, 0, -d.h / 2 + 4, 3.5); c.fill();
      c.fillStyle = C.woodMid; rr(c, -d.w / 2, d.h / 2 - 7, d.w, 7, 3); c.fill();
      // side bolts
      c.fillStyle = '#B93A28'; circle(c, -d.w / 2 + 12, 2, 3); c.fill(); circle(c, d.w / 2 - 12, 2, 3); c.fill();
      // nozzle (points along dir; for 'up' rotate the whole nozzle)
      c.save();
      if (dir === 'up') { c.rotate(-Math.PI / 2); c.translate(d.h / 2 - 20, 0); }
      c.fillStyle = '#B93A28'; rr(c, d.w / 2 - 8, -7, 14, 14, 4); c.fill();
      c.fillStyle = C.sky; rr(c, d.w / 2 + 4, -5, 6, 10, 2); c.fill();
      c.restore();
      c.restore();
    },

    switch(c, d, a, o, body) {
      const pressed = body && body.plugin.lab.sw.pressedState;
      // base
      c.fillStyle = C.woodMid; rr(c, -d.w / 2, 0, d.w, d.h / 2, 4); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -d.w / 2, 0, d.w, d.h / 2, 4); c.stroke();
      // plate (sinks when pressed)
      const py = pressed ? 2 : -4;
      c.fillStyle = pressed ? C.leaf : C.tangerine;
      rr(c, -d.w / 2 + 6, py - 6, d.w - 12, 8, 4); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; rr(c, -d.w / 2 + 6, py - 6, d.w - 12, 8, 4); c.stroke();
      // indicator dot
      c.fillStyle = pressed ? C.leaf : 'rgba(95,179,88,0.35)';
      circle(c, d.w / 2 - 8, d.h / 2 - 5, 2.5); c.fill();
    },

    fist(c, d, a, o, body) {
      const fm = body ? body.plugin.lab.fist : { cooldown: 0 };
      const punch = fm.cooldown > FIST_ANIM_T ? (fm.cooldown - FIST_ANIM_T) / (60 - FIST_ANIM_T) : 0;
      const lift = punch * 26; // glove extends upward right after firing
      // back plunger (remote trigger): pops back out as the fist re-arms
      const plunge = fm.cooldown > FIST_ANIM_T ? 2 : 7;
      c.fillStyle = C.poppy;
      rr(c, -11, d.h / 2 - 3, 22, plunge, 3); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5;
      rr(c, -11, d.h / 2 - 3, 22, plunge, 3); c.stroke();
      // box base
      c.fillStyle = C.woodLight; rr(c, -d.w / 2, 0, d.w, d.h / 2, 5); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -d.w / 2, 0, d.w, d.h / 2, 5); c.stroke();
      c.fillStyle = C.sunny; star4(c, 0, d.h / 4, 6, 0.2); c.fill();
      // spring
      c.strokeStyle = C.inkSoft; c.lineWidth = 2.5;
      c.beginPath();
      const top = -6 - lift;
      for (let i = 0; i <= 6; i++) {
        const yy = 0 + (top - 0) * i / 6;
        c.lineTo(i % 2 ? 10 : -10, yy);
      }
      c.stroke();
      // boxing glove
      c.fillStyle = C.poppy;
      c.beginPath(); c.ellipse(0, top - 9, 16, 12, 0, 0, TAU); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2;
      c.beginPath(); c.ellipse(0, top - 9, 16, 12, 0, 0, TAU); c.stroke();
      c.fillStyle = '#B93A28'; rr(c, -7, top - 2, 14, 6, 3); c.fill();
      c.fillStyle = 'rgba(255,249,238,0.7)';
      c.beginPath(); c.ellipse(-6, top - 13, 4, 2.5, -0.5, 0, TAU); c.fill();
    },

    match(c, d, a, o, body) {
      const mm = body ? body.plugin.lab.match : { lit: false, dead: false };
      // wooden stick
      c.fillStyle = C.woodLight; rr(c, -d.w / 2, -d.h / 2 + 10, d.w, d.h - 10, 4); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -d.w / 2, -d.h / 2 + 10, d.w, d.h - 10, 4); c.stroke();
      // head: cherry red when fresh, charcoal once spent
      c.fillStyle = mm.dead ? '#5A4A3E' : C.poppy;
      c.beginPath(); c.ellipse(0, -d.h / 2 + 6, d.w / 2 + 3, 9, 0, 0, TAU); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5;
      c.beginPath(); c.ellipse(0, -d.h / 2 + 6, d.w / 2 + 3, 9, 0, 0, TAU); c.stroke();
      if (!mm.dead && !mm.lit) { // shine charm on a fresh head
        c.fillStyle = 'rgba(255,249,238,0.75)';
        c.beginPath(); c.ellipse(-2.5, -d.h / 2 + 3, 2.4, 1.6, -0.5, 0, TAU); c.fill();
      }
      if (mm.lit) {
        // flare: bigger, wilder flame than the candle's steady teardrop
        const t = o ? o.t : 0;
        const fl = Math.sin(t * 13 + (d.seed || 0)) * 2;
        const g2 = c.createRadialGradient(fl * 0.3, -d.h / 2 - 6, 1, fl * 0.3, -d.h / 2 - 6, 14);
        g2.addColorStop(0, '#FFF3B0'); g2.addColorStop(0.5, C.sunny); g2.addColorStop(1, 'rgba(255,142,60,0)');
        c.fillStyle = g2;
        c.beginPath(); c.ellipse(fl * 0.5, -d.h / 2 - 6, 8 + fl * 0.6, 13, fl * 0.06, 0, TAU); c.fill();
        c.fillStyle = C.tangerine;
        c.beginPath(); c.ellipse(fl * 0.35, -d.h / 2 - 3, 3.2, 5.5, 0, 0, TAU); c.fill();
      } else if (mm.dead) {
        c.strokeStyle = 'rgba(140,122,107,0.6)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, -d.h / 2 - 2);
        c.quadraticCurveTo(4, -d.h / 2 - 9, 1, -d.h / 2 - 15); c.stroke(); // smoke wisp
      }
    },

    laser(c, d, a, o, body) {
      // reads as a ray-gun at ANY rotation: round turret (rotation-agnostic),
      // tapered barrel with a flared muzzle dish, red tail knob at the back
      const lz = body ? body.plugin.lab.laz : { firing: 0, beamLen: 0 };
      const t = o ? o.t : 0;
      const firing = lz.firing > 0 && lz.beamLen > 0;
      const my = -d.h / 2; // muzzle line (the beam itself is drawn in the
      // world-space beam pass — it can bend through mirrors now)
      // tail knob: tells the eye which end is the back
      c.fillStyle = C.poppy; circle(c, 0, 25, 7); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, 0, 25, 7); c.stroke();
      // long neck flaring into a ray-gun bell at the muzzle
      c.fillStyle = C.blueDeep;
      c.beginPath(); c.moveTo(-6, 8); c.lineTo(6, 8); c.lineTo(11, my + 4); c.lineTo(-11, my + 4); c.closePath(); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-6, 8); c.lineTo(6, 8); c.lineTo(11, my + 4); c.lineTo(-11, my + 4); c.closePath(); c.stroke();
      // stripe on the neck (charm detail)
      c.strokeStyle = C.sunny; c.lineWidth = 3;
      c.beginPath(); c.moveTo(-8, my + 14); c.lineTo(8, my + 14); c.stroke();
      // muzzle dish
      c.fillStyle = C.loryBlue; rr(c, -13, my - 3, 26, 8, 4); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -13, my - 3, 26, 8, 4); c.stroke();
      // round turret at the back
      const g = c.createRadialGradient(-5, 5, 3, 0, 10, 19);
      g.addColorStop(0, '#6FA0EA'); g.addColorStop(1, C.loryBlue);
      c.fillStyle = g; circle(c, 0, 10, 16); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, 0, 10, 16); c.stroke();
      // star charm + lens (breathing charge light, white-hot while firing)
      c.fillStyle = C.sunny; star4(c, 0, 10, 6.5, 0.2); c.fill();
      c.globalAlpha = firing ? 1 : 0.5 + 0.2 * Math.sin(t * 4 + (d.seed || 0));
      c.fillStyle = firing ? '#FFF3B0' : C.sky;
      circle(c, 0, my + 1, 5); c.fill();
      c.globalAlpha = 1;
    },

    bulb(c, d, a, o, body) {
      const bm = body ? body.plugin.lab.bulb : { on: false, cooldown: 0 };
      const t = o ? o.t : 0;
      // warm halo first, under everything, when lit
      if (bm.on) {
        const g0 = c.createRadialGradient(0, -6, 6, 0, -6, 64);
        g0.addColorStop(0, 'rgba(255,197,61,0.5)'); g0.addColorStop(1, 'rgba(255,197,61,0)');
        c.fillStyle = g0; circle(c, 0, -6, 64); c.fill();
      }
      // wooden housing
      c.fillStyle = C.woodLight; rr(c, -d.w / 2, -d.h / 2, d.w, d.h, 9); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -d.w / 2, -d.h / 2, d.w, d.h, 9); c.stroke();
      // the button, on the face spec.dir points to (pressed-in while cooling)
      const dv = d.dir === 'left' ? { x: -1, y: 0 } : d.dir === 'up' ? { x: 0, y: -1 } : { x: 1, y: 0 };
      const bx = dv.x * (d.w / 2 - 1), by2 = dv.y * (d.h / 2 - 1);
      const pop2 = bm.cooldown > 0 ? 3 : 6;
      c.save(); c.translate(bx, by2); c.rotate(Math.atan2(dv.y, dv.x));
      c.fillStyle = C.poppy; rr(c, -2, -11, pop2 + 2, 22, 3); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; rr(c, -2, -11, pop2 + 2, 22, 3); c.stroke();
      c.restore();
      // lamp glass
      const g1 = c.createRadialGradient(-4, -10, 2, 0, -6, 17);
      if (bm.on) { g1.addColorStop(0, '#FFF6C8'); g1.addColorStop(0.6, C.sunny); g1.addColorStop(1, C.tangerine); }
      else { g1.addColorStop(0, '#EEF3F5'); g1.addColorStop(1, '#B9C8CE'); }
      c.fillStyle = g1; circle(c, 0, -6, 16); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, 0, -6, 16); c.stroke();
      // filament zigzag (dark when off, white-hot when on)
      c.strokeStyle = bm.on ? '#FFF9EE' : 'rgba(67,52,43,0.45)'; c.lineWidth = 1.8;
      c.beginPath(); c.moveTo(-6, -3);
      for (let i = 0; i <= 4; i++) c.lineTo(-6 + i * 3, i % 2 ? -9 : -3);
      c.stroke();
      // screw base under the glass
      c.fillStyle = C.inkSoft; rr(c, -8, 9, 16, 10, 2); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; rr(c, -8, 9, 16, 10, 2); c.stroke();
      c.strokeStyle = 'rgba(255,249,238,0.5)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-7, 12); c.lineTo(7, 13); c.moveTo(-7, 15); c.lineTo(7, 16); c.stroke();
      // sparkle charm when lit
      if (bm.on) { c.fillStyle = C.paper; star4(c, 8, -12, 3.5, 0.2 + t); c.fill(); }
    },

    lens(c, d, a, o, body) {
      const lz = body ? body.plugin.lab.lens : { firing: 0, beamLen: 0 };
      const t = o ? o.t : 0;
      const firing = lz.firing > 0 && lz.beamLen > 0;
      // incoming light: a soft ray from the feeding bulb into the lens
      const fed = body && body.plugin.lab.fedBy;
      if (fed) {
        const dx = fed.x - body.position.x, dy = fed.y - body.position.y;
        const ca = Math.cos(-body.angle), sa = Math.sin(-body.angle);
        const lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
        const g0 = c.createLinearGradient(0, 0, lx, ly);
        g0.addColorStop(0, 'rgba(255,197,61,0.55)'); g0.addColorStop(1, 'rgba(255,197,61,0)');
        c.strokeStyle = g0; c.lineWidth = 10; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, 0); c.lineTo(lx, ly); c.stroke();
      }
      void firing; // beam drawn in the world-space pass; glow state below
      // mount
      c.fillStyle = C.woodMid; rr(c, -d.w / 2, d.h / 2 - 7, d.w, 7, 3); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; rr(c, -d.w / 2, d.h / 2 - 7, d.w, 7, 3); c.stroke();
      // lens glass, edge-on: a wide sparkling ellipse in a deep-blue rim
      c.fillStyle = C.blueDeep;
      c.beginPath(); c.ellipse(0, -2, d.w / 2 - 2, 9, 0, 0, TAU); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2;
      c.beginPath(); c.ellipse(0, -2, d.w / 2 - 2, 9, 0, 0, TAU); c.stroke();
      const g1 = c.createRadialGradient(-5, -4, 1, 0, -2, 18);
      g1.addColorStop(0, '#E8F6FD'); g1.addColorStop(0.6, C.sky); g1.addColorStop(1, '#5FA8CC');
      c.fillStyle = g1;
      c.beginPath(); c.ellipse(0, -2, d.w / 2 - 6, 6, 0, 0, TAU); c.fill();
      // glint
      c.fillStyle = 'rgba(255,249,238,0.85)';
      c.beginPath(); c.ellipse(-8, -4, 4, 1.8, -0.3, 0, TAU); c.fill();
      // charge shimmer while focusing
      if (fed) { c.fillStyle = C.sunny; star4(c, 10, -5, 3 + Math.sin(t * 9) * 0.8, 0.3); c.fill(); }
    },

    sparkle(c, d, a, o) {
      const t = o ? o.t : 0;
      const tw = 0.75 + 0.25 * Math.sin(t * TAU / 0.9 + (d.seed || 0));
      c.save(); c.globalAlpha = tw; c.rotate(Math.sin(t * TAU / 4) * 0.3);
      c.fillStyle = C.sunny; star4(c, 0, 0, d.r, 0); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; star4(c, 0, 0, d.r, 0); c.stroke();
      c.fillStyle = C.paper; circle(c, 0, 0, d.r * 0.3); c.fill();
      c.restore();
    },

    cannon(c, d, a, o, body) {
      // Toy cannon: wooden chest on wheels, swivel-mounted barrel (d.elev =
      // barrel elevation only — the chest never tilts), loading hatch on the
      // top-back (OPEN = hungry, SHUT = loaded & ready), breech fuse at the
      // back. Geometry mirrors core.js: pivot (10,-10), barrel length 46.
      const cm = body ? body.plugin.lab.cannon
        : { loaded: false, fuseLit: false, fuseT: 0, cooldown: 0, dead: false, doorAnim: 0, fireAnim: 0 };
      const t = o ? o.t : 0;
      const elev = clamp(d.elev == null ? 45 : d.elev, 0, 75) * Math.PI / 180;
      const hw = d.w / 2, hh = d.h / 2;
      c.save();
      if (d.dir === 'left') c.scale(-1, 1);
      // wooden chest, top edge flush with the physics box top so resting
      // balls sit true; the 14px shaved off the bottom makes room for wheels
      c.save(); c.translate(0, -7); woodBlock(c, d.w, d.h - 14, 8); c.restore();
      // wheels
      for (const s of [-1, 1]) {
        c.fillStyle = C.sunny; circle(c, s * 24, hh - 12, 12); c.fill();
        c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, s * 24, hh - 12, 12); c.stroke();
        c.strokeStyle = C.woodMid; c.lineWidth = 2;
        c.beginPath(); c.moveTo(s * 24 - 7, hh - 12); c.lineTo(s * 24 + 7, hh - 12); c.stroke();
        c.fillStyle = C.woodMid; circle(c, s * 24, hh - 12, 3.5); c.fill();
      }
      // star charm on the chest front
      c.fillStyle = C.sunny; star4(c, 26, 6, 6, 0.2); c.fill();
      // loading hatch: dark mouth + a chunky trapdoor lid hinged at the back
      // edge. OPEN = flipped back over the breech (hungry), SHUT = lying
      // proud on top with its knob up (loaded & ready — or spent for good:
      // a dead cannon keeps its lid down forever). doorAnim (10->0) tweens
      // toward the current resting pose, so loading reads as a slam.
      const k = clamp(cm.doorAnim / 10, 0, 1);
      const shut = cm.loaded || cm.dead;
      const lidA = shut ? -2.0 * k : -2.0 * (1 - k);
      if (lidA < -0.1) { // the mouth, visible while the lid is open(ing)
        c.fillStyle = 'rgba(46,35,27,0.75)';
        rr(c, -38, -hh, 40, 7, 3.5); c.fill();
        c.fillStyle = 'rgba(255,249,238,0.18)';
        rr(c, -36, -hh + 1, 36, 2, 1); c.fill(); // inner lip glint
      }
      c.save();
      c.translate(-42, -hh + 1); c.rotate(lidA);
      const g2 = c.createLinearGradient(0, -8, 0, 0);
      g2.addColorStop(0, C.woodLight); g2.addColorStop(1, C.woodMid);
      c.fillStyle = g2; rr(c, 0, -8, 46, 8, 4); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, 0, -8, 46, 8, 4); c.stroke();
      c.fillStyle = C.poppy; circle(c, 23, -8, 3.2); c.fill(); // lid knob
      c.strokeStyle = C.outline; c.lineWidth = 1.2; circle(c, 23, -8, 3.2); c.stroke();
      c.restore();
      // barrel on its swivel mount, recoiling back along its own axis
      c.save();
      c.translate(10, -10); c.rotate(-elev);
      if (cm.fireAnim > 0) c.translate(-cm.fireAnim * 0.8, 0);
      c.fillStyle = C.poppy; circle(c, -18, 0, 6); c.fill(); // cascabel knob
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, -18, 0, 6); c.stroke();
      const g = c.createLinearGradient(0, -10, 0, 10);
      g.addColorStop(0, '#6FA0EA'); g.addColorStop(0.5, C.loryBlue); g.addColorStop(1, C.blueDeep);
      c.fillStyle = g;
      c.beginPath(); c.moveTo(-14, -9.5); c.lineTo(40, -7.5); c.lineTo(40, 7.5); c.lineTo(-14, 9.5); c.closePath(); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; c.stroke();
      c.strokeStyle = C.sunny; c.lineWidth = 3; // stripe charm near the muzzle
      c.beginPath(); c.moveTo(28, -7.5); c.lineTo(28, 7.5); c.stroke();
      c.fillStyle = C.blueDeep; rr(c, 38, -9.5, 8, 19, 3); c.fill(); // muzzle ring
      c.strokeStyle = C.outline; c.lineWidth = 1.5; rr(c, 38, -9.5, 8, 19, 3); c.stroke();
      if (cm.fireAnim > 8) { // muzzle flash, first frames only
        const fk = (cm.fireAnim - 8) / 6;
        c.fillStyle = `rgba(255,197,61,${0.9 * fk})`; star4(c, 52, 0, 6 + 16 * fk, t * 9); c.fill();
        c.fillStyle = `rgba(255,243,176,${0.9 * fk})`; circle(c, 50, 0, 2 + 7 * fk); c.fill();
      }
      c.restore();
      // swivel bolt over the barrel: reads as the mount
      c.fillStyle = C.sunny; circle(c, 10, -10, 5.5); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; circle(c, 10, -10, 5.5); c.stroke();
      // breech fuse: cord curling out of the touch-hole at the top-back —
      // or, once spent, a permanent charred stub (this cannon is done)
      const fx0 = -hw - 8, fy0 = -hh + 8;
      if (!cm.dead) {
        for (const [col, lw] of [[C.woodDark, 4], [C.tangerine, 1.6]]) {
          c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round';
          c.beginPath(); c.moveTo(-hw + 3, -hh + 12);
          c.quadraticCurveTo(-hw - 8, -hh + 16, fx0, fy0); c.stroke();
        }
      }
      if (cm.fuseLit) { // sizzling spark — same language as the fuse part
        const tw = 0.7 + 0.3 * Math.sin(t * 30);
        const g3 = c.createRadialGradient(fx0, fy0, 1, fx0, fy0, 16);
        g3.addColorStop(0, 'rgba(255,243,176,0.9)'); g3.addColorStop(1, 'rgba(255,142,60,0)');
        c.fillStyle = g3; circle(c, fx0, fy0, 16); c.fill();
        c.fillStyle = `rgba(255,197,61,${tw})`; star4(c, fx0, fy0, 9, t * 6); c.fill();
        c.fillStyle = '#FFF3B0'; circle(c, fx0, fy0, 3); c.fill();
      } else if (cm.dead) { // spent: charred stub, smoke only right after
        c.strokeStyle = 'rgba(67,52,43,0.55)'; c.lineWidth = 4; c.lineCap = 'round';
        c.beginPath(); c.moveTo(-hw + 3, -hh + 12);
        c.quadraticCurveTo(-hw - 4, -hh + 13, -hw - 5, -hh + 10); c.stroke();
        if (cm.cooldown > 0) {
          c.strokeStyle = 'rgba(140,122,107,0.6)'; c.lineWidth = 2;
          c.beginPath(); c.moveTo(-hw - 5, -hh + 7);
          c.quadraticCurveTo(-hw - 1, -hh, -hw - 4, -hh - 6); c.stroke();
        }
      }
      c.restore();
    },

    mirror(c, d) {
      const w = d.w, h = d.h;
      // wooden back (the absorbing side)
      c.fillStyle = C.woodMid; rr(c, -w / 2, -2, w, h / 2 + 4, 4); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -w / 2, -2, w, h / 2 + 4, 4); c.stroke();
      // glass face on the local-up side (the shiny reflector)
      const g = c.createLinearGradient(0, -h / 2, 0, 2);
      g.addColorStop(0, '#E8F6FD'); g.addColorStop(0.6, C.sky); g.addColorStop(1, '#5FA8CC');
      c.fillStyle = g; rr(c, -w / 2 + 1, -h / 2, w - 2, h / 2 + 3, 3); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; rr(c, -w / 2 + 1, -h / 2, w - 2, h / 2 + 3, 3); c.stroke();
      // glints
      c.strokeStyle = 'rgba(255,249,238,0.85)'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-w / 4 - 6, 0); c.lineTo(-w / 4 + 6, -h / 2 + 2);
      c.moveTo(w / 6 - 5, 0); c.lineTo(w / 6 + 5, -h / 2 + 2);
      c.stroke();
      // frame caps
      c.fillStyle = C.sunny; circle(c, -w / 2 + 3, 1, 3.5); c.fill(); circle(c, w / 2 - 3, 1, 3.5); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.2;
      circle(c, -w / 2 + 3, 1, 3.5); c.stroke(); circle(c, w / 2 - 3, 1, 3.5); c.stroke();
    },

    drawbridge(c, d) {
      const w = d.w, h = d.h;
      c.save();
      if (d.dir === 'left') c.scale(-1, 1); // the free tip is the mirrored end
      woodBlock(c, w, h, 5);
      // cross straps
      c.strokeStyle = 'rgba(143,98,56,0.5)'; c.lineWidth = 3;
      for (const sx of [-w * 0.32, 0, w * 0.32]) {
        c.beginPath(); c.moveTo(sx, -h / 2 + 2); c.lineTo(sx, h / 2 - 2); c.stroke();
      }
      // iron edge + chain ring at the free tip
      c.fillStyle = C.inkSoft; rr(c, w / 2 - 6, -h / 2, 6, h, 2); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.2; rr(c, w / 2 - 6, -h / 2, 6, h, 2); c.stroke();
      c.strokeStyle = C.woodDark; c.lineWidth = 2.5;
      circle(c, w / 2 - 10, -h / 2 - 5, 4.5); c.stroke();
      c.restore();
    },

    bridgeBase(c) { // hinge mount, drawn separately at the anchor (not rotated)
      c.fillStyle = C.woodDark;
      c.beginPath();
      c.moveTo(0, -4); c.lineTo(13, 22); c.quadraticCurveTo(15, 26, 10, 26);
      c.lineTo(-10, 26); c.quadraticCurveTo(-15, 26, -13, 22); c.closePath(); c.fill();
      c.fillStyle = C.sunny; circle(c, 0, 0, 6); c.fill();
      c.strokeStyle = C.ink; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-3, 0); c.lineTo(3, 0); c.moveTo(0, -3); c.lineTo(0, 3); c.stroke();
    },

    pullcord(c, d, a, o, body) {
      const cm = body ? body.plugin.lab.cord : { pulled: false, yank: 0 };
      const t = o ? o.t : 0;
      // anchor plate, rope-family look
      c.fillStyle = C.woodMid; rr(c, -d.w / 2, -d.h / 2, d.w, d.h, 5); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, -d.w / 2, -d.h / 2, d.w, d.h, 5); c.stroke();
      c.fillStyle = C.inkSoft; circle(c, -d.w / 4, 0, 1.8); c.fill(); circle(c, d.w / 4, 0, 1.8); c.fill();
      // cord down to the ring; a yank stretches it, pulled leaves it low &
      // slack. Tray icons get a compact cord so the well can hold it.
      const yank = cm.yank > 0 ? Math.sin(cm.yank * 0.8) * 8 : 0;
      const drop = (d.icon ? 42 : 95) + (cm.pulled ? 10 : 0) + yank;
      const sway = cm.pulled ? 0 : Math.sin(t * 1.7 + (d.seed || 0)) * 3;
      for (const [col, lw] of [[C.woodDark, 4], [C.tangerine, 1.6]]) {
        c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, d.h / 2);
        c.quadraticCurveTo(sway, d.h / 2 + drop * 0.55, sway, drop - 13); c.stroke();
      }
      // the pull ring (grayed once spent)
      c.strokeStyle = cm.pulled ? C.inkSoft : C.tangerine; c.lineWidth = 5;
      circle(c, sway, drop - 3, 9); c.stroke();
      c.strokeStyle = C.outline; c.lineWidth = 1.5;
      circle(c, sway, drop - 3, 11.5); c.stroke(); circle(c, sway, drop - 3, 6.5); c.stroke();
    },

    basket(c, d, a, o, body) {
      const w = d.w, h = d.h;
      c.save();
      if (d.dir === 'left') c.scale(-1, 1);
      const rimY = -14;             // matches the physics rim line
      const boardX = w / 2 - 5;
      // mount bracket behind the board
      c.fillStyle = C.woodMid; rr(c, boardX - 2, rimY - 32, 12, 22, 3); c.fill();
      // backboard with target box
      c.fillStyle = C.paper; rr(c, boardX - 5, -h / 2 + 2, 10, 84, 4); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 2; rr(c, boardX - 5, -h / 2 + 2, 10, 84, 4); c.stroke();
      c.strokeStyle = C.poppy; c.lineWidth = 2.5;
      rr(c, boardX - 3, rimY - 26, 6, 22, 2); c.stroke();
      // net, swaying after a swish
      const sw2 = a && a.netT != null ? Math.sin(a.netT * 12) * 6 * Math.exp(-a.netT * 2.5) : 0;
      const rimL = -(w / 2 - 6), rimR = w / 2 - 12;
      const netB = rimY + 34;
      c.strokeStyle = 'rgba(255,249,238,0.95)'; c.lineWidth = 1.8;
      for (let i = 0; i <= 4; i++) {
        const u = i / 4;
        c.beginPath();
        c.moveTo(rimL + (rimR - rimL) * u, rimY + 2);
        c.lineTo(rimL + 9 + (rimR - rimL - 18) * u + sw2, netB);
        c.stroke();
        c.beginPath();
        c.moveTo(rimR - (rimR - rimL) * u, rimY + 2);
        c.lineTo(rimR - 9 - (rimR - rimL - 18) * u + sw2, netB);
        c.stroke();
      }
      c.strokeStyle = 'rgba(255,249,238,0.8)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(rimL + 8 + sw2 * 0.7, netB); c.lineTo(rimR - 8 + sw2 * 0.7, netB); c.stroke();
      // rim tube + support strut + front nub
      c.strokeStyle = C.tangerine; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(rimL, rimY); c.lineTo(boardX - 4, rimY); c.stroke();
      c.strokeStyle = '#C96A22'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(boardX - 4, rimY + 12); c.lineTo(rimL + 28, rimY + 4); c.stroke();
      c.fillStyle = C.poppy; circle(c, rimL, rimY, 5); c.fill();
      c.strokeStyle = C.outline; c.lineWidth = 1.5; circle(c, rimL, rimY, 5); c.stroke();
      c.restore();
    },

    ball_basket(c, d, a, o, body) {
      const r = d.r, rot = body ? body.angle : 0;
      c.rotate(-rot); // seams roll at juiced speed; glint stays screen-aligned
      const spin = juicy ? rot * JUICE_SPIN : rot;
      c.fillStyle = C.tangerine; circle(c, 0, 0, r); c.fill();
      c.save(); circle(c, 0, 0, r); c.clip(); c.rotate(spin);
      c.strokeStyle = 'rgba(67,52,43,0.65)'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, -r); c.lineTo(0, r); c.stroke();
      c.beginPath(); c.moveTo(-r, 0); c.lineTo(r, 0); c.stroke();
      c.beginPath(); c.arc(-r * 1.35, 0, r * 1.05, -0.9, 0.9); c.stroke();
      c.beginPath(); c.arc(r * 1.35, 0, r * 1.05, Math.PI - 0.9, Math.PI + 0.9); c.stroke();
      c.restore();
      c.strokeStyle = C.outline; c.lineWidth = 2; circle(c, 0, 0, r); c.stroke();
      c.fillStyle = 'rgba(255,249,238,0.75)';
      c.beginPath(); c.ellipse(-r * 0.35, -r * 0.4, 6, 3.5, -0.6, 0, TAU); c.fill();
      c.rotate(rot);
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
      } else if (p.kind === 'drop') {
        p.vy += 16 * dt; p.x += p.vx * k; p.y += p.vy * k;
      } else if (p.kind === 'flamep') {
        p.x += p.vx * k; p.y += p.vy * k; p.r *= Math.pow(0.96, k);
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
      } else if (p.kind === 'drop') {
        c.fillStyle = 'rgba(124,199,232,0.85)';
        circle(c, p.x, p.y, p.r); c.fill();
        c.fillStyle = 'rgba(255,249,238,0.6)';
        circle(c, p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.35); c.fill();
      } else if (p.kind === 'flamep') {
        c.fillStyle = `rgba(255,142,60,${0.75 * k})`;
        circle(c, p.x, p.y, p.r); c.fill();
        c.fillStyle = `rgba(255,243,176,${0.8 * k})`;
        circle(c, p.x, p.y + 1, p.r * 0.45); c.fill();
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
        case 'snip':
          if (e.cause === 'fire') { fx.poof(e.x, e.y, 4); for (let i = 0; i < 5; i++) spawn({ kind: 'flamep', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 2, life: 0.45, t: 0, r: 3 }); }
          else { fx.stars(e.x, e.y, 4); fx.ring(e.x, e.y, C.paper); }
          markSnip(e, sim);
          break;
        case 'snipclick': markSnip(e, sim); break;
        case 'ignite':
          for (let i = 0; i < 7; i++) spawn({ kind: 'flamep', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 2.5, life: 0.5, t: 0, r: 3.2 });
          break;
        case 'extinguish':
          fx.poof(e.x, e.y, 6);
          for (let i = 0; i < 4; i++) spawn({ kind: 'drop', x: e.x + (Math.random() - 0.5) * 14, y: e.y, vx: (Math.random() - 0.5) * 3, vy: -2, life: 0.5, t: 0, r: 2.5 });
          break;
        case 'switch_on': fx.ring(e.x, e.y, C.leaf); break;
        case 'switch_off': fx.ring(e.x, e.y, C.inkSoft); break;
        case 'water_on': fx.ring(e.x, e.y, C.sky); break;
        case 'water_off': fx.poof(e.x, e.y - 20, 3); break;
        // fan_on/fan_off: audio-only (hum loop) — the spinning blades and
        // wind-zone dashes ARE the visual, no extra FX needed
        case 'thwack':
          fx.ring(e.x, e.y, C.poppy); fx.stars(e.x, e.y, 5); fx.poof(e.x, e.y + 10, 4);
          if (e.bodyId != null) squash.set(e.bodyId, { t: 0, nx: 0, ny: 1, amt: 0.3 });
          break;
        case 'laser': fx.ring(e.x, e.y, C.poppy); fx.stars(e.x, e.y, 4); break;
        case 'bulb_on': fx.ring(e.x, e.y, C.sunny); fx.stars(e.x, e.y - 10, 3); break;
        case 'bulb_off': fx.poof(e.x, e.y - 10, 3); break;
        case 'cannon_load': fx.ring(e.x, e.y, C.sunny); fx.poof(e.x, e.y, 3); break;
        case 'cannon_fire':
          fx.poof(e.x, e.y, 10); fx.ring(e.x, e.y, C.sunny); fx.stars(e.x, e.y, 6);
          for (let i = 0; i < 6; i++) spawn({ kind: 'flamep', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 - 1, life: 0.4, t: 0, r: 3.5 });
          break;
        case 'cannon_dud': fx.poof(e.x, e.y, 5); break;
        case 'cord_pull': fx.ring(e.x, e.y, C.tangerine); fx.stars(e.x, e.y, 4); break;
        // bridge_down: the swinging plank IS the visual (the creak is the sound)
        case 'bridge_landed': fx.poof(e.x, e.y, 6); break;
        case 'basket':
          fx.ring(e.x, e.y, C.sunny); fx.stars(e.x, e.y - 6, 8); fx.confetti(e.x, e.y - 10, 26);
          swishNet(e, sim);
          break;
        case 'win': shakeT = 0; break;
      }
    }
  }
  function markSnip(e, sim) {
    if (!sim) return;
    for (const p of sim.parts) {
      if (p.spec.type !== 'scissors') continue;
      const b = p.bodies[0];
      if (Math.hypot(b.position.x - e.x, b.position.y - e.y) < 60) partAnim(b.plugin.lab.id).snipT = 0.45;
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

  function swishNet(e, sim) {
    if (!sim) return;
    for (const p of sim.parts) {
      if (p.spec.type !== 'basket') continue;
      const b = p.bodies[0];
      if (Math.hypot(b.position.x - e.x, b.position.y - e.y) < 90)
        partAnim(b.plugin.lab.id).netT = 0;
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
      // a swallowed ball keeps its capture-time velocity but goes nowhere —
      // fall through to the else so its ribbon fades instead of pinning
      if (juicy && running && speed > JUICE_MIN_SPEED && !m.swallowed) {
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
        const m = p.bodies[0].plugin.lab;
        const off = m.switchControlled ? !m.poweredNow : p.spec.on === false;
        a.spin += ((running && !off) ? 9.4 : 0.9) * dt * TAU / 2;
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
      if (type === 'scissors' && a.snipT > 0) a.snipT = Math.max(0, a.snipT - dt);
      if (type === 'basket' && a.netT != null) {
        a.netT += dt;
        if (a.netT > 1.6) a.netT = null;
      }
    }
    for (const [id, s] of squash) { s.t += dt; if (s.t > 0.18) squash.delete(id); }
  }

  function drawPart(c, p, o, sim) {
    const spec = p.spec, type = spec.type;
    const body = p.bodies[0];
    const m = body.plugin.lab;
    // swallowed: sitting inside a cannon (body out of the world, frozen at
    // its capture spot) — invisible until the cannon fires it back out
    if (m.popped || m.collected || m.swallowed) return;
    const a = anim.get(m.id);

    // seesaw base behind the plank, at the constraint anchor
    if (type === 'seesaw') {
      c.save(); c.translate(spec.x, spec.y); painters.seesawBase(c); c.restore();
    }
    // drawbridge hinge mount behind the plank, at the anchor point
    if (type === 'drawbridge') {
      c.save(); c.translate(spec.x, spec.y); painters.bridgeBase(c); c.restore();
    }
    // rope line: braided cord from the anchor hook to the hanging body.
    // Puzzle-maker: a plucked anchor fades its cord along with itself.
    if (type === 'rope' && m.rope && m.rope.attached && !m.rope.cut) {
      const ax = body.position.x, ay = body.position.y + m.h / 2 + 3;
      const bx2 = m.rope.attached.position.x, by2 = m.rope.attached.position.y;
      c.save();
      const att = m.rope.attached.plugin.lab;
      if (spec._plucked || (att && att.spec && att.spec._plucked)) c.globalAlpha = 0.35;
      for (const [col, lw] of [[C.woodDark, 4.5], [C.tangerine, 1.8]]) {
        c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round';
        c.beginPath();
        for (let i = 0; i <= 14; i++) {
          const u = i / 14;
          const x = ax + (bx2 - ax) * u + Math.sin(u * 22) * 1.6;
          const y = ay + (by2 - ay) * u;
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.stroke();
      }
      c.restore();
    }
    // balloon strings (fade with a plucked balloon in the puzzle maker)
    if ((type === 'balloon' || type === 'balloon_goal')) {
      c.save();
      if (spec._plucked) c.globalAlpha = 0.35;
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
    // sits above the drawn geometry — align art to the physical bounds center.
    // The basket (also compound, never moves) is drawn from its spec anchor.
    if (type === 'bucket' || type === 'bowl') {
      c.translate((body.bounds.min.x + body.bounds.max.x) / 2,
        (body.bounds.min.y + body.bounds.max.y) / 2);
    } else if (type === 'basket') {
      c.translate(spec.x, spec.y);
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
    const d = { type, w: m.w, h: m.h, r: PART_R(spec), dir: m.dir, seed: body.id, elev: spec.angle };
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

  // wires from pressure switches to the device they power
  function drawWires(c, sim, o) {
    const byId = {};
    for (const p of sim.parts) byId[p.bodies[0].plugin.lab.id] = p;
    for (const p of sim.parts) {
      if (p.spec.type !== 'switch') continue;
      const m = p.bodies[0].plugin.lab.sw;
      if (!m.target || !byId[m.target]) continue;
      const a = p.bodies[0].position, b = byId[m.target].bodies[0].position;
      c.save();
      // puzzle-maker: the wire fades along with a plucked endpoint
      if (p.spec._plucked || byId[m.target].spec._plucked) c.globalAlpha = 0.35;
      c.strokeStyle = m.pressedState ? C.leaf : C.inkSoft;
      c.lineWidth = 2.5;
      c.setLineDash(m.pressedState ? [] : [6, 5]);
      if (m.pressedState) c.lineDashOffset = 0;
      const sag = 26 + Math.abs(b.x - a.x) * 0.08;
      c.beginPath();
      c.moveTo(a.x, a.y + 8);
      c.quadraticCurveTo((a.x + b.x) / 2, Math.max(a.y, b.y) + sag, b.x, b.y + 12);
      c.stroke();
      c.setLineDash([]);
      // plug dots
      c.fillStyle = m.pressedState ? C.leaf : C.inkSoft;
      circle(c, a.x, a.y + 8, 3); c.fill(); circle(c, b.x, b.y + 12, 3); c.fill();
      c.restore();
    }
  }

  // braided rope from each pullcord's anchor to its drawbridge's free tip —
  // taut while armed, slack once pulled / bridge down
  function drawPullRopes(c, sim) {
    const byId = {};
    for (const p of sim.parts) byId[p.bodies[0].plugin.lab.id] = p;
    for (const p of sim.parts) {
      if (p.spec.type !== 'pullcord') continue;
      const m = p.bodies[0].plugin.lab, cm = m.cord;
      if (!cm.target || !byId[cm.target]) continue;
      const bb = byId[cm.target].bodies[0], bm = bb.plugin.lab;
      const s = bm.dir === 'left' ? -1 : 1;
      const tip = {
        x: bb.position.x + Math.cos(bb.angle) * s * bm.w / 2,
        y: bb.position.y + Math.sin(bb.angle) * s * bm.w / 2,
      };
      const a = p.bodies[0].position;
      const slack = cm.pulled || bm.bridge.down;
      const sag = slack ? 48 : 12;
      // puzzle-maker: the rope fades along with a plucked cord or bridge
      const fade = p.spec._plucked || byId[cm.target].spec._plucked ? 0.35 : 1;
      c.save();
      for (const [col, lw] of [[C.woodDark, 3.5], [C.tangerine, 1.4]]) {
        c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'round';
        c.globalAlpha = (slack ? 0.6 : 1) * fade;
        c.beginPath();
        c.moveTo(a.x, a.y + 6);
        c.quadraticCurveTo((a.x + tip.x) / 2, Math.max(a.y, tip.y) + sag, tip.x, tip.y - 4);
        c.stroke();
      }
      c.restore();
    }
  }

  // ambient machine FX: water droplets along hydrant jets, flame flickers
  let ambT = 0;
  function stepMachineFx(sim, dt, running) {
    ambT += dt;
    if (!running) return;
    for (const p of sim.parts) {
      const body = p.bodies[0], m = body.plugin.lab;
      if (p.spec.type === 'hydrant') {
        if (!m.hyd || !m.hyd.active) continue;
        const dv = m.dir === 'left' ? { x: -1, y: 0 } : m.dir === 'up' ? { x: 0, y: -1 } : { x: 1, y: 0 };
        for (let i = 0; i < 2; i++) {
          const off = (Math.sin(ambT * 13 + i * 3 + body.id) + 1) / 2;
          spawn({
            kind: 'drop',
            x: body.position.x + dv.x * (30 + off * 4), y: body.position.y - (m.dir === 'up' ? 34 : -2) + (dv.x !== 0 ? -6 + off * 10 : 0),
            vx: dv.x * (5 + off * 2.5) + (Math.sin(ambT * 31 + i) * 0.6), vy: dv.y * (5 + off * 2.5) + (dv.x !== 0 ? -0.4 : 0),
            life: 0.55, t: 0, r: 2 + off * 2,
          });
        }
      } else if (p.spec.type === 'candle' && m.candle.lit && Math.random() < 0) {
        // (flame is drawn by the painter; occasional ember handled on events)
      } else if (p.spec.type === 'fuse' && m.fuse.active) {
        const fm = m.fuse;
        for (const u of [fm.a > 0 ? fm.a : null, fm.b < 1 ? fm.b : null]) {
          if (u == null) continue;
          const cs = Math.cos(body.angle), sn = Math.sin(body.angle);
          const lx = (u - 0.5) * fm.len;
          spawn({
            kind: 'flamep',
            x: body.position.x + lx * cs, y: body.position.y + lx * sn,
            vx: (Math.sin(ambT * 40 + u * 9) * 0.7), vy: -1.4,
            life: 0.4, t: 0, r: 2.5,
          });
        }
      }
    }
  }

  function drawWindZones(c, sim, o, faint) {
    for (const p of sim.parts) {
      if (p.spec.type !== 'fan') continue;
      const b = p.bodies[0], m = b.plugin.lab;
      const off = m.switchControlled ? !m.poweredNow : p.spec.on === false; // wired-unpowered or placed stopped
      const dv = m.dir === 'left' ? { x: -1, y: 0 } : m.dir === 'up' ? { x: 0, y: -1 } : { x: 1, y: 0 };
      c.save();
      c.globalAlpha = faint || off ? 0.18 : 0.55;
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
    // cannon angle = barrel elevation, not body rotation — never tilt it
    if (spec.type !== 'cannon') c.rotate((spec.angle || 0) * Math.PI / 180);
    // drawbridge ghosts preview the RAISED pose above the hinge anchor
    if (spec.type === 'drawbridge') {
      const bw = spec.w || window.LoryCore.PART_DEFS.drawbridge.w;
      c.translate(0, -bw / 2);
      c.rotate((spec.dir === 'left' ? 1 : -1) * Math.PI / 2);
    }
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
      const d = { type: spec.type, w, h, r: defs.r, dir: spec.dir, elev: spec.angle };
      (painters[spec.type] || painters.plank)(c, d, null, o, null);
    } else {
      c.globalAlpha = opts.invalid ? 0.75 : 0.9;
      const defs = window.LoryCore.PART_DEFS[spec.type];
      const d = { type: spec.type, w: spec.w || defs.w, h: spec.h || defs.h, r: defs.r, dir: spec.dir, elev: spec.angle };
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

  // selection halo + toy buttons (positions returned for hit-testing).
  // boost (>=1) enlarges buttons on small screens so fingers can hit them.
  function drawSelection(c, sel, o, boost, sandbox) {
    const B = boost || 1;
    const defs = window.LoryCore.PART_DEFS[sel.type];
    const w = (sel.w || defs.w || defs.r * 2), h = (sel.h || defs.h || defs.r * 2);
    c.save();
    c.translate(sel.x, sel.y);
    c.save();
    if (sel.type !== 'cannon') c.rotate((sel.angle || 0) * Math.PI / 180); // cannon angle = elevation
    if (sel.type === 'drawbridge') { c.translate(0, -w / 2); c.rotate(Math.PI / 2); } // halo hugs the raised plank
    c.strokeStyle = C.loryBlue; c.lineWidth = 3; c.setLineDash([6, 5]);
    c.lineDashOffset = -(o.t * 16 % 11);
    rr(c, -w / 2 - 8, -h / 2 - 8, w + 16, h + 16, 12); c.stroke();
    c.setLineDash([]); c.restore();
    c.restore();
    const btns = [];
    // above the part normally; below it when that would collide with the topbar
    let topY = sel.y - Math.max(w, h) / 2 - 44 * B;
    if (sel.type === 'drawbridge') topY = sel.y - w - 44 * B; // above the raised tip
    if (topY < 92 * B) topY = sel.y + Math.max(w, h) / 2 + 44 * B;
    const defsBtns = [];
    if (defs.rot) defsBtns.push({ id: 'rotl', icon: '⟲', col: C.loryBlue }, { id: 'rotr', icon: '⟳', col: C.loryBlue });
    if (defs.dir) defsBtns.push({ id: 'flip', icon: '⇄', col: C.tangerine });
    // candles start lit or cold, fans start running or stopped — the button
    // icon shows what tapping DOES
    if (sel.type === 'candle') defsBtns.push({ id: 'lit', icon: sel.lit === false ? '🔥' : '💨', col: C.tangerine });
    if (sel.type === 'fan') defsBtns.push({ id: 'lit', icon: sel.on === false ? '▶' : '⏸', col: C.tangerine });
    // sandbox puzzle marks: 🧩 sends the part to the player's tray, 📌 pins it
    // back into the scene (the escape hatch for editing a saved puzzle).
    // Sparkles are author-only scenery — never tray pieces.
    if (sandbox && sel.type !== 'sparkle') defsBtns.push({ id: 'pluck', icon: sel._plucked ? '📌' : '🧩', col: C.leaf });
    // every part explains itself: ? makes Lory describe it
    defsBtns.push({ id: 'info', icon: '?', col: C.sky });
    defsBtns.push({ id: 'del', icon: '✕', col: C.poppy, gap: 14 * B });
    const pitch = 54 * B;
    let total = defsBtns.length * pitch - 10 * B + 14 * B;
    let cx0 = clamp(sel.x - total / 2 + 22 * B, 30, BOARD_W - total);
    let run = 0;
    defsBtns.forEach((b, i) => {
      run += b.gap || 0;
      const bx = cx0 + i * pitch + run, by = clamp(topY, 40, 660 - 24 * B);
      c.save();
      c.fillStyle = b.col; circle(c, bx, by + 3 * B, 22 * B); c.fill();
      const dk = b.col === C.loryBlue ? C.blueDeep : b.col === C.poppy ? '#B93A28' : '#C96A22';
      c.fillStyle = dk;
      c.beginPath(); c.arc(bx, by + 3 * B, 22 * B, 0.15 * Math.PI, 0.85 * Math.PI); c.fill();
      c.fillStyle = b.col; circle(c, bx, by, 21 * B); c.fill();
      c.fillStyle = C.paper; c.font = `800 ${Math.round(20 * B)}px ui-rounded, system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(b.icon, bx, by + 1);
      c.restore();
      btns.push({ id: b.id, x: bx, y: by, r: 28 * B });
    });
    return btns;
  }

  // tray. boost enlarges wells on small screens. When the full set would
  // squeeze wells below a comfortable width (the 37-well sandbox!), the tray
  // paginates: big ‹ › buttons flip between pages of comfortable wells.
  function drawTray(c, tray, o, dragType, boost, pageIn) {
    const B = boost || 1;
    const y0 = BOARD_H;
    c.save();
    c.fillStyle = C.woodLight;
    rr(c, -10, y0, viewW + 20, TRAY_H + 10, 24); c.fill();
    c.strokeStyle = C.woodDark; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, y0 + 1); c.lineTo(viewW, y0 + 1); c.stroke();
    const wells = [];
    const arrows = [];
    const n = tray.length;
    const MIN_WELL = 64 * Math.min(B, 1.3); // narrower than this is finger-hostile
    let view = tray, wellW, pages = 1, page = 0;
    if (n * MIN_WELL <= viewW - 30) {
      wellW = Math.min(88 * B, (viewW - 30) / Math.max(n, 1));
    } else {
      const aw = 52 * B;                    // space reserved per ‹ › button
      const avail = viewW - 30 - 2 * aw;
      const perPage = Math.max(3, Math.floor(avail / (80 * B)));
      pages = Math.ceil(n / perPage);
      page = Math.max(0, Math.min(pageIn || 0, pages - 1));
      view = tray.slice(page * perPage, (page + 1) * perPage);
      wellW = Math.min(88 * B, avail / perPage);
      const cy = y0 + TRAY_H / 2 + 4;
      for (const [id, ax, glyph, on] of [
        ['prev', 15 + aw / 2, '‹', page > 0],
        ['next', viewW - 15 - aw / 2, '›', page < pages - 1],
      ]) {
        c.save();
        c.globalAlpha = on ? 1 : 0.25;
        c.fillStyle = C.sunny; circle(c, ax, cy + 3 * B, 22 * B); c.fill();
        c.fillStyle = '#C99A20';
        c.beginPath(); c.arc(ax, cy + 3 * B, 22 * B, 0.15 * Math.PI, 0.85 * Math.PI); c.fill();
        c.fillStyle = C.sunny; circle(c, ax, cy, 21 * B); c.fill();
        c.fillStyle = C.ink; c.font = `800 ${Math.round(26 * B)}px ui-rounded, system-ui, sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(glyph, ax, cy - 2);
        c.restore();
        if (on) arrows.push({ id, x: ax, y: cy, r: 28 * B });
      }
      // page dots so kids know there's more
      const dotY = y0 + 10;
      for (let i = 0; i < pages; i++) {
        c.fillStyle = i === page ? C.woodDark : 'rgba(67,52,43,0.25)';
        circle(c, viewW / 2 + (i - (pages - 1) / 2) * 14, dotY, i === page ? 4 : 3); c.fill();
      }
    }
    const box = Math.min(68 * Math.min(B, 1.45), wellW - 6, TRAY_H - 8);
    const total = view.length * wellW;
    let x = viewW / 2 - total / 2;
    c.font = '700 12px ui-rounded, system-ui, sans-serif';
    for (const item of view) {
      const cx = x + wellW / 2, cy = y0 + TRAY_H / 2 + 4;
      c.fillStyle = C.paper; rr(c, cx - box / 2, cy - box / 2, box, box, 14); c.fill();
      c.fillStyle = 'rgba(67,52,43,0.06)'; rr(c, cx - box / 2, cy - box / 2, box, 8, 6); c.fill();
      c.strokeStyle = 'rgba(67,52,43,0.15)'; c.lineWidth = 1.5; rr(c, cx - box / 2, cy - box / 2, box, box, 14); c.stroke();
      const defs = window.LoryCore.PART_DEFS[item.type];
      const dim = Math.max(defs.w || defs.r * 2, defs.h || defs.r * 2);
      const sc = Math.min(0.62 * B, (box - 16) / dim);
      c.save();
      c.translate(cx, cy);
      c.scale(sc, sc);
      if (item.count === 0) c.globalAlpha = 0.22;
      const d = { type: item.type, w: defs.w, h: defs.h, r: defs.r, dir: item.dir || (defs.dir && defs.dir[0]), icon: true };
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
    return { wells, arrows, pages, page };
  }

  // speech bubble. opts.fade (0..1) dissolves it as the say-timer runs out;
  // opts.close draws a toy ✕ on the top-right corner and returns its
  // hit-region (same coordinate space the bubble was drawn in).
  function drawBubble(c, x, y, text, o, opts) {
    opts = opts || {};
    const B = opts.boost || 1;
    c.save();
    if (opts.fade != null) c.globalAlpha = clamp(opts.fade, 0, 1);
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
    let closeBtn = null;
    if (opts.close) { // toy button, riding the corner (same look as ✕ delete)
      const r = 12 * Math.min(B, 1.4), cxb = bx + bw - 4, cyb = by + 4;
      c.fillStyle = '#B93A28'; circle(c, cxb, cyb + 2, r); c.fill();
      c.fillStyle = C.poppy; circle(c, cxb, cyb, r); c.fill();
      c.strokeStyle = C.paper; c.lineWidth = 3; c.lineCap = 'round';
      const k = r * 0.4;
      c.beginPath(); c.moveTo(cxb - k, cyb - k); c.lineTo(cxb + k, cyb + k);
      c.moveTo(cxb + k, cyb - k); c.lineTo(cxb - k, cyb + k); c.stroke();
      // generous tap target (little fingers), independent of the visual size
      closeBtn = { x: cxb, y: cyb, r: Math.max(22 * B, r + 8) };
    }
    c.restore();
    return closeBtn;
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
    ctx.clearRect(0, 0, viewW, BOARD_H + TRAY_H);

    // camera: everything on the BOARD is drawn under this transform; the
    // tray (after restore) stays fixed. Pure view — physics is untouched.
    // ox centers the 1280px board inside a possibly wider full-bleed canvas.
    const cam = frame.cam || { z: 1, x: 0, y: 0 };
    const ox = boardOX();
    ctx.save();
    ctx.translate(ox + cam.x, cam.y);
    ctx.scale(cam.z, cam.z);
    ctx.drawImage(bgCache, -ox, 0, viewW, BOARD_H + TRAY_H);

    const o = { t, running };

    // Lory (behind parts — her bubble is drawn LAST, on top of everything)
    if (lory) {
      ctx.save();
      ctx.translate(lory.x - 50, lory.y - 96);
      drawLory(ctx, lory.pose, t);
      ctx.restore();
    }

    drawWindZones(ctx, sim, o, !running);
    drawWires(ctx, sim, o);
    drawPullRopes(ctx, sim);
    stepMachineFx(sim, dt, running);
    drawTrails(ctx, sim);

    // parts: statics first, dynamics on top, sensors (sparkles) last
    const order = { static: 0, dynamic: 1, sensor: 2 };
    const list = sim.parts.slice().sort((a, b) => {
      const ka = a.bodies[0].isSensor ? 2 : a.bodies[0].isStatic ? 0 : 1;
      const kb = b.bodies[0].isSensor ? 2 : b.bodies[0].isStatic ? 0 : 1;
      return ka - kb;
    });
    for (const p of list) drawPart(ctx, p, o, sim);

    // laser/lens beams ride ABOVE the machines (they can bend through
    // mirrors now — the world-space path comes from core's castBeam)
    for (const p of list) {
      const ty = p.spec.type;
      if (ty !== 'laser' && ty !== 'lens') continue;
      const mm = p.bodies[0].plugin.lab;
      const bz = ty === 'laser' ? mm.laz : mm.lens;
      if (bz.firing > 0 && bz.beamPath && bz.beamPath.length > 1) drawBeamPath(ctx, bz.beamPath, o.t);
    }

    // hint ghosts
    if (hints) for (const h of hints) drawGhost(ctx, h, o, { style: 'hint' });

    // selection
    let selButtons = null;
    if (selection) selButtons = drawSelection(ctx, selection, o, frame.uiBoost, frame.sandbox);

    // drag ghost
    if (dragGhost) drawGhost(ctx, dragGhost, o, { invalid: dragGhost.invalid, lift: true });

    drawParticles(ctx);

    // Lory's message rides on top of EVERYTHING on the board — machines must
    // never cover what the bird is saying. ✕ dismisses it early; the
    // say-timer dissolves it (fade over the last 0.4s).
    let bubbleClose = null;
    if (lory && lory.say) {
      const fade = lory.sayTimer != null && lory.sayTimer < 0.4 ? lory.sayTimer / 0.4 : 1;
      bubbleClose = drawBubble(ctx, lory.x + 40, lory.y - 100, lory.say, o,
        { boost: frame.uiBoost, close: true, fade });
    }

    ctx.restore(); // end camera — tray below is fixed to the screen

    // tray
    let wells = null;
    let trayOut = null;
    if (tray) {
      trayOut = drawTray(ctx, tray, o, dragGhost && dragGhost.type, frame.uiBoost, frame.trayPage);
      wells = trayOut.wells;
    }

    return { selButtons, wells, bubbleClose, trayArrows: trayOut ? trayOut.arrows : [], trayPages: trayOut ? trayOut.pages : 1, trayPage: trayOut ? trayOut.page : 0 };
  }

  function init(canvas) {
    cv = canvas;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx = cv.getContext('2d');
    setView(viewW, true);
  }

  // Resize the canvas for a full-bleed room wider than the board (phones in
  // landscape). Repaints the background cache; cheap and only on layout change.
  function setView(w, force) {
    w = Math.round(w);
    if (!force && w === viewW && bgCache) return;
    viewW = w;
    cv.width = viewW * dpr;
    cv.height = (BOARD_H + TRAY_H) * dpr;
    cv.style.width = viewW + 'px';
    cv.style.height = (BOARD_H + TRAY_H) + 'px';
    bgCache = paintBackground();
  }

  window.LoryRender = {
    init, draw, fx, handleEvents, drawLory, drawBubble, C, setView,
    get viewW() { return viewW; },
    BOARD_W, BOARD_H, TRAY_H, FLOOR_Y,
    setJuice(b) { juicy = !!b; if (!juicy) for (const a of anim.values()) a.trail = []; },
    juice() { return juicy; },
    resetFx() { particles = []; squash.clear(); },
  };
})();

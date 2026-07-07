/* Lory's Lab — synthesized audio engine (Web Audio, zero assets).
 * Implements design/audio-spec.md: §1 SFX recipes, §2 music box, §3 graph.
 * Plain script, no deps: defines window.LoryAudio.
 */
(function () {
  'use strict';

  var ctx = null, sfxBus = null, musicBus = null, noiseBuf = null;
  var sfxOn = true, musicOn = true;
  var voiceCount = 0, lastAt = {}, dominoFlip = false, loops = {};
  var MUSIC_LEVEL = 0.126;
  var MIN_GAP = { wood: 0.03, dominoTick: 0.03, marble: 0.025 }; // per-name rate limits (s)
  var LOW_PRI = { dominoTick: true, marble: true };              // dropped first at voice cap

  function noop() {}
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  // ---- context / graph (spec §3): master 0.9 -> compressor -> destination ----
  function init() {
    var AC = typeof AudioContext !== 'undefined' ? AudioContext
      : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
    if (!AC) return false;
    ctx = new AC();
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 20; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    var master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 1.0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = MUSIC_LEVEL; musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); // shared 1 s white noise
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () {
        if (!ctx) return;
        var p = document.hidden ? ctx.suspend() : ctx.resume();
        if (p && p.catch) p.catch(noop);
      });
    }
    return true;
  }
  function unlock() { // call on first user gesture; safe to call repeatedly
    if (!ctx && !init()) return;
    if (ctx.state === 'suspended') { try { var p = ctx.resume(); if (p && p.catch) p.catch(noop); } catch (e) {} }
  }

  // ---- node/envelope helpers --------------------------------------------------
  function osc(type, f, t) { var o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); return o; }
  function noise(loop) { var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = !!loop; return s; }
  function filt(type, f, q) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
  function gainNode(v) { var g = ctx.createGain(); g.gain.value = v; return g; }
  function chain() { for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); }
  function sweep(p, t0, v0, t1, v1, expo) { // anchor at v0, ramp (exp/linear) to v1
    p.setValueAtTime(v0, t0);
    p[expo ? 'exponentialRampToValueAtTime' : 'linearRampToValueAtTime'](v1, t1);
  }
  function env(p, t, a, peak, d) { // linear attack, exponential decay to 0.001 (never 0)
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(Math.max(peak, 0.0011), t + a);
    p.exponentialRampToValueAtTime(0.001, t + a + d);
  }
  function holdEnv(p, t, a, lvl, holdEnd, rel) { // attack, sustain, exp release
    p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(lvl, t + a);
    p.setValueAtTime(lvl, holdEnd); p.exponentialRampToValueAtTime(0.001, holdEnd + rel);
  }
  function lfoTo(t, type, f, depth, target, stopAt) { // osc -> depth gain -> AudioParam
    var o = osc(type, f, t), g = gainNode(depth);
    chain(o, g, target); o.start(t); if (stopAt) o.stop(stopAt);
    return [o, g];
  }
  function fadeOut(p, t, dur) {
    p.cancelScheduledValues(t);
    p.setValueAtTime(Math.max(p.value, 0.0011), t);
    p.exponentialRampToValueAtTime(0.001, t + dur);
  }
  function shot(main, stopAt, nodes) { // one counted voice; onended frees the patch
    voiceCount++;
    main.onended = function () {
      voiceCount = Math.max(0, voiceCount - 1);
      for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) {} }
    };
    main.stop(stopAt);
  }
  function tone(t, type, f, dur, peak, a, det) { // osc -> env gain -> sfxBus
    var o = osc(type, f, t); if (det) o.detune.value = det;
    var g = gainNode(0); env(g.gain, t, a, peak, dur);
    chain(o, g, sfxBus); o.start(t);
    return { o: o, nodes: [o, g] };
  }
  function noiseHit(t, dur, type, f, q, peak) { // self-stopping filtered noise burst
    var n = noise(false), fl = filt(type, f, q), g = gainNode(0);
    env(g.gain, t, 0.0005, peak, dur);
    chain(n, fl, g, sfxBus); n.start(t); n.stop(t + dur + 0.02);
    return [n, fl, g];
  }

  // ---- SFX recipes (spec §1); every trigger is detuned so no two are identical --
  var RECIPES = {
    wood: function (t, v) { // 1.1 sine body + 2.7x overtone + contact click
      var f0 = (160 + 170 * v) * rnd(0.97, 1.03), peak = 0.25 + 0.45 * v;
      var body = tone(t, 'sine', f0, 0.08, peak, 0.001, rnd(-35, 35));
      body.o.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.06);
      var over = tone(t, 'sine', f0 * 2.7, 0.04, peak * 0.25, 0.001); over.o.stop(t + 0.06);
      shot(body.o, t + 0.11, body.nodes.concat(over.nodes, noiseHit(t, 0.015, 'bandpass', 1200, 1, 0.12 * v)));
    },
    marble: function (t, v) { // 1.2 2.8 kHz ping + bright clack
      var ping = tone(t, 'sine', 2800, 0.045, 0.3 * v, 0.0005, rnd(-25, 25));
      shot(ping.o, t + 0.06, ping.nodes.concat(noiseHit(t, 0.04, 'bandpass', 4500 * rnd(0.9, 1.1), 8, 0.35 * v)));
    },
    rubber: function (t, v) { // 1.3 boing: triangle bend down + decaying 18 Hz wobble
      var f0 = 220 * (0.8 + 0.4 * v);
      var o = osc('triangle', f0, t); o.detune.value = rnd(-25, 25);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.2);
      var lp = filt('lowpass', 900, 0.7), g = gainNode(0); env(g.gain, t, 0.003, 0.2 + 0.4 * v, 0.25);
      var wob = lfoTo(t, 'sine', 18, 15, o.frequency, t + 0.25);
      sweep(wob[1].gain, t, 15, t + 0.2, 0.001, true); // wobble depth decays to 0
      chain(o, lp, g, sfxBus); o.start(t);
      shot(o, t + 0.28, [o, lp, g].concat(wob));
    },
    tramp: function (t, v) { // 1.4 BOING: saw pitch bend up + quacky lowpass sweep
      var dur = 0.22 + 0.12 * v, dec = 0.3 + 0.1 * v;
      var o = osc('sawtooth', 140 + 40 * v, t); o.detune.value = rnd(-20, 20);
      o.frequency.exponentialRampToValueAtTime(320 + 220 * v, t + dur);
      var lp = filt('lowpass', 500, 2), g = gainNode(0);
      sweep(lp.frequency, t, 500, t + dur, 2500, true); env(g.gain, t, 0.005, 0.3 + 0.4 * v, dec);
      chain(o, lp, g, sfxBus); o.start(t);
      shot(o, t + dec + 0.03, [o, lp, g]);
    },
    dominoTick: function (t) { // 1.5 alternating 700/560 Hz tick, fixed gain
      dominoFlip = !dominoFlip;
      var b = tone(t, 'sine', dominoFlip ? 700 : 560, 0.03, 0.2, 0.0005, rnd(-40, 40));
      shot(b.o, t + 0.04, b.nodes.concat(noiseHit(t, 0.02, 'bandpass', 2000, 6, 0.15)));
    },
    bumper: function (t, v) { // 1.8 root + fifth ping, 5% spring-settle bend
      var fa = 880 * (1 + 0.15 * v), g0 = 0.35 + 0.3 * v, det = rnd(-15, 15);
      var a = tone(t, 'sine', fa, 0.2, g0, 0.001, det);
      a.o.frequency.exponentialRampToValueAtTime(fa * 0.95, t + 0.03);
      var b = tone(t, 'sine', fa * 1.5, 0.12, g0 * 0.5, 0.001, det);
      b.o.frequency.exponentialRampToValueAtTime(fa * 1.5 * 0.95, t + 0.03); b.o.stop(t + 0.14);
      shot(a.o, t + 0.23, a.nodes.concat(b.nodes, noiseHit(t, 0.008, 'highpass', 2000, null, 0.2)));
    },
    pop: function (t) { // 1.10 bang + swept air flap + 120 Hz thump
      var n1 = noise(false), hp = filt('highpass', 200), g1 = gainNode(0);
      sweep(g1.gain, t, 0.9, t + 0.07, 0.001, true); // A=0 bang
      chain(n1, hp, g1, sfxBus); n1.start(t); n1.stop(t + 0.08);
      var n2 = noise(false), bp = filt('bandpass', 3000, 2), g2 = gainNode(0);
      sweep(bp.frequency, t, 3000, t + 0.1, 500, true); env(g2.gain, t, 0.001, 0.3, 0.1);
      chain(n2, bp, g2, sfxBus); n2.start(t);
      var th = tone(t, 'sine', 120, 0.06, 0.4, 0.001); th.o.stop(t + 0.08);
      shot(n2, t + 0.12, [n1, hp, g1, n2, bp, g2].concat(th.nodes));
    },
    catch: function (t) { // 1.11 gulp dip/rise + delayed random C-major chime pair
      var o = osc('sine', 220, t); o.detune.value = rnd(-30, 30);
      o.frequency.linearRampToValueAtTime(150, t + 0.04);
      o.frequency.exponentialRampToValueAtTime(600, t + 0.14);
      var lp = filt('lowpass', 1200), g = gainNode(0); env(g.gain, t, 0.002, 0.35, 0.16);
      chain(o, lp, g, sfxBus); o.start(t); o.stop(t + 0.18);
      var tones = [1046.5, 1318.5, 1568, 2093], tc = t + 0.12;
      var i1 = (Math.random() * 4) | 0, i2 = (i1 + 1 + ((Math.random() * 3) | 0)) % 4; // two distinct
      var c1 = tone(tc, 'sine', tones[i1], 0.3, 0.12, 0.001); c1.o.stop(tc + 0.32);
      var c2 = tone(tc, 'sine', tones[i2], 0.3, 0.12, 0.001);
      shot(c2.o, tc + 0.33, [o, lp, g].concat(c1.nodes, c2.nodes));
    },
    bell: function (t) { // 1.12 FM strike; half-depth music duck (spec §2)
      var det = rnd(-10, 10), car = osc('sine', 880, t), mod = osc('sine', 1232, t);
      car.detune.value = det; mod.detune.value = det;
      var idx = gainNode(0); sweep(idx.gain, t, 600, t + 0.8, 1, true); // FM index decay
      chain(mod, idx, car.frequency);
      var g = gainNode(0); env(g.gain, t, 0.002, 0.4, 1.2);
      chain(car, g, sfxBus);
      var strike = tone(t, 'sine', 1760, 0.15, 0.15, 0.001, det); strike.o.stop(t + 0.17);
      car.start(t); mod.start(t); mod.stop(t + 1.22);
      shot(car, t + 1.25, [car, mod, idx, g].concat(strike.nodes));
      duck(0.063, t);
    },
    sparkle: function (t, v, opts) { // 1.13 C6/E6/G6 gliss x tier {1, 1.26, 1.5}
      var mult = [1, 1.26, 1.5][clamp((opts.tier || 0) | 0, 0, 2)];
      var notes = [1046.5, 1318.5, 1568], all = [], last = null;
      for (var i = 0; i < 3; i++) {
        var nt = tone(t + i * 0.045, 'sine', notes[i] * mult, 0.25, 0.22, 0.002, rnd(-8, 8));
        all = all.concat(nt.nodes);
        if (i < 2) nt.o.stop(t + i * 0.045 + 0.27); else last = nt.o;
      }
      shot(last, t + 0.37, all.concat(noiseHit(t, 0.08, 'highpass', 6000, null, 0.08)));
    },
    pickup: function (t) { uiThock(t, 330, 392); }, // 1.14 up-glide = grabbed
    place: function (t) { uiThock(t, 392, 330); },  // 1.14 down-glide = placed
    rotate: function (t) { // 1.15 tiny click
      var r = rnd(0.95, 1.05), b = tone(t, 'sine', 1200 * r, 0.025, 0.12, 0.0005);
      shot(b.o, t + 0.03, b.nodes.concat(noiseHit(t, 0.003, 'bandpass', 3000 * r, 3, 0.18)));
    },
    invalid: function (t) { // 1.16 gentle "uh-uh": two soft notes, wobble on 2nd
      var n1 = wobbleNote(t, 233, false); n1.main.stop(t + 0.13);
      var n2 = wobbleNote(t + 0.16, 208, true);
      shot(n2.main, t + 0.29, n1.nodes.concat(n2.nodes));
    },
    play: function (t) { // 1.17 slide whistle + breath noise tracking 2x pitch
      var o = osc('sine', 600, t), lp = filt('lowpass', 3000), g = gainNode(0);
      o.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
      holdEnv(g.gain, t, 0.01, 0.3, t + 0.45, 0.12);
      chain(o, lp, g, sfxBus); o.start(t);
      var vib = lfoTo(t + 0.3, 'sine', 6, 25, o.frequency, t + 0.45); // vibrato on the hold
      var n = noise(false), bp = filt('bandpass', 1200, 4), gn = gainNode(0);
      sweep(bp.frequency, t, 1200, t + 0.3, 2400, true); holdEnv(gn.gain, t, 0.01, 0.05, t + 0.45, 0.12);
      chain(n, bp, gn, sfxBus); n.start(t); n.stop(t + 0.58);
      shot(o, t + 0.6, [o, lp, g, n, bp, gn].concat(vib));
    },
    win: function (t) { // 1.18 fanfare ~2 s; full music duck (spec §2)
      duck(0.032, t);
      var all = [], main = null, mainEnd = 0, i, r;
      var arp = [[0, 523.25], [0.15, 659.25], [0.3, 783.99], [0.45, 1046.5]], chord = [1046.5, 1318.5, 1568];
      for (i = 0; i < 4; i++) { r = fanfareNote(t + arp[i][0], arp[i][1], 0); r.main.stop(r.end); all = all.concat(r.nodes); }
      for (i = 0; i < 3; i++) { // held chord, released to end at ~2.0 s
        r = fanfareNote(t + 0.7, chord[i], t + 1.1);
        if (i < 2) r.main.stop(r.end); else { main = r.main; mainEnd = r.end; }
        all = all.concat(r.nodes);
      }
      var CMAJ = [2093, 2349.3, 2637, 2793.8, 3136, 3520, 3951.1, 4186, 4698.6];
      for (var tt = t + 0.5; tt < t + 1.8; tt += rnd(0.08, 0.14)) { // confetti pings
        var f = rnd(2000, 5000), best = CMAJ[0];
        for (i = 1; i < CMAJ.length; i++) if (Math.abs(CMAJ[i] - f) < Math.abs(best - f)) best = CMAJ[i];
        var p = tone(tt, 'sine', best, 0.15, 0.08, 0.001); p.o.stop(tt + 0.17);
        all = all.concat(p.nodes);
      }
      var n = noise(true), hp = filt('highpass', 5000), gn = gainNode(0); // shimmer swell
      holdEnv(gn.gain, t + 0.5, 0.3, 0.06, t + 0.8, 0.8);
      chain(n, hp, gn, sfxBus); n.start(t + 0.5); n.stop(t + 1.65);
      shot(main, mainEnd, all.concat([n, hp, gn]));
    },
    lose: function (t) { // 1.19 curious rising "hmm?" + soft "try again" chime
      var o = osc('triangle', 262, t), lp = filt('lowpass', 700), g = gainNode(0);
      sweep(o.frequency, t + 0.25, 262, t + 0.45, 294, false); // glide UP: a question
      env(g.gain, t, 0.03, 0.2, 0.45);
      chain(o, lp, g, sfxBus); o.start(t); o.stop(t + 0.5);
      var vib = lfoTo(t, 'sine', 5, 6, o.frequency, t + 0.5);
      var c = tone(t + 0.5, 'sine', 784, 0.25, 0.08, 0.002);
      shot(c.o, t + 0.78, [o, lp, g].concat(vib, c.nodes));
    },
    button: function (t) { // 1.20 tap
      var b = tone(t, 'sine', 600, 0.04, 0.25, 0.001, rnd(-20, 20));
      b.o.frequency.linearRampToValueAtTime(400, t + 0.03);
      shot(b.o, t + 0.05, b.nodes);
    },
    levelpop: function (t) { // 1.21 "bloop up" + tiny bright noise
      var r = rnd(0.95, 1.05), b = tone(t, 'sine', 300 * r, 0.08, 0.3, 0.002);
      b.o.frequency.exponentialRampToValueAtTime(900 * r, t + 0.06);
      shot(b.o, t + 0.09, b.nodes.concat(noiseHit(t, 0.005, 'highpass', 3000, null, 0.08)));
    },
    snip: function (t) { // scissors: two quick metallic clicks
      for (var i = 0; i < 2; i++) {
        var tt = t + i * 0.07;
        var b = tone(tt, 'sine', 2400 + i * 500, 0.035, 0.22, 0.001, rnd(-25, 25));
        shot(b.o, tt + 0.05, b.nodes.concat(noiseHit(tt, 0.012, 'bandpass', 5000, 7, 0.18)));
      }
    },
    thwack: function (t) { // spring fist: deep punch + spring twang
      var body = tone(t, 'sine', 130, 0.09, 0.5, 0.001, rnd(-20, 20));
      body.o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
      var tw = tone(t + 0.02, 'triangle', 620, 0.18, 0.18, 0.002, rnd(-30, 30));
      tw.o.frequency.exponentialRampToValueAtTime(280, t + 0.2);
      shot(body.o, t + 0.12, body.nodes.concat(noiseHit(t, 0.02, 'lowpass', 900, null, 0.4)));
      shot(tw.o, t + 0.22, tw.nodes);
    },
    switchOn: function (t) { // pressure plate down: firm click + rising blip
      var b = tone(t, 'sine', 500, 0.05, 0.3, 0.001);
      b.o.frequency.linearRampToValueAtTime(760, t + 0.04);
      shot(b.o, t + 0.06, b.nodes.concat(noiseHit(t, 0.008, 'bandpass', 2500, 4, 0.15)));
    },
    switchOff: function (t) { // plate up: softer falling blip
      var b = tone(t, 'sine', 640, 0.05, 0.2, 0.001);
      b.o.frequency.linearRampToValueAtTime(420, t + 0.045);
      shot(b.o, t + 0.06, b.nodes);
    },
    igniteFizz: function (t) { // fuse/candle catches: short sizzle + spark ping
      var n = noiseHit(t, 0.16, 'bandpass', 4200, 2.5, 0.22);
      var b = tone(t + 0.02, 'sine', 1800, 0.04, 0.12, 0.001, rnd(-40, 40));
      shot(b.o, t + 0.07, b.nodes.concat(n));
    },
    extinguishHiss: function (t) { // water meets flame: steam psshh
      var n = noiseHit(t, 0.3, 'bandpass', 2200, 1.2, 0.3);
      var n2 = noiseHit(t + 0.05, 0.22, 'highpass', 4500, null, 0.12);
      void n; void n2;
    },
    clank: function (t, v) { // magnet metal CLANK (hit with impact > 3)
      var body = tone(t, 'sine', 1900, 0.06, 0.35 * v, 0.001, rnd(-15, 15));
      shot(body.o, t + 0.09, body.nodes.concat(noiseHit(t, 0.025, 'bandpass', 3500, 6, 0.3 * v)));
    },
    magnetClunk: function (t) { // magnet_on engage
      var body = tone(t, 'square', 90, 0.08, 0.4, 0.001, rnd(-20, 20));
      shot(body.o, t + 0.1, body.nodes.concat(noiseHit(t, 0.03, 'lowpass', 800, null, 0.5)));
    },
    magnetWind: function (t) { // magnet_off wind-down: saw 180 -> 60 Hz
      var o = osc('sawtooth', 180, t), lp = filt('lowpass', 400), g = gainNode(0);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.3); env(g.gain, t, 0.005, 0.15, 0.3);
      chain(o, lp, g, sfxBus); o.start(t);
      shot(o, t + 0.33, [o, lp, g]);
    }
  };

  function uiThock(t, f1, f2) { // 1.14 gliding sine body + noise thock
    var body = tone(t, 'sine', f1, 0.05, 0.3, 0.001, rnd(-15, 15));
    body.o.frequency.linearRampToValueAtTime(f2, t + 0.06);
    shot(body.o, t + 0.08, body.nodes.concat(noiseHit(t, 0.005, 'lowpass', 1000, null, 0.2)));
  }
  function wobbleNote(t, f, wobble) { // 1.16 soft triangle note with 3% pitch sag
    var o = osc('triangle', f, t), lp = filt('lowpass', 800), g = gainNode(0);
    o.frequency.linearRampToValueAtTime(f * 0.97, t + 0.12); env(g.gain, t, 0.01, 0.18, 0.11);
    chain(o, lp, g, sfxBus); o.start(t);
    var nodes = [o, lp, g];
    if (wobble) nodes = nodes.concat(lfoTo(t, 'sine', 8, 10, o.frequency, t + 0.13));
    return { main: o, nodes: nodes };
  }
  function fanfareNote(t, f, holdUntil) { // 1.18 triangle + octave sine at 0.4x
    var o1 = osc('triangle', f, t), o2 = osc('sine', f * 2, t);
    var g2 = gainNode(0.4), lp = filt('lowpass', 2500), g = gainNode(0), end;
    if (holdUntil) { // attack, settle to sustain 0.25, hold, 900 ms release
      sweep(g.gain, t, 0.0001, t + 0.005, 0.35, false);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.2);
      g.gain.setValueAtTime(0.25, holdUntil);
      g.gain.exponentialRampToValueAtTime(0.001, holdUntil + 0.9);
      end = holdUntil + 0.92;
    } else { env(g.gain, t, 0.005, 0.35, 0.5); end = t + 0.53; }
    chain(o1, lp); chain(o2, g2, lp, g, sfxBus);
    o1.start(t); o2.start(t); o2.stop(end);
    return { main: o1, end: end, nodes: [o1, o2, g2, lp, g] };
  }

  // ---- sfx dispatch: rate limits + voice cap 16 (low-priority skipped first) ----
  function sfx(name, opts) {
    if (!ctx || !sfxOn) return;
    var fn = RECIPES[name];
    if (!fn) return;
    var t = ctx.currentTime, gap = MIN_GAP[name];
    if (gap && t - (lastAt[name] || -1) < gap) return;
    if (voiceCount >= 16 && LOW_PRI[name]) return;
    if (voiceCount >= 24) return; // hard ceiling for everything else
    lastAt[name] = t;
    fn(t, clamp(opts && opts.strength != null ? opts.strength : 0.7, 0, 1), opts || {});
  }

  // ---- loops (1.6 fan, 1.7 conveyor, magnet hum, 1.9 balloon), refcounted ------
  function endLoop(level, fade, sources, nodes) { // fade out, stop sources, free all
    var t = ctx.currentTime;
    fadeOut(level.gain, t, fade);
    sources[0].onended = function () {
      for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) {} }
    };
    for (var i = 0; i < sources.length; i++) { try { sources[i].stop(t + fade + 0.05); } catch (e) {} }
    return t;
  }
  function makeFan() { // 1.6 swept lowpass noise, 0.9 Hz cutoff LFO, 5.5 Hz blade whup
    var t = ctx.currentTime;
    var src = noise(true), lp = filt('lowpass', 200, 0.5), amp = gainNode(0.85), level = gainNode(0);
    sweep(lp.frequency, t, 200, t + 0.4, 650, false);   // spin-up
    sweep(level.gain, t, 0.0001, t + 0.4, 0.18, false);
    var ln = lfoTo(t, 'sine', 0.9, 150, lp.frequency, 0)  // cutoff +/-150 Hz
      .concat(lfoTo(t, 'sine', 5.5, 0.15, amp.gain, 0));  // whup: 0.7..1.0 of level
    chain(src, lp, amp, level, sfxBus); src.start(t);
    var nodes = [src, lp, amp, level].concat(ln);
    return { stop: function () { // 600 ms spin-down, cutoff back to 200
      var t2 = endLoop(level, 0.6, [src, ln[0], ln[2]], nodes);
      lp.frequency.cancelScheduledValues(t2);
      sweep(lp.frequency, t2, lp.frequency.value, t2 + 0.6, 200, false);
    } };
  }
  function makeConveyor() { // 1.7 55/55.6 Hz motor throb + belt ticks gated 0..0.05
    var t = ctx.currentTime;
    var o1 = osc('sawtooth', 55, t), o2 = osc('sawtooth', 55.6, t);
    var hlp = filt('lowpass', 300), hg = gainNode(0.10);
    var n = noise(true), bp = filt('bandpass', 900, 4), gate = gainNode(0.025);
    var gl = lfoTo(t, 'square', 3.2, 0.025, gate.gain, 0);
    var mix = gainNode(1), level = gainNode(0);
    chain(o1, hlp); chain(o2, hlp, hg, mix); chain(n, bp, gate, mix, level, sfxBus);
    sweep(level.gain, t, 0.0001, t + 0.2, 1, false); // 200 ms ramp in
    o1.start(t); o2.start(t); n.start(t);
    var nodes = [o1, o2, hlp, hg, n, bp, gate, mix, level].concat(gl);
    return { // n conveyors -> one instance at level 0.10*sqrt(n), capped at 1 overall
      setCount: function (c) { level.gain.setTargetAtTime(Math.min(10, Math.sqrt(c)), ctx.currentTime, 0.05); },
      stop: function () { endLoop(level, 0.2, [o1, o2, n, gl[0]], nodes); }
    };
  }
  function makeMagnet() { // hum: 70/70.7 Hz saws -> lowpass 250, 4 Hz AM depth 25%
    var t = ctx.currentTime;
    var o1 = osc('sawtooth', 70, t), o2 = osc('sawtooth', 70.7, t);
    var lp = filt('lowpass', 250), amp = gainNode(0.875), level = gainNode(0);
    var am = lfoTo(t, 'sine', 4, 0.125, amp.gain, 0);
    sweep(level.gain, t, 0.0001, t + 0.15, 0.12, false); // 150 ms ramp in
    chain(o1, lp); chain(o2, lp, amp, level, sfxBus);
    o1.start(t); o2.start(t);
    var nodes = [o1, o2, lp, amp, level].concat(am);
    return { stop: function () { endLoop(level, 0.15, [o1, o2, am[0]], nodes); } };
  }
  function makeBalloon() { // 1.9 squeak: pitch jitter + stutter bursts, level 0.06
    var t = ctx.currentTime;
    var o = osc('sawtooth', 300, t), bp = filt('bandpass', 600, 5);
    var stut = gainNode(0.5), level = gainNode(0);
    var ls = lfoTo(t, 'sine', 8, 20, o.detune, 0)                    // +/-20 cent jitter
      .concat(lfoTo(t, 'square', rnd(2.5, 3.5), 0.5, stut.gain, 0)); // bursts 0..1
    sweep(level.gain, t, 0.0001, t + 0.08, 0.06, false);
    chain(o, bp, stut, level, sfxBus); o.start(t);
    var nodes = [o, bp, stut, level].concat(ls);
    return { osc: o, bp: bp, stop: function () { endLoop(level, 0.08, [o, ls[0], ls[2]], nodes); } };
  }

  function makeWater() { // hydrant jet: filtered noise splash with slow burble LFO
    var t = ctx.currentTime;
    var n = noise(true), bp = filt('bandpass', 900, 0.8), lp = filt('lowpass', 2600);
    var amp = gainNode(0.85), level = gainNode(0);
    var burble = lfoTo(t, 'sine', 2.3, 0.15, amp.gain, 0)
      .concat(lfoTo(t, 'sine', 0.7, 300, bp.frequency, 0));
    sweep(level.gain, t, 0.0001, t + 0.2, 0.14, false);
    chain(n, bp, lp, amp, level, sfxBus); n.start(t);
    var nodes = [n, bp, lp, amp, level].concat(burble);
    return {
      setCount: function (c) { level.gain.setTargetAtTime(0.14 * Math.min(2, Math.sqrt(c)), ctx.currentTime, 0.05); },
      stop: function () { endLoop(level, 0.25, [n, burble[0], burble[2]], nodes); },
    };
  }

  var LOOP_MAKERS = { fan: makeFan, conveyor: makeConveyor, magnet: makeMagnet, balloon: makeBalloon, water: makeWater };
  function startLoop(name) {
    if (!ctx || !sfxOn || !LOOP_MAKERS[name]) return;
    var L = loops[name];
    if (L) { L.count++; if (L.setCount) L.setCount(L.count); return; }
    L = LOOP_MAKERS[name](); L.count = 1; loops[name] = L;
  }
  function stopLoop(name) {
    var L = loops[name];
    if (!L) return;
    L.count--;
    if (L.count > 0) { if (L.setCount) L.setCount(L.count); return; }
    delete loops[name];
    L.stop();
  }
  function stopAllLoops() {
    for (var k in loops) { try { loops[k].stop(); } catch (e) {} delete loops[k]; }
  }
  function setBalloonInflate(x) { // spec 1.9: tau = 50 ms tracking, filter at 2f
    var L = loops.balloon;
    if (!ctx || !L) return;
    var f = 300 + 600 * clamp(x, 0, 1), t = ctx.currentTime;
    L.osc.frequency.setTargetAtTime(f, t, 0.05);
    L.bp.frequency.setTargetAtTime(2 * f, t, 0.05);
  }

  // ---- music box (spec §2): C major, 76 bpm, 32 slots = 8 bars = 25.26 s -------
  var BEAT = 60 / 76;
  var MELODY = [
    523.25, 659.25, 783.99, 659.25,  440, 523.25, 659.25, 523.25,
    349.23, 440, 523.25, 440,        392, 493.88, 587.33, 493.88,
    523.25, 659.25, 783.99, 659.25,  440, 523.25, 659.25, 523.25,
    349.23, 440, 523.25, 440,        392, 493.88, 587.33, 783.99 // bar 8 turnaround
  ];
  var BASS = [130.8, 110, 87.3, 98, 130.8, 110, 87.3, 98];
  var mus = { timer: null, slot: 0, nextTime: 0, loopN: 0, voices: [], lp: null, bassLp: null };

  function duck(depth, t) { // §2 ducking: fast dip, restore starting at t + 2.2 s
    if (!musicBus) return;
    musicBus.gain.setTargetAtTime(depth, t, 0.05);
    musicBus.gain.setTargetAtTime(MUSIC_LEVEL, t + 2.2, 0.25);
  }
  function musicStart() {
    if (!ctx || !musicOn || mus.timer) return;
    if (!mus.lp) {
      mus.lp = filt('lowpass', 2200); mus.lp.connect(musicBus);
      mus.bassLp = filt('lowpass', 400); mus.bassLp.connect(musicBus);
    }
    mus.slot = 0; mus.loopN = 0; mus.nextTime = ctx.currentTime + 0.15;
    mus.timer = setInterval(musicTick, 200); // 200 ms lookahead scheduler
    musicTick();
  }
  function musicStop() {
    if (mus.timer) { clearInterval(mus.timer); mus.timer = null; }
    var vs = mus.voices.slice();
    for (var i = 0; i < vs.length; i++) killVoice(vs[i]);
  }
  function musicTick() {
    if (!ctx) return;
    var horizon = ctx.currentTime + 0.5;
    while (mus.nextTime < horizon) {
      scheduleSlot(mus.slot, mus.nextTime, mus.loopN);
      mus.slot++;
      if (mus.slot >= 32) { mus.slot = 0; mus.loopN++; } // wrap -> seamless loop
      mus.nextTime += BEAT;
    }
  }
  function scheduleSlot(slot, time, loopN) {
    var t = Math.max(ctx.currentTime, time + rnd(-0.012, 0.012)); // humanize timing
    var f = MELODY[slot], alt = loopN % 2 === 1;
    if (alt && slot === 7) f = 659.25; // every 2nd loop: bar 2 last note C5 -> E5
    melodyNote(t, f, rnd(0.85, 1.0));
    if (alt && slot === 14) melodyNote(t + 0.06, 1174.66, 0.3 * rnd(0.85, 1.0)); // D6 echo
    if (slot % 4 === 0) bassNote(time, BASS[slot >> 2], rnd(0.85, 1.0));
  }
  function regVoice(kind, end, g, srcs, nodes) { // track for stop/steal; self-frees
    var v = { kind: kind, end: end, g: g, srcs: srcs, nodes: nodes };
    srcs[0].onended = function () {
      var k = mus.voices.indexOf(v);
      if (k >= 0) mus.voices.splice(k, 1);
      for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) {} }
    };
    for (var i = 0; i < srcs.length; i++) srcs[i].stop(end);
    mus.voices.push(v);
  }
  function melodyNote(t, f, gmul) { // sine + triangle(0.5x); max 3 ringing, steal oldest
    var alive = [], mel = [], i;
    for (i = 0; i < mus.voices.length; i++) if (mus.voices[i].end > t) alive.push(mus.voices[i]);
    mus.voices = alive;
    for (i = 0; i < alive.length; i++) if (alive[i].kind === 'm') mel.push(alive[i]);
    while (mel.length >= 3) killVoice(mel.shift());
    var det = rnd(-4, 4), o1 = osc('sine', f, t), o2 = osc('triangle', f, t);
    o1.detune.value = det; o2.detune.value = det; // humanize pitch
    var g2 = gainNode(0.5), g = gainNode(0);
    env(g.gain, t, 0.002, 0.5 * gmul, 1.2); // music-box pluck, no sustain
    chain(o1, g); chain(o2, g2, g, mus.lp);
    o1.start(t); o2.start(t);
    regVoice('m', t + 1.22, g, [o1, o2], [o1, o2, g2, g]);
  }
  function bassNote(t, f, gmul) { // pure sine whole note, 0.5x melody level
    var o = osc('sine', f, t); o.detune.value = rnd(-4, 4);
    var g = gainNode(0); env(g.gain, t, 0.02, 0.25 * gmul, 2.5);
    chain(o, g, mus.bassLp); o.start(t);
    regVoice('b', t + 2.55, g, [o], [o, g]);
  }
  function killVoice(v) {
    v.end = 0;
    try {
      var t = ctx.currentTime;
      fadeOut(v.g.gain, t, 0.05);
      for (var i = 0; i < v.srcs.length; i++) v.srcs[i].stop(t + 0.06);
    } catch (e) {}
  }

  // ---- physics event fan-in ------------------------------------------------------
  function handleEvents(events) {
    if (!ctx || !sfxOn || !events) return;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e) continue;
      switch (e.type) {
        case 'hit': {
          var v = clamp((e.impact || 0) / 12, 0.15, 1), a = e.matA, b = e.matB;
          if ((a === 'magnet' || b === 'magnet') && (e.impact || 0) > 3) sfx('clank', { strength: v });
          else if (a === 'marble' || b === 'marble') sfx('marble', { strength: v });
          else if (a === 'domino' || b === 'domino') sfx('dominoTick', { strength: v });
          else if (a === 'rubber' || b === 'rubber') sfx('rubber', { strength: v });
          else sfx('wood', { strength: v }); // berry/wood/other
          break;
        }
        case 'boing': sfx('tramp', { strength: clamp((e.impact || 0) / 14, 0.3, 1) }); break;
        case 'bumper': sfx('bumper', { strength: clamp((e.impact || 0) / 12, 0.15, 1) }); break;
        case 'pop': sfx('pop'); break;
        case 'bell': sfx('bell'); break;
        case 'sparkle': sfx('sparkle', { tier: clamp(((e.n || 1) | 0) - 1, 0, 2) }); break;
        case 'win': sfx('win'); break;
        case 'magnet_on': sfx('magnetClunk'); startLoop('magnet'); break;
        case 'magnet_off': stopLoop('magnet'); sfx('magnetWind'); break;
        case 'snip': sfx('snip'); break;
        case 'thwack': sfx('thwack'); break;
        case 'switch_on': sfx('switchOn'); break;
        case 'switch_off': sfx('switchOff'); break;
        case 'ignite': sfx('igniteFizz'); break;
        case 'extinguish': sfx('extinguishHiss'); break;
      }
    }
  }

  // ---- public API -----------------------------------------------------------------
  var api = {
    unlock: unlock,
    sfx: sfx,
    setSfxEnabled: function (b) { sfxOn = !!b; if (!sfxOn) stopAllLoops(); },
    setMusicEnabled: function (b) { musicOn = !!b; if (musicOn) musicStart(); else musicStop(); },
    sfxEnabled: function () { return sfxOn; },
    musicEnabled: function () { return musicOn; },
    startLoop: startLoop,
    stopLoop: stopLoop,
    stopAllLoops: stopAllLoops,
    setBalloonInflate: setBalloonInflate,
    handleEvents: handleEvents,
    music: { start: musicStart, stop: musicStop }
  };
  window.LoryAudio = api;
})();

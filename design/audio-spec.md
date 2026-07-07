# Lory's Lab — Synthesized Audio Spec (Web Audio API, zero files)

All sounds are built at runtime from `OscillatorNode`, one shared 1-second white-noise `AudioBuffer`, `BiquadFilterNode`, and `GainNode` envelopes. Conventions used below:

- **Envelopes**: A/D/S/R in ms; attacks are `linearRampToValueAtTime`, decays/releases are `exponentialRampToValueAtTime` (to 0.001, then `setValueAtTime(0)`).
- **`v`** = impact strength 0..1 (clamped) passed in `opts.strength`, default 0.7.
- **`rnd(a,b)`** = uniform random per trigger. Every SFX gets `±rnd` detune so no two triggers are identical.
- **Gain values** are linear at the sfx bus (bus already sits under the master compressor).
- **Noise** = the shared white-noise buffer played via `AudioBufferSourceNode` (loop for pads, one-shot for hits).

---

## 1. SFX Recipes

### 1.1 Soft wood knock — *ball hits plank/shelf*
- **Body**: sine osc, `f0 = 160 + 170*v` Hz (160–330), pitch ramps exponentially to `0.5*f0` over 60 ms. Detune `rnd(-35,+35)` cents.
- **Woody overtone**: 2nd sine at `2.7*f0` (inharmonic), gain 0.25× body, decay 40 ms.
- **Contact click**: noise one-shot 15 ms → bandpass 1200 Hz, Q=1, gain `0.12*v`.
- **Env (body)**: A=1, D=80 exp, S=0, R=0. Total ≈ 100 ms. Peak gain `0.25 + 0.45*v`.
- **Anti-repeat**: rate-limit 30 ms/instance; `f0 *= rnd(0.97,1.03)`.

### 1.2 Marble clack
- **Ping**: sine 2800 Hz, decay 45 ms, gain `0.3*v`.
- **Clack**: noise 25 ms → bandpass `4500*rnd(0.9,1.1)` Hz, Q=8, gain `0.35*v`.
- **Env**: A=0.5, D=40 exp. Total 50 ms. Two clacks < 25 ms apart merge (skip second).

### 1.3 Beach-ball boing (bounce)
- **Osc**: triangle, `f0 = 220*(0.8 + 0.4*v)` Hz, pitch ramps to `0.7*f0` over 200 ms.
- **Wobble**: sine LFO 18 Hz → osc.frequency, depth starts ±15 Hz, decays to 0 over 200 ms (LFO gain envelope).
- **Filter**: lowpass 900 Hz, Q=0.7.
- **Env**: A=3, D=250 exp. Gain `0.2 + 0.4*v`. Detune `rnd(-25,+25)` cents.

### 1.4 Trampoline BOING (pitch bend up)
- **Osc**: sawtooth, start `140 + 40*v` Hz → exponential ramp to `320 + 220*v` Hz over `220 + 120*v` ms.
- **Filter**: lowpass sweeping 500 → 2500 Hz in sync with pitch (same times), Q=2 (slight quack).
- **Env**: A=5, D=`300+100*v` exp. Gain `0.3 + 0.4*v`. Detune `rnd(-20,+20)` cents.

### 1.5 Domino tick-tack (cascade)
- Per domino: **tick** = sine `700` Hz (alternate falls use `560` Hz — store a flip-flop) decay 30 ms, gain 0.2 + noise 20 ms → bandpass 2000 Hz Q=6, gain 0.15.
- **Env**: A=0.5, D=30. Detune `rnd(-40,+40)` cents, timing comes from physics; **cap at 1 per 30 ms** (drop extras) so long chains stay a pleasant clatter.

### 1.6 Fan whoosh (start/stop loop)
- **Source**: noise buffer, `loop=true`.
- **Filter**: lowpass, base cutoff 650 Hz, Q=0.5; **cutoff LFO** sine 0.9 Hz, depth ±150 Hz.
- **Blade whup**: amplitude LFO sine `5.5` Hz modulating a gain node, depth 30% (gain oscillates 0.7–1.0 of level).
- **Level**: 0.18. **Start**: gain 0→level over 400 ms while cutoff sweeps 200→650 Hz (spin-up). **Stop**: gain→0.001 over 600 ms, cutoff→200 (spin-down), then stop source.

### 1.7 Conveyor mechanical hum (loop)
- **Hum**: two sawtooths at 55 Hz and 55.6 Hz (0.6 Hz beat = "motor throb") → lowpass 300 Hz, gain 0.10.
- **Belt ticks**: noise loop → bandpass 900 Hz Q=4 → gain node gated by square LFO 3.2 Hz (depth: 0↔0.05) = soft periodic clunk.
- **Start/stop**: 200 ms linear gain ramps. One instance max; multiple conveyors just raise level by `min(1, 0.10*sqrt(n))`.

### 1.8 Bumper pinball ping
- **Osc A**: sine `880*(1+0.15*v)` Hz; **Osc B**: sine at 1.5× A (fifth). Both bend down 5% over 30 ms (spring settle).
- **Click**: noise 8 ms → highpass 2000 Hz, gain 0.2.
- **Env**: A=1, D=200 exp (B decays in 120). Gain `0.35 + 0.3*v`. Detune `rnd(-15,+15)` cents.

### 1.9 Balloon inflate squeak (subtle rise loop)
- **Osc**: sawtooth, `f = 300 + 600*inflate` Hz (`inflate` 0..1 updated per frame via `setTargetAtTime`, τ=50 ms).
- **Filter**: bandpass tracking `2*f`, Q=5 (thin rubbery tone).
- **Jitter**: pitch LFO 8 Hz, depth ±20 cents; **stutter**: square amplitude LFO `rnd(2.5,3.5)` Hz gating gain 0↔1 (squeak comes in little bursts).
- **Level**: 0.06 (deliberately subtle, ≈ −24 dB). Stop = 80 ms fade.

### 1.10 Balloon POP
- **Bang**: noise one-shot 80 ms → highpass 200 Hz, gain 0.9, A=0, D=70 exp.
- **Air flap**: noise 100 ms → bandpass sweeping 3000→500 Hz over 100 ms, Q=2, gain 0.3.
- **Thump**: sine 120 Hz, D=60, gain 0.4. (Compressor tames the peak.)

### 1.11 Berry lands in bowl (gulp/plop + chime)
- **Gulp**: sine 220 Hz → dip to 150 Hz over 40 ms → exponential rise to 600 Hz over next 100 ms. Lowpass 1200 Hz. Env A=2, D=160. Gain 0.35.
- **Chime** (delayed 120 ms): two sines picked randomly from {1046.5, 1318.5, 1568, 2093} Hz (C-major tones, always two different), D=300 exp, gain 0.12 each.
- **Anti-repeat**: gulp detune `rnd(-30,+30)` cents; chime pair randomized per catch.

### 1.12 Bell RING (FM strike)
- **Carrier**: sine 880 Hz. **Modulator**: sine `880*1.4 = 1232` Hz → gain node (index) into `carrier.frequency`; index starts at 600 Hz deviation, exp-decays to 1 over 800 ms.
- **Strike partial**: sine 1760 Hz, D=150, gain 0.15.
- **Env (carrier)**: A=2, D=1200 exp. Gain 0.4. Detune whole patch `rnd(-10,+10)` cents.

### 1.13 Sparkle star pickup (ascending gliss, 3 tiers)
- Per pickup, play 3 sine notes 45 ms apart, each A=2/D=250 exp, gain 0.22: base notes **C6, E6, G6** = 1046.5, 1318.5, 1568 Hz.
- **Tier**: star index n∈{0,1,2} multiplies all notes by **1.0 / 1.26 / 1.5** (so each star starts a chord-tone higher, topping at G6–B6–D7).
- **Sparkle**: noise 80 ms → highpass 6000 Hz, gain 0.08, on the first note.
- Each note detuned `rnd(-8,+8)` cents.

### 1.14 Part pick-up / put-down (UI thock)
- **Thock**: noise 5 ms → lowpass 1000 Hz, gain 0.2 + sine body D=50, gain 0.3.
- **Pick-up**: body glides 330→392 Hz over 60 ms (up = "grabbed"). **Put-down**: 392→330 Hz (down = "placed"). Detune `rnd(-15,+15)` cents.

### 1.15 Part rotate click
- Noise 3 ms → bandpass 3000 Hz Q=3, gain 0.18 + sine 1200 Hz, D=25, gain 0.12. Whole thing ×`rnd(0.95,1.05)` pitch. Total 30 ms.

### 1.16 Invalid placement — gentle "uh-uh" wobble
- **Osc**: triangle → lowpass 800 Hz. Two soft notes, 120 ms each, 40 ms gap: **note 1 = 233 Hz, note 2 = 208 Hz** (down a semitone-ish = mild "nope", not harsh minor).
- Each note: A=10, D=110, pitch sags 3% across the note. Gain 0.18 (quiet, never punitive). Add pitch LFO 8 Hz ±10 Hz on note 2 (the wobble).

### 1.17 PLAY button — whistle start
- **Osc**: sine (slide whistle), glissando 600 → 1200 Hz exponential over 300 ms, then hold 150 ms with vibrato 6 Hz ±25 Hz.
- **Breath**: noise → bandpass tracking 2× pitch, Q=4, gain 0.05.
- **Env**: A=10, S at 0.3 for hold, R=120. Lowpass 3000 Hz.

### 1.18 Win fanfare (~2 s)
- **Arpeggio** (each note: triangle + sine one octave up at 0.4×, lowpass 2500 Hz, A=5, D=500 exp, gain 0.35):
  - t=0 ms C5 523.25 · t=150 E5 659.25 · t=300 G5 783.99 · t=450 C6 1046.5
  - t=700 ms **chord** C6+E6+G6 (1046.5/1318.5/1568), held with S=0.25, R=900 → ends ≈2.0 s.
- **Confetti shimmer**: from t=500 to 1800 ms, spawn a sine ping every `rnd(80,140)` ms at `rnd(2000,5000)` Hz snapped to nearest C-major tone, D=150, gain 0.08; plus one noise swell (highpass 5 kHz, A=300, D=800, gain 0.06).

### 1.19 Lose/timeout — encouraging "hmm?"
- **Osc**: triangle → lowpass 700 Hz. Single 450 ms gesture: start 262 Hz (C4), hold 250 ms, then glide **up** to 294 Hz (D4) over 200 ms — a curious question, not a sad fall.
- Vibrato 5 Hz ±6 Hz throughout. Env A=30, D=450, gain 0.2. Optionally follow at +500 ms with one soft chime (784 Hz, D=250, gain 0.08) = "try again!".

### 1.20 Button tap
- Sine 600 Hz → 400 Hz over 30 ms, A=1, D=40, gain 0.25, detune `rnd(-20,+20)` cents. Total 45 ms.

### 1.21 Level select pop
- Sine sweep 300 → 900 Hz over 60 ms ("bloop up"), A=2, D=80, gain 0.3 + noise 5 ms highpass 3 kHz, gain 0.08. Pitch ×`rnd(0.95,1.05)`.

---

## 2. Background music — toy music box (generative loop)

- **Key/tempo**: C major, 76 bpm → beat = 0.789 s; 8 bars of 4/4 = 25.26 s loop.
- **Melody voice**: sine + triangle (triangle at 0.5× gain, same pitch) → lowpass 2200 Hz. Music-box envelope per note: A=2, D=1200 exp (no sustain — notes ring over each other, max 3 overlapping voices; steal oldest).
- **Bass voice**: pure sine, one whole note per bar → lowpass 400 Hz, A=20, D=2500, gain 0.5× melody.
- **Pattern** (quarter notes; Hz):
  - Bar 1: C5 E5 G5 E5 (523/659/784/659) — bass C3 130.8
  - Bar 2: A4 C5 E5 C5 (440/523/659/523) — bass A2 110
  - Bar 3: F4 A4 C5 A4 (349/440/523/440) — bass F2 87.3
  - Bar 4: G4 B4 D5 B4 (392/494/587/494) — bass G2 98
  - Bars 5–7: repeat 1–3. Bar 8 (turnaround): G4 B4 D5 **G5** (392/494/587/784) — bass G2.
- **Humanize** (kills loop fatigue at zero cost): each note start `± rnd(0,12)` ms, pitch `± rnd(0,4)` cents, gain `× rnd(0.85,1.0)`; on every 2nd loop, bar 2 swaps its last note C5→E5, and beat 3 of bar 4 gets an octave-up echo (D6, gain 0.3×, +60 ms).
- **Level**: `musicBus.gain = 0.126` (≈ −18 dB vs sfx bus at 1.0).
- **Scheduler**: `setInterval(200 ms)` schedules all notes whose start < `ctx.currentTime + 0.5` from a precomputed 32-slot event list; wrap index → seamless loop. CPU: ≤4 oscillators alive at any moment.
- **Ducking rule**: when `sfx('win')` fires → `musicBus.gain.setTargetAtTime(0.032, t, 0.05)` (−12 dB duck in ~150 ms), then at `t+2.2s` → `setTargetAtTime(0.126, t+2.2, 0.25)` (restore over ~800 ms). Same rule at half depth (to 0.063) for the bell ring.

---

## 3. Tiny JS architecture

```
AudioContext (lazy-created, resumed on first pointer event)
 └─ masterGain (0.9)
     └─ DynamicsCompressor  threshold −12 dB, knee 20, ratio 4, attack 0.003, release 0.25
         └─ destination
 sfxBus (gain 1.0)  ──►  masterGain
 musicBus (gain 0.126) ► masterGain
```

```js
const Audio = (() => {
  let ctx, noiseBuf, sfxBus, musicBus;
  const last = {};                       // rate-limit timestamps per name
  function init() {
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    Object.assign(comp, {}); comp.threshold.value = -12; comp.ratio.value = 4;
    const master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.126; musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    document.addEventListener('visibilitychange', () =>
      document.hidden ? ctx.suspend() : ctx.resume());
  }
  // helpers: osc(type,f), noise(loop), env(gain,{a,d,s,r,peak}), all auto-GC via node.stop()
  const recipes = { woodKnock(o){/* per spec 1.1 */}, /* ... one fn per sound ... */ };
  const minGap = { woodKnock: 30, dominoTick: 30, marble: 25 };
  function sfx(name, opts = {}) {
    if (!ctx) init();
    const t = ctx.currentTime;
    if (t - (last[name] || -1) < (minGap[name] || 0) / 1000) return;
    last[name] = t;
    recipes[name]({ strength: 0.7, ...opts, t, ctx, bus: sfxBus, noiseBuf });
  }
  return { init, sfx,
    startLoop: n => recipes[n + 'Start'](/*…*/), stopLoop: n => {/* fade+stop handle */},
    duckMusic: (db, holdS) => {/* setTargetAtTime per §2 */},
    music: { start(){/* 200ms lookahead scheduler per §2 */}, stop(){} } };
})();
// usage: Audio.sfx('woodKnock', { strength: impact/maxImpact });
```

Implementation notes:
- **Example recipe** (wood knock, the template all hits follow):
  ```js
  woodKnock({ t, ctx, bus, noiseBuf, strength: v }) {
    const f0 = (160 + 170*v) * (0.97 + Math.random()*0.06);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0*0.5, t + 0.06);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25 + 0.45*v, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(bus); o.start(t); o.stop(t + 0.1);
    // + overtone osc @2.7*f0 and 15ms bandpassed noise per spec
  }
  ```
- **Cleanup**: every one-shot calls `.stop(t+dur)`; stopped nodes disconnect themselves (or `onended = () => g.disconnect()`).
- **Voice cap**: keep a counter; if >16 concurrent one-shots, skip lowest-priority (dominoTick, marble first).
- **CPU budget**: worst case ≈ 10 oscillators + 2 noise sources + music's 4 voices — trivial on any device; no ScriptProcessor/Worklet needed.
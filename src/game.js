/*
 * Lory's Lab — game shell: screens, editor, run loop, feedback, persistence.
 * Depends on LoryCore (physics), LoryRender (art), LoryLevels (campaign),
 * LoryAudio (sound — optional at load time).
 */
(function () {
  'use strict';

  const Core = window.LoryCore;
  const R = window.LoryRender;
  const LEVELS = window.LoryLevels;
  const A = { // safe audio facade
    sfx: (n, o) => window.LoryAudio && window.LoryAudio.sfx(n, o),
    unlock: () => window.LoryAudio && window.LoryAudio.unlock(),
    handleEvents: (e) => window.LoryAudio && window.LoryAudio.handleEvents(e),
    startLoop: (n) => window.LoryAudio && window.LoryAudio.startLoop(n),
    stopLoop: (n) => window.LoryAudio && window.LoryAudio.stopLoop(n),
    stopAllLoops: () => window.LoryAudio && window.LoryAudio.stopAllLoops(),
    setSfx: (b) => window.LoryAudio && window.LoryAudio.setSfxEnabled(b),
    setMusic: (b) => window.LoryAudio && window.LoryAudio.setMusicEnabled(b),
  };

  const APP_W = 1280, APP_H = R.BOARD_H + R.TRAY_H;
  const SAVE_KEY = 'lorys-lab-save-v1';

  // ---------------------------------------------------------------------------
  // save data
  // ---------------------------------------------------------------------------
  // Storage indirection: a native wrapper (Capacitor/WKWebView) can inject
  // window.LoryStorage = { get(key), set(key, value) } BEFORE this script to
  // redirect saves to device storage. Both methods are synchronous; the
  // wrapper is expected to hydrate its cache before the game loads and flush
  // asynchronously. Falls back to localStorage. See doc/IOS-APP-GUIDE.md.
  const store = (typeof window !== 'undefined' && window.LoryStorage) || {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
  };

  const save = (() => {
    let d = { mode: null, sfx: true, music: true, juice: true, progress: {}, allUnlocked: false, myPuzzles: [], puzzleWins: {}, puzzleSeq: 1 };
    try { Object.assign(d, JSON.parse(store.get(SAVE_KEY) || '{}')); } catch (e) {}
    d.myPuzzles = Array.isArray(d.myPuzzles) ? d.myPuzzles : [];
    d.puzzleWins = d.puzzleWins || {};
    return d;
  })();
  function persist() {
    try {
      store.set(SAVE_KEY, JSON.stringify(save));
    } catch (e) {
      // storage blocked (private mode / sandboxed embed): warn once, loudly —
      // otherwise "saving" would silently evaporate on reload
      if (!persist._warned) {
        persist._warned = true;
        setTimeout(() => toast('⚠️ This browser is blocking saves — progress and puzzles will only last this session!', 6), 50);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------------
  const S = {
    screen: 'title',          // title | levels | game
    levelIndex: 0,
    sandbox: false,
    phase: 'edit',            // edit | run | won
    placements: [],
    trayStock: [],            // [{type, count}]
    sim: null,
    runAcc: 0, lastTs: 0, t: 0,
    selection: null,          // index into placements
    selButtons: [], wells: [],
    trayPage: 0, trayPages: 1, trayArrows: [],
    drag: null,               // {spec, from:'tray'|'board', origIndex, origSpec, invalid}
    hints: null, hintTimer: 0, hintsUsed: 0,
    failCount: 0, winTimer: null,
    puzzle: null,            // custom user puzzle being played
    pluckMode: false,        // sandbox: choosing which parts become the tray
    editingPuzzleId: null,   // sandbox: id of the saved puzzle being edited
    lory: { x: 92, y: 686, pose: 'idle', say: null, sayTimer: 0 },
    winStats: null,
    loopSounds: 0,
    celebrated: {},
  };

  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  // ---------------------------------------------------------------------------
  // level helpers
  // ---------------------------------------------------------------------------
  const SANDBOX_TRAY = [
    ['plank', 8], ['shelf', 4], ['wall', 2], ['trampoline', 3], ['seesaw', 2], ['fan', 3],
    ['magnet', 2], ['domino', 12], ['conveyor', 3], ['bumper', 3], ['balloon', 4], ['bucket', 2],
    ['rope', 3], ['scissors', 2], ['candle', 3], ['match', 3], ['fuse', 5], ['hydrant', 2], ['switch', 2], ['fist', 2], ['laser', 2], ['bulb', 2], ['lens', 2], ['cannon', 2], ['mirror', 3],
    ['drawbridge', 2], ['pullcord', 2], ['basket', 1], ['ball_basket', 3],
    ['ball_beach', 3], ['ball_marble', 3], ['berry', 3], ['bowl', 1], ['bell', 1],
    ['balloon_goal', 4], ['spikes', 2], ['sparkle', 3],
  ];

  function currentLevel() {
    if (S.puzzle) {
      const counts = {};
      for (const p of S.puzzle.plucked) counts[p.type] = (counts[p.type] || 0) + 1;
      return {
        title: S.puzzle.name, goalType: 'catch', goalText: 'Feed Lory the berry!',
        // the author's own placement of the plucked parts IS the solution, so
        // hints work exactly like campaign levels (💡, modes, auto-hint)
        fixed: S.puzzle.fixed, sparkles: [], solution: S.puzzle.plucked,
        hintText: 'Psst — this is how the puzzle maker built it! Your way can work too!',
        tray: Object.entries(counts).map(([type, count]) => ({ type, count })),
      };
    }
    if (S.sandbox) return { title: 'Sandbox', goalType: 'catch', goalText: 'Build anything! With a berry and my bowl, "🧩 Make puzzle" saves it as your own puzzle.', fixed: [], sparkles: [], tray: [], solution: [], hintText: 'Try a bowl and a berry — I love catching berries!' };
    return LEVELS[S.levelIndex];
  }

  function rebuildSim() {
    S.sim = Core.createSim(currentLevel(), S.placements);
    if (S.screen === 'game') updateStarChip();
  }

  function enterLevel(i, sandbox, puzzle) {
    stopRun();                                   // covers Skip-during-run etc.
    resetCam();
    const skip = $('#skipBtn'); if (skip) skip.remove();
    S.sandbox = !!sandbox;
    S.puzzle = puzzle || null;
    S.pluckMode = false;
    S.editingPuzzleId = null;
    S.levelIndex = i || 0;
    S.placements = [];
    S.selection = null; S.drag = null; S.hints = null;
    S.failCount = 0; S.hintsUsed = 0;
    S.phase = 'edit';
    S.celebrated = {};
    const L = currentLevel();
    S.trayStock = S.sandbox
      ? SANDBOX_TRAY.map(([type, count]) => ({ type, count }))
      : L.tray.map(t => ({ type: t.type, count: t.count }));
    S.trayPage = 0;
    rebuildSim();
    R.resetFx();
    setLory('think', L.goalText, 6);
    showScreen('game');
    updateTopbar();
    A.sfx('levelpop');
  }

  function trayItem(type) { return S.trayStock.find(t => t.type === type); }

  // Reopen a saved puzzle in the sandbox: full scene restored, tray-parts
  // keep their 🧩 marks, and 💾 will update the same puzzle.
  function editPuzzleInSandbox(p) {
    enterLevel(0, true);
    S.editingPuzzleId = p.id;
    S.placements = [
      ...p.fixed.map(s => Object.assign({}, s)),
      ...p.plucked.map(s => Object.assign({ _plucked: true }, s)),
    ];
    // deduct the scene from the sandbox stock
    for (const s of S.placements) { const t = trayItem(s.type); if (t) t.count = Math.max(0, t.count - 1); }
    rebuildSim();
    setLory('think', `Editing "${p.name}"! Tap a part and use 🧩/📌 to change what the player places. Press 🧩 then 💾 to save.`, 10);
  }

  function setLory(pose, say, secs) {
    S.lory.pose = pose;
    if (say !== undefined) { S.lory.say = say; S.lory.sayTimer = secs || 5; }
  }

  // ---------------------------------------------------------------------------
  // DOM UI
  // ---------------------------------------------------------------------------
  function buildDom() {
    const app = $('#app');

    // top bar
    const bar = el('div', 'topbar');
    bar.innerHTML = `
      <button class="chip btn" id="backBtn" title="Back">←</button>
      <div class="chip" id="levelChip">Lory's Lab</div>
      <div class="chip" id="starChip" style="display:none">⭐ 0/3</div>
      <div style="flex:1"></div>
      <button class="chip btn labeled" id="puzzleBtn" title="Turn your build into a saved puzzle">🧩 Make puzzle</button>
      <button class="chip btn" id="pluckExitBtn" title="Stop making a puzzle" style="display:none">✕</button>
      <button class="chip btn" id="hintBtn" title="Hint">💡</button>
      <button class="chip btn" id="resetBtn" title="Clear parts">↺</button>
      <button class="chip btn" id="sfxBtn" title="Sound"></button>
      <button class="chip btn" id="musicBtn" title="Music"></button>`;
    app.appendChild(bar);

    // play button
    const play = el('button', 'playbtn', '▶');
    play.id = 'playBtn';
    app.appendChild(play);

    // overlay root
    app.appendChild(el('div', 'overlay-root'));
    // toast
    app.appendChild(el('div', 'toast'));
    // portrait rotate nudge (outside #app so it isn't scaled down with it)
    const ro = el('div');
    ro.id = 'rotateOverlay';
    ro.innerHTML = `<div class="ro-card"><div class="ro-icon">📱↻</div>Turn your ${'ontouchstart' in window ? 'device' : 'screen'} sideways to play!</div>`;
    document.body.appendChild(ro);

    $('#backBtn').onclick = () => { A.sfx('button'); stopRun(); exitPluckMode(false); showScreen('levels'); };
    $('#hintBtn').onclick = onHint;
    $('#puzzleBtn').onclick = onPuzzleButton;
    // ✕ leaves marking mode. Editing a saved puzzle keeps its marks (wiping
    // them silently destroyed the puzzle's hidden-parts choice); a fresh,
    // never-saved marking session still cancels cleanly.
    $('#pluckExitBtn').onclick = () => { A.sfx('button'); exitPluckMode(!!S.editingPuzzleId); setLory('idle', null); };
    $('#resetBtn').onclick = () => { A.sfx('button'); stopRun(); exitPluckMode(false); clearPlacements(); };
    $('#sfxBtn').onclick = () => {
      save.sfx = !save.sfx; A.setSfx(save.sfx); persist(); syncAudioBtns(); A.sfx('button');
      if (save.sfx && S.phase === 'run') startLoops(); // re-enable mid-run: bring the hum back
    };
    $('#musicBtn').onclick = () => { save.music = !save.music; A.setMusic(save.music); persist(); syncAudioBtns(); };
    play.onclick = () => { S.phase === 'run' ? stopRun(true) : startRun(); };

    syncAudioBtns();
  }

  function syncAudioBtns() {
    $('#sfxBtn').textContent = save.sfx ? '🔊' : '🔇';
    $('#musicBtn').textContent = save.music ? '🎵' : '𝄽';
    $('#musicBtn').style.opacity = save.music ? 1 : 0.5;
  }

  function updateTopbar() {
    const L = currentLevel();
    const prog = save.progress[S.levelIndex];
    const stars = prog && !S.sandbox && !S.puzzle ? '  ' + '★'.repeat(prog.stars) : '';
    $('#levelChip').textContent = S.puzzle ? `🧩 ${S.puzzle.name}`
      : S.sandbox ? '🎨 Sandbox' : `${S.levelIndex + 1}. ${L.title}${stars}`;
    $('#hintBtn').style.display = S.sandbox ? 'none' : '';
    // star chip: driven by updateStarChip — any scene with sparkles shows it
    $('#puzzleBtn').style.display = S.sandbox ? '' : 'none';
    $('#puzzleBtn').textContent = S.pluckMode ? '💾 Save puzzle' : '🧩 Make puzzle';
    $('#pluckExitBtn').style.display = S.pluckMode ? '' : 'none';
    updateStarChip();
  }
  function updateStarChip() {
    if (!S.sim) return;
    const chip = $('#starChip');
    if (!chip) return;
    const total = S.sim.state.sparkleTotal;
    chip.style.display = total > 0 && S.screen === 'game' ? '' : 'none';
    chip.textContent = `⭐ ${S.sim.state.sparkles}/${total}`;
  }

  function toast(msg, secs) {
    const t = $('.toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), (secs || 3) * 1000);
  }

  function showScreen(name) {
    S.screen = name;
    const root = $('.overlay-root');
    root.innerHTML = '';
    root.style.pointerEvents = name === 'game' ? 'none' : 'auto';
    $('.topbar').style.display = name === 'game' ? 'flex' : 'none';
    $('#playBtn').style.display = name === 'game' ? '' : 'none';
    if (name === 'title') showTitle();
    if (name === 'levels') showLevelSelect();
  }

  // --- title -----------------------------------------------------------------
  function showTitle() {
    const root = $('.overlay-root');
    const mode = save.mode || 'sprout';
    root.innerHTML = `
      <div class="screen title-screen">
        <canvas id="titleLory" width="260" height="260"></canvas>
        <h1>Lory's Lab</h1>
        <p class="tag">Build incredible machines. Feed the bird. 🍓</p>
        <button class="big leaf" id="startBtn">▶&ensp;Play</button>
        <button class="big blue" id="sandboxBtn">🎨&ensp;Sandbox</button>
        <div class="mode-row">
          <span>Who's inventing?</span>
          <button class="mode ${mode === 'sprout' ? 'on' : ''}" data-m="sprout">🌱 Little inventor <small>age 5+ · endless hints</small></button>
          <button class="mode ${mode === 'whiz' ? 'on' : ''}" data-m="whiz">🚀 Big inventor <small>age 8+ · 2 hints a level</small></button>
        </div>
        <div class="title-toggles">
          <button class="chip btn" id="tMusic" title="Music"></button>
          <button class="chip btn reset" id="tReset" title="Erase all progress">🧹 Start fresh</button>
        </div>
      </div>`;
    $('#startBtn').onclick = () => { A.sfx('play'); save.mode = save.mode || 'sprout'; persist(); showScreen('levels'); };
    $('#sandboxBtn').onclick = () => { A.sfx('button'); enterLevel(0, true); };
    root.querySelectorAll('.mode').forEach(b => b.onclick = () => {
      save.mode = b.dataset.m; persist(); A.sfx('button'); showTitle();
    });
    const syncTitleToggles = () => {
      $('#tMusic').textContent = save.music ? '🎵 Music on' : '🎵 Music off';
      $('#tMusic').style.opacity = save.music ? 1 : 0.5;
    };
    syncTitleToggles();
    $('#tMusic').onclick = () => { save.music = !save.music; A.setMusic(save.music); persist(); syncTitleToggles(); syncAudioBtns(); };
    $('#tReset').onclick = () => { A.sfx('button'); showResetConfirm(); };
  }

  // "Start fresh": wipe progress, unlocks, and created puzzles (keeps settings).
  function showResetConfirm() {
    const root = $('.overlay-root');
    const modal = el('div');
    modal.innerHTML = `
      <div class="dim-bg"></div>
      <div class="wincard namecard">
        <h2>Start fresh?</h2>
        <p class="reset-warn">This erases all stars, unlocked levels,<br>and every puzzle you created. 😮</p>
        <div class="row">
          <button class="big blue" id="rsCancel">✕&ensp;Keep everything</button>
          <button class="big danger" id="rsGo">🧹&ensp;Erase it all</button>
        </div>
      </div>`;
    root.appendChild(modal);
    $('#rsCancel').onclick = () => { A.sfx('button'); modal.remove(); };
    $('#rsGo').onclick = () => {
      save.progress = {};
      save.allUnlocked = false;
      save.myPuzzles = [];
      save.puzzleWins = {};
      save.puzzleSeq = 1;
      persist();
      modal.remove();
      A.sfx('pop');
      toast('All fresh! Every puzzle is back to the start. 🌱', 4);
      showTitle();
    };
  }

  // --- level select ----------------------------------------------------------
  function unlockedThrough() {
    if (save.allUnlocked) return LEVELS.length - 1;
    let n = 0;
    while (n < LEVELS.length && save.progress[n]) n++;
    return Math.min(n, LEVELS.length - 1);
  }

  // Secret lab key: on the level-select screen, press the letter L five times
  // (or tap the heading five times) to toggle every level open.
  let secretPresses = 0, secretTimer = null;
  function secretTick() {
    secretPresses++;
    clearTimeout(secretTimer);
    secretTimer = setTimeout(() => { secretPresses = 0; }, 2500);
    if (secretPresses >= 5) {
      secretPresses = 0;
      save.allUnlocked = !save.allUnlocked;
      persist();
      A.sfx(save.allUnlocked ? 'win' : 'button');
      toast(save.allUnlocked ? '🔓 Secret lab key! Every level is open.' : '🔒 Levels locked again.');
      if (S.screen === 'levels') showLevelSelect();
    }
  }
  function showLevelSelect() {
    const root = $('.overlay-root');
    root.innerHTML = `<div class="screen levels-screen">
      <div class="lv-head"><button class="chip btn" id="homeBtn">←</button><h2 id="lvTitle">Pick a puzzle!</h2></div>
      <div class="grid" id="grid"></div>
      <div class="lv-mine" id="mineWrap"><h3><span>🧩 My puzzles</span><span class="spacer"></span>
        <button class="chip btn" id="pzImportBtn" title="Open a puzzle file">📥 Open file</button>
        <button class="chip btn" id="pzBackupBtn" title="Save all my puzzles to a file" style="display:none">📦 Save all</button></h3>
        <div class="grid" id="mineGrid"></div></div>
    </div>`;
    const grid = $('#grid');
    const maxOpen = unlockedThrough();
    LEVELS.forEach((L, i) => {
      const prog = save.progress[i];
      const locked = i > maxOpen;
      const card = el('button', 'card' + (locked ? ' locked' : ''));
      const stars = prog ? '★'.repeat(prog.stars) + '<span class="dim">' + '★'.repeat(3 - prog.stars) + '</span>' : '<span class="dim">★★★</span>';
      card.innerHTML = locked ? `<div class="num">🔒</div><div class="nm">???</div>`
        : `<div class="num">${i + 1}</div><div class="nm">${L.title}</div><div class="stars">${stars}</div>`;
      if (!locked) card.onclick = () => { A.sfx('levelpop'); enterLevel(i, false); };
      grid.appendChild(card);
    });
    const sand = el('button', 'card sandbox');
    sand.innerHTML = `<div class="num">🎨</div><div class="nm">Sandbox</div><div class="stars">build free!</div>`;
    sand.onclick = () => { A.sfx('button'); enterLevel(0, true); };
    grid.appendChild(sand);
    $('#homeBtn').onclick = () => { A.sfx('button'); showScreen('title'); };
    $('#lvTitle').addEventListener('click', () => secretTick()); // touch path to the secret key

    // saved user puzzles (the section always shows: 📥 import must work even
    // on a fresh device with zero puzzles — that's the restore-backup path)
    $('#pzImportBtn').onclick = () => { A.sfx('button'); openPuzzleFilePicker(); };
    if (save.myPuzzles.length) {
      $('#pzBackupBtn').style.display = '';
      $('#pzBackupBtn').onclick = () => { A.sfx('button'); backupAllPuzzles(); };
      const mine = $('#mineGrid');
      save.myPuzzles.forEach(p => {
        const card = el('button', 'card mine');
        const solved = save.puzzleWins[p.id] ? '⭐ solved!' : '&nbsp;';
        card.innerHTML = `<div class="num">🧩</div><div class="nm">${p.name.replace(/</g, '&lt;')}</div><div class="stars">${solved}</div><span class="pedit" title="Edit">✎</span><span class="pdel" title="Delete">✕</span><span class="pshare" title="Share">📤</span>`;
        card.onclick = () => { A.sfx('levelpop'); enterLevel(0, false, p); };
        card.querySelector('.pedit').onclick = (e) => {
          e.stopPropagation();
          A.sfx('button');
          editPuzzleInSandbox(p);
        };
        card.querySelector('.pshare').onclick = (e) => {
          e.stopPropagation();
          A.sfx('button');
          sharePuzzleDialog(p);
        };
        const del = card.querySelector('.pdel');
        del.onclick = (e) => {
          e.stopPropagation();
          if (del.textContent === '✕') { del.textContent = 'Sure?'; setTimeout(() => { del.textContent = '✕'; }, 2000); return; }
          save.myPuzzles = save.myPuzzles.filter(q => q.id !== p.id);
          delete save.puzzleWins[p.id];
          persist(); A.sfx('button'); showLevelSelect();
        };
        mine.appendChild(card);
      });
    }
  }

  // --- win overlay -----------------------------------------------------------
  function showWinOverlay(stars, custom) {
    const root = $('.overlay-root');
    root.style.pointerEvents = 'auto';
    const last = !custom && S.levelIndex === LEVELS.length - 1;
    const starsRow = custom ? '<div class="winstars"><span class="wstar earn" style="animation-delay:0.3s">🧩</span></div>'
      : `<div class="winstars">${[0, 1, 2].map(i => `<span class="wstar ${i < stars ? 'earn' : ''}" style="animation-delay:${0.3 + i * 0.15}s">★</span>`).join('')}</div>`;
    root.innerHTML = `
      <div class="dim-bg"></div>
      <div class="wincard">
        <canvas id="winLory" width="200" height="200"></canvas>
        <h2>${custom ? 'You fed Lory!' : ['Yay! You did it!', 'Berry good!', 'What a machine!'][Math.floor(Math.random() * 3)]}</h2>
        ${starsRow}
        <div class="row">
          <button class="big blue" id="replayBtn">↺&ensp;Again</button>
          <button class="big leaf" id="nextBtn">${custom ? 'Done&ensp;✓' : last ? '🏆 The End!' : 'Next&ensp;➜'}</button>
        </div>
      </div>`;
    const pz = S.puzzle;
    $('#replayBtn').onclick = () => { A.sfx('button'); enterLevel(S.levelIndex, false, pz); };
    $('#nextBtn').onclick = () => {
      A.sfx('button');
      if (custom || last) { S.puzzle = null; showScreen('levels'); } else enterLevel(S.levelIndex + 1, false);
    };
  }

  // ---------------------------------------------------------------------------
  // editing
  // ---------------------------------------------------------------------------
  function clearPlacements() {
    for (const p of S.placements) R.fx.poof(p.x, p.y, 4);
    S.placements = [];
    S.selection = null;
    const L = currentLevel();
    S.trayStock = S.sandbox
      ? SANDBOX_TRAY.map(([type, count]) => ({ type, count }))
      : L.tray.map(t => ({ type: t.type, count: t.count }));
    rebuildSim();
  }

  function commitPlacement(spec) {
    S.placements.push(spec);
    rebuildSim();
    R.fx.poof(spec.x, spec.y, 6);
    A.sfx('place');
    // sandbox nudge: once the scene could be a real puzzle, point at the button
    if (S.sandbox && !S.pluckMode && !S.puzzleNudged
      && S.placements.some(p => p.type === 'berry') && S.placements.some(p => p.type === 'bowl')) {
      S.puzzleNudged = true;
      setLory('think', 'Ooh, this could be a real puzzle! Press "🧩 Make puzzle" up top to save it!', 7);
      toast('Press "🧩 Make puzzle" to save your invention as a puzzle!', 5);
    }
  }

  function removePlacement(idx, refund) {
    const p = S.placements[idx];
    if (!p) return;
    S.placements.splice(idx, 1);
    if (refund !== false) { const t = trayItem(p.type); if (t) t.count++; }
    if (S.selection === idx) S.selection = null;
    else if (S.selection > idx) S.selection--;
    rebuildSim();
    R.fx.poof(p.x, p.y, 5);
  }

  function specInvalid(spec) {
    const defs = Core.PART_DEFS[spec.type];
    const halfH = (defs.h || defs.r * 2) / 2, halfW = (defs.w || defs.r * 2) / 2;
    if (spec.y > R.FLOOR_Y - halfH + 4 || spec.y < 40 || spec.x < 30 || spec.x > APP_W - 30) return true;
    // keep the zone under the floating Play button drop-free: a part there
    // would sit underneath the DOM button and become ungrabbable. The button
    // grows with uiBoost on phones (no stored solution uses this corner —
    // checked against all 24 levels). The button lives in CANVAS space, so
    // map its rect into board space through the camera.
    const half = Math.max(halfW, halfH);
    const zoneX = (viewW - (92 * uiBoost + 40) - boardOX() - cam.x) / cam.z;
    const zoneY = (APP_H - 128 - 92 * uiBoost - 18 - cam.y) / cam.z;
    if (spec.x + half > zoneX && spec.y + half > zoneY) return true;
    // test against a sim WITHOUT the dragged part (S.sim is rebuilt at drag start)
    return Core.placementOverlaps(S.sim, spec);
  }

  // Kid-friendly drop: if the spot is taken, settle into the nearest free one
  // instead of bouncing the part back to where it came from.
  function findNearestValid(spec) {
    if (!specInvalid(spec)) return spec;
    for (let ring = 1; ring <= 12; ring++) {
      const rad = ring * 14;
      const steps = Math.max(8, ring * 6);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
        const cand = Object.assign({}, spec, {
          x: Math.round(spec.x + Math.cos(a) * rad),
          y: Math.round(spec.y + Math.sin(a) * rad),
        });
        if (!specInvalid(cand)) return cand;
      }
    }
    return null;
  }

  function rotateSelection(dir) {
    const p = S.placements[S.selection];
    if (!p) return;
    const defs = Core.PART_DEFS[p.type];
    if (!defs.rot) return;
    if (p.type === 'cannon') {
      // cannon angle = barrel elevation: clamped 0–75, never wraps
      const next = Math.max(0, Math.min(75, (p.angle || 0) + dir * 15));
      if (next === (p.angle || 0)) { A.sfx('invalid'); return; }
      p.angle = next;
    } else {
      p.angle = ((p.angle || 0) + dir * 15 + 360) % 360;
    }
    rebuildSim();
    A.sfx('rotate');
  }
  function flipSelection() {
    const p = S.placements[S.selection];
    if (!p) return;
    const defs = Core.PART_DEFS[p.type];
    if (!defs.dir) return;
    const dirs = defs.dir;
    p.dir = dirs[(dirs.indexOf(p.dir || dirs[0]) + 1) % dirs.length];
    rebuildSim();
    A.sfx('rotate');
  }
  // What every part does, in Lory's voice — shown by the ? selection button.
  const PART_INFO = {
    plank: 'A wooden plank! Tilt it to make ramps and bridges.',
    shelf: 'A sturdy shelf — things can stand and roll on it.',
    wall: 'A tall wall. Nothing gets through!',
    trampoline: 'Boing! Whatever falls on it bounces way up.',
    seesaw: 'A seesaw! Drop something on one side to fling what sits on the other.',
    fan: 'It blows a steady wind! Light things fly away — but never my berry. Tap ⏸ to place it stopped: then only a pressure plate wakes it.',
    magnet: 'Bump it awake and it pulls metal marbles. Only marbles!',
    domino: 'Line up dominoes and tip the first one — click, clack, click!',
    conveyor: 'A moving belt! It carries things along — flip it with ⇄.',
    bumper: 'Boing-boing! Everything bounces off it, super hard.',
    balloon: 'It floats up, up, up! Pointy and hot things pop it.',
    bucket: 'It catches things and keeps them. No way out!',
    rope: 'It grabs whatever hangs near its end. Scissors, fire or the laser set it free!',
    scissors: 'Snip! Touch them and they cut ropes and balloon strings.',
    candle: 'A little flame! It lights fuses and matches, pops balloons and burns strings. Water blows it out — tap 🔥/💨 to start it lit or cold.',
    match: 'Bump it and it strikes a big flame — just for a moment, then it is spent!',
    fuse: 'Fire crawls along it — a slow-burning path for your flame.',
    hydrant: 'Bump it and it sprays water! Water pushes things and puts out fire.',
    switch: 'A pressure plate! It powers the nearest machine while something sits on it.',
    fist: 'A spring-loaded punch! Touch the glove — or press the button on its back to fire it like a cannon.',
    laser: 'PEW! Touch it and the beam pops balloons, lights fires and cuts strings. Walls block it.',
    bulb: 'Press its button to switch the light on and off — ⇄ moves the button. Shine it into a lens!',
    lens: 'It focuses light! Put it near a glowing bulb and out comes a laser beam.',
    cannon: 'Drop a ball in the top hatch — the door snaps shut! Light the back fuse with any flame and BOOM — one shot each, so make it count! ⟲⟳ aims the barrel, ⇄ turns it around.',
    mirror: 'Both sides are shiny! Turn it to bounce the laser beam somewhere new.',
    drawbridge: 'A castle bridge! It starts up like a wall — pull its cord and down it creaks into a road.',
    pullcord: 'A ring on a rope! Drop something onto the ring and it yanks the nearest drawbridge down.',
    basket: 'Swish! Get my basketball through the hoop from above — only basketballs count! ⇄ turns it around.',
    ball_basket: 'My bouncy basketball! Shoot it through the hoop — even out of a cannon!',
    ball_beach: 'A light, bouncy beach ball — the wind loves it.',
    ball_marble: 'A heavy metal marble. Magnets love it!',
    berry: 'My berry! Roll it into my bowl to feed me!',
    bowl: 'My bowl! A berry that lands here feeds me. Yum!',
    bell: 'Ring it with a good bump! Ding!',
    balloon_goal: 'A tied balloon. Cut or burn its string and up it goes!',
    spikes: 'A prickly cactus! Balloons that touch it go POP.',
    sparkle: 'A bonus star! Whoever plays your puzzle grabs it by passing through.',
  };
  function showPartInfo() {
    const p = S.placements[S.selection];
    if (!p) return;
    A.sfx('button');
    setLory('think', PART_INFO[p.type] || 'A mysterious part!', 8);
  }

  function toggleLitSelection() {
    const p = S.placements[S.selection];
    if (!p) return;
    if (p.type === 'candle') {
      p.lit = p.lit === false;      // cold -> lit, lit (default) -> cold
      rebuildSim();
      A.sfx(p.lit === false ? 'extinguishHiss' : 'igniteFizz');
    } else if (p.type === 'fan') {
      p.on = p.on === false;        // stopped -> running, running (default) -> stopped
      rebuildSim();
      A.sfx(p.on === false ? 'switchOff' : 'switchOn');
    }
  }
  function togglePluckSelection() {
    // sandbox: mark/unmark the selected part as a puzzle tray piece without
    // having to enter pluck mode — the only way to revert a mark when editing
    // a saved puzzle used to be hidden behind the 🧩 button
    const p = S.placements[S.selection];
    if (!p || !S.sandbox || p.type === 'sparkle') return; // stars are author-only scenery
    if (p._plucked) delete p._plucked; else p._plucked = true;
    A.sfx(p._plucked ? 'pickup' : 'place');
    R.fx.poof(p.x, p.y, 4);
    rebuildSim();
  }

  // ---------------------------------------------------------------------------
  // puzzle maker (sandbox): pluck parts into the tray, then save
  // ---------------------------------------------------------------------------
  function onPuzzleButton() {
    if (!S.sandbox || S.phase !== 'edit') return;
    if ($('#pzName')) return; // the name dialog is already open
    A.sfx('button');
    if (!S.pluckMode) {
      // validate up front so nobody plucks parts only to be refused at the end
      if (!S.placements.length) { toast('Build something first!'); return; }
      if (!S.placements.some(p => p.type === 'berry')) {
        setLory('think', 'Every puzzle needs a berry for me to eat! Add one from the tray first.', 6);
        toast('Add a 🍓 berry first!'); return;
      }
      if (!S.placements.some(p => p.type === 'bowl')) {
        setLory('think', 'Where will the berry land? Add my bowl from the tray first!', 6);
        toast('Add my bowl first!'); return;
      }
      cancelDrag();
      S.pluckMode = true;
      S.selection = null;
      setLory('think', 'Tap the parts you want the player to place — they turn see-through. Then press 💾 Save puzzle!', 12);
    } else {
      savePuzzle();
    }
    updateTopbar();
  }

  function exitPluckMode(keepMarks) {
    if (!S.pluckMode) return;
    S.pluckMode = false;
    if (!keepMarks) for (const p of S.placements) delete p._plucked;
    rebuildSim();
    if ($('#puzzleBtn')) updateTopbar();
  }

  function savePuzzle() {
    const plucked = S.placements.filter(p => p._plucked);
    const fixed = S.placements.filter(p => !p._plucked);
    if (!plucked.length) {
      setLory('think', 'First tap the parts the player should place — they turn see-through with a 🧩 mark. Then press 💾 again!', 8);
      toast('Tap at least one part to put it in the tray!');
      return;
    }
    const all = S.placements;
    if (!all.some(p => p.type === 'berry')) { toast('Every puzzle needs a berry to feed Lory!'); return; }
    if (!all.some(p => p.type === 'bowl')) { toast("Every puzzle needs Lory's bowl!"); return; }

    const editing = S.editingPuzzleId && save.myPuzzles.find(q => q.id === S.editingPuzzleId);
    const defaultName = editing ? editing.name : `My Puzzle ${save.puzzleSeq}`;
    const root = $('.overlay-root');
    root.style.pointerEvents = 'auto';
    root.innerHTML = `
      <div class="dim-bg"></div>
      <div class="wincard namecard">
        <h2>${editing ? 'Update your puzzle!' : 'Name your puzzle!'}</h2>
        <input id="pzName" maxlength="24" value="${defaultName.replace(/"/g, '&quot;')}">
        <div class="row">
          <button class="big blue" id="pzCancel">✕&ensp;Back</button>
          <button class="big leaf" id="pzSave">💾&ensp;Save</button>
        </div>
      </div>`;
    $('#pzName').focus();
    $('#pzName').select();
    const close = () => { root.innerHTML = ''; root.style.pointerEvents = 'none'; };
    $('#pzCancel').onclick = () => { A.sfx('button'); close(); };
    $('#pzName').addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep game shortcuts out of the input
      if (e.key === 'Enter') $('#pzSave').click();
      if (e.key === 'Escape') $('#pzCancel').click();
    });
    $('#pzSave').onclick = () => {
      const name = ($('#pzName').value.trim() || defaultName).slice(0, 24);
      const strip = p => { const q = Object.assign({}, p); delete q._plucked; return q; };
      if (editing) {
        editing.name = name;
        editing.fixed = fixed.map(strip);
        editing.plucked = plucked.map(strip);
        delete save.puzzleWins[editing.id]; // the puzzle changed: solve it again!
      } else {
        const id = 'pz' + Date.now();
        save.myPuzzles.push({ id, name, fixed: fixed.map(strip), plucked: plucked.map(strip) });
        save.puzzleSeq++;
        S.editingPuzzleId = id; // further saves in this session update it
      }
      persist();
      close();
      exitPluckMode(true); // keep the 🧩 marks visible: the scene still IS the puzzle
      A.sfx('win');
      R.fx.confetti(640, 300, 40);
      setLory('cheer', editing ? `"${name}" is updated! 🧩` : `"${name}" is saved! Find it under Pick-a-puzzle. 🧩`, 6);
    };
  }

  // ---------------------------------------------------------------------------
  // puzzle sharing: links + .lorypuzzle files (wire format in core puzzleCode)
  // ---------------------------------------------------------------------------
  let pzSeq = 0;
  const puzzleId = () => 'pz' + Date.now().toString(36) + (pzSeq++).toString(36);

  function importPuzzles(list) {
    const have = new Set();
    for (const q of save.myPuzzles) {
      try { have.add(Core.puzzleCode.canonical(q)); } catch (e) { /* legacy oddity: never block imports */ }
    }
    let added = 0, dupes = 0;
    for (const pz of list) {
      const canon = Core.puzzleCode.canonical(pz);
      if (have.has(canon)) { dupes++; continue; }
      have.add(canon);
      const rec = { id: puzzleId(), name: pz.name, fixed: pz.fixed, plucked: pz.plucked };
      if (pz.by) rec.by = pz.by;
      save.myPuzzles.push(rec);
      added++;
    }
    if (added) persist();
    if (S.screen === 'levels') showLevelSelect();
    return { added, dupes };
  }

  function adviseSolvability(pz) {
    // the author's layout is the solution; if physics evolved since it was
    // made it may no longer win — kids deserve a heads-up, not a rejection
    setTimeout(() => {
      try {
        const r = Core.simulate({ goalType: 'catch', fixed: pz.fixed }, pz.plucked, { maxSeconds: 30 });
        if (!r.won) setLory('think', `Hmm, "${pz.name}" plays differently in this version of the game — it might need a little fix!`, 8);
      } catch (e) { /* advice must never break an import */ }
    }, 50);
  }

  function checkSharedPuzzle() {
    const m = /[#&]pz=(LORY\d+\.[A-Za-z0-9\-_]+)/.exec(location.hash || '');
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    Core.puzzleCode.decode(m[1]).then(offerSharedPuzzle, (e) => {
      toast(e.message === 'newer-version'
        ? 'This puzzle needs a newer Lory’s Lab — reload the game to update!'
        : 'Hmm, this puzzle link looks broken!', 5);
    });
  }

  function offerSharedPuzzle(pz) {
    if ($('#pzOfferYes')) return; // one offer at a time
    const root = $('.overlay-root');
    root.style.pointerEvents = 'auto';
    root.innerHTML = `
      <div class="dim-bg"></div>
      <div class="wincard namecard">
        <h2>🧩 A puzzle for you!</h2>
        <p id="pzOfferName" style="text-align:center;font-weight:800;margin:6px 0 18px"></p>
        <div class="row">
          <button class="big blue" id="pzOfferNo">✕&ensp;Not now</button>
          <button class="big leaf" id="pzOfferYes">➕&ensp;Keep it</button>
        </div>
      </div>`;
    $('#pzOfferName').textContent = pz.by ? `“${pz.name}” by ${pz.by}` : `“${pz.name}”`;
    // closing a dialog = re-rendering the screen it covered: showScreen owns
    // BOTH the overlay content and its pointer-events (a bare innerHTML=''
    // + pointerEvents='none' left the levels screen unclickable)
    const close = () => showScreen(S.screen);
    $('#pzOfferNo').onclick = () => { A.sfx('button'); close(); };
    $('#pzOfferYes').onclick = () => {
      const r = importPuzzles([pz]);
      if (r.added) {
        A.sfx('win');
        toast(`“${pz.name}” is in 🧩 My puzzles!`, 4);
        adviseSolvability(pz);
        save.mode = save.mode || 'sprout'; // a share link may be someone's first visit
        persist();
      } else {
        A.sfx('button');
        toast('You already have this one!', 4);
      }
      if (S.screen === 'title') showScreen('levels'); else close();
    };
  }

  function shareUrl(code) {
    const base = location.origin && location.origin !== 'null' ? location.origin + location.pathname : '';
    return base + '#pz=' + code;
  }

  async function sharePuzzleDialog(p) {
    let code;
    try { code = await Core.puzzleCode.encode(p); }
    catch (e) { toast('This puzzle cannot be shared — try re-saving it!', 5); return; }
    const url = shareUrl(code);
    const root = $('.overlay-root');
    root.style.pointerEvents = 'auto';
    root.innerHTML = `
      <div class="dim-bg" id="pzShareDim"></div>
      <div class="wincard namecard">
        <button class="modal-x" id="pzShareClose" title="Close">✕</button>
        <h2>📤 Share!</h2>
        <p class="pz-share-name" id="pzShareName"></p>
        <input id="pzLink" readonly>
        <div class="row wrap">
          ${navigator.share ? '<button class="chip btn labeled" id="pzShareNative">📱 Share</button>' : ''}
          <button class="chip btn labeled" id="pzCopy">🔗 Copy link</button>
          <button class="chip btn labeled" id="pzFile">📦 To file</button>
        </div>
      </div>`;
    $('#pzShareName').textContent = `“${p.name}”`;
    $('#pzLink').value = url;
    const onEsc = (e) => { if (e.key === 'Escape') { A.sfx('button'); close(); } };
    const close = () => {
      document.removeEventListener('keydown', onEsc);
      showScreen(S.screen); // restores content AND pointer-events together
    };
    document.addEventListener('keydown', onEsc);
    $('#pzShareClose').onclick = () => { A.sfx('button'); close(); };
    $('#pzShareDim').onclick = () => { A.sfx('button'); close(); };
    $('#pzCopy').onclick = async () => {
      A.sfx('button');
      try { await navigator.clipboard.writeText(url); toast('Link copied! Send it to a friend 🧡', 4); }
      catch (e) { $('#pzLink').focus(); $('#pzLink').select(); toast('Press Ctrl/Cmd+C to copy the link!', 4); }
    };
    const sn = $('#pzShareNative');
    if (sn) sn.onclick = async () => {
      A.sfx('button');
      try { await navigator.share({ title: `Lory’s Lab — ${p.name}`, text: `Play “${p.name}” in Lory’s Lab!`, url }); close(); }
      catch (e) { /* share sheet dismissed */ }
    };
    $('#pzFile').onclick = () => {
      A.sfx('button');
      downloadPuzzleFile(`# Lory's Lab puzzle — open the game, press 📥 and pick this file\n# ${p.name}\n${code}\n`, p.name);
    };
  }

  function downloadPuzzleFile(text, name) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const slug = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'puzzle';
    a.download = slug + '.lorypuzzle';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Saved! Keep it somewhere safe 📦', 4);
  }

  async function backupAllPuzzles() {
    if (!save.myPuzzles.length) return;
    const out = ["# Lory's Lab puzzles — open the game, press 📥 and pick this file"];
    let skipped = 0;
    for (const p of save.myPuzzles) {
      try { const c = await Core.puzzleCode.encode(p); out.push('# ' + p.name, c); }
      catch (e) { skipped++; }
    }
    downloadPuzzleFile(out.join('\n') + '\n', 'lorys-lab-puzzles');
    if (skipped) setLory('think', `${skipped} puzzle${skipped > 1 ? 's' : ''} couldn't be packed — that's odd!`, 6);
  }

  function openPuzzleFilePicker() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.lorypuzzle,.txt,text/plain';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const text = await f.text();
      const codes = (text.match(/LORY\d+\.[A-Za-z0-9\-_]+/g) || []).slice(0, 200);
      const decoded = [];
      let broken = 0;
      for (const c of codes) {
        try { decoded.push(await Core.puzzleCode.decode(c)); } catch (e) { broken++; }
      }
      if (!decoded.length && !broken) { toast('No puzzles found in that file!', 4); return; }
      const r = importPuzzles(decoded);
      A.sfx(r.added ? 'win' : 'button');
      toast(r.added
        ? `Added ${r.added} puzzle${r.added > 1 ? 's' : ''}!${r.dupes ? ' (' + r.dupes + ' you already had)' : ''}`
        : (r.dupes ? 'You already have all of those!' : 'No puzzles found in that file!'), 5);
      if (broken) setLory('think', `${broken} puzzle${broken > 1 ? 's' : ''} in the file couldn't be read — maybe from a newer Lory's Lab?`, 6);
    };
    inp.click();
  }

  function onHint() {
    if (S.sandbox || S.phase !== 'edit') return;
    const L = currentLevel();
    const limit = save.mode === 'whiz' ? 2 : Infinity;
    if (S.hintsUsed >= limit) { setLory('think', "I already told you my best idea! You can do it!", 4); return; }
    S.hintsUsed++;
    A.sfx('button');
    S.hints = L.solution.map(s => Object.assign({}, s));
    S.hintTimer = 8;
    setLory('think', L.hintText, 8);
  }

  // ---------------------------------------------------------------------------
  // run control
  // ---------------------------------------------------------------------------
  function cancelDrag() {
    // return an in-flight drag safely (Space/Play pressed mid-drag, etc.)
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    if (d.from === 'tray') { const t = trayItem(d.spec.type); if (t) t.count++; }
    else S.placements.push(d.origSpec);
  }

  function startLoops() {
    for (const p of S.sim.parts) {
      const m = p.bodies[0].plugin.lab;
      // the fan hum is event-driven (fan_on/fan_off, like hydrant water);
      // here we only catch up fans ALREADY running — needed when sfx is
      // re-enabled mid-run, after their fan_on already fired
      if (p.spec.type === 'fan' && m.fanWas) A.startLoop('fan');
      if (p.spec.type === 'conveyor') A.startLoop('conveyor');
    }
  }

  function startRun() {
    if (S.phase === 'run' || S.phase === 'won') return;
    if (S.pluckMode) { toast('Press "💾 Save puzzle" to finish, or ✕ to go back to building!', 4); return; }
    cancelDrag();
    S.phase = 'run';
    S.selection = null; S.hints = null;
    rebuildSim();
    R.resetFx();
    A.sfx('play');
    setLory('idle', null);
    S.lory.say = null;
    startLoops();
    $('#playBtn').textContent = '◼';
    $('#playBtn').classList.add('running');
  }

  function stopRun(manual) {
    stopLoops();
    if (S.winTimer) { clearTimeout(S.winTimer); S.winTimer = null; }
    if (S.phase === 'run' || S.phase === 'won') {
      S.phase = 'edit';
      rebuildSim();
      if (manual) A.sfx('button');
    }
    $('#playBtn').textContent = '▶';
    $('#playBtn').classList.remove('running');
  }

  function stopLoops() {
    // force-stop everything regardless of refcounts: a run ending always ends
    // all ambient sound (multiple awake magnets would otherwise leak hums)
    A.stopAllLoops();
  }

  function onWin() {
    const sparkles = S.sim.state.sparkles;
    const stars = Math.max(1, sparkles);
    const gp = goalPos();
    R.fx.confetti(gp.x, gp.y - 40, 80);
    if (currentLevel().goalType === 'catch') A.sfx('catch');
    // (the fanfare itself is played by the core 'win' event via handleEvents)
    setLory('cheer', null);
    if (S.puzzle) {
      S.phase = 'won';
      stopLoops();
      save.puzzleWins[S.puzzle.id] = true;
      persist();
      S.winTimer = setTimeout(() => {
        S.winTimer = null;
        // a puzzle that carries author-placed sparkles earns real stars
        if (S.phase === 'won') showWinOverlay(stars, S.sim.state.sparkleTotal === 0);
      }, 1400);
      $('#playBtn').textContent = '▶';
      $('#playBtn').classList.remove('running');
    } else if (!S.sandbox) {
      S.phase = 'won';
      stopLoops();
      const prev = save.progress[S.levelIndex];
      if (!prev || prev.stars < stars) save.progress[S.levelIndex] = { stars };
      persist();
      S.winTimer = setTimeout(() => {
        S.winTimer = null;
        if (S.phase === 'won') showWinOverlay(stars);
      }, 1400);
      $('#playBtn').textContent = '▶';
      $('#playBtn').classList.remove('running');
    } else {
      toast('Hooray! 🎉');
      // sandbox: keep running (ambient loops and the ◼ button stay as-is),
      // just prevent an instant re-win
      S.sim.state.won = false;
      S.sim.state.caughtFrames = -1e9;
      S.sim.state.bellRung = false;
      setTimeout(() => setLory('idle'), 2500);
    }
  }

  function onStuck() {
    S.failCount++;
    A.sfx('lose');
    setLory('oops', ["Hmm, not quite! Try moving something.", "So close! Maybe tilt it differently?", "Almost! Machines take a few tries."][Math.min(S.failCount - 1, 2)], 5);
    stopRun();
    if (!S.sandbox) {
      if (save.mode === 'sprout' && S.failCount === 2) {
        onHint(); S.hintsUsed = 0; // free auto-hint for little inventors
      }
      if (S.failCount >= 3) toast('Stuck? The 💡 button shows Lory’s idea!', 4);
      if (S.failCount >= 4 && !S.puzzle) offerSkip(); // skip is campaign-only
    }
  }

  function offerSkip() {
    if ($('#skipBtn')) return;
    const b = el('button', 'chip btn', 'Skip ➜');
    b.id = 'skipBtn';
    const forLevel = S.levelIndex; // a stale button must never skip a different level
    b.onclick = () => {
      b.remove();
      if (S.levelIndex !== forLevel || S.sandbox) return;
      save.progress[forLevel] = save.progress[forLevel] || { stars: 0, skipped: true };
      persist(); A.sfx('button');
      if (forLevel < LEVELS.length - 1) enterLevel(forLevel + 1, false);
      else { stopRun(); showScreen('levels'); }
    };
    $('.topbar').insertBefore(b, $('#hintBtn'));
    setTimeout(() => b.remove(), 15000);
  }

  function goalPos() {
    const L = currentLevel();
    const g = (L.fixed || []).find(f => f.type === 'bowl' || f.type === 'bell')
      || S.placements.find(f => f.type === 'bowl' || f.type === 'bell')
      || { x: APP_W / 2, y: 300 };
    return g;
  }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------
  let cv, scale = 1;
  function canvasPos(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (viewW / r.width), y: (e.clientY - r.top) * ((R.BOARD_H + R.TRAY_H) / r.height) };
  }

  // ---------------------------------------------------------------------------
  // camera (Tier-2 mobile): a view transform over the BOARD only. Two fingers
  // pinch-zoom (1..2.5x) and pan; the tray, top bar, and dialogs stay fixed.
  // Pure presentation — physics and placements live in board coords as always.
  // ---------------------------------------------------------------------------
  const cam = { z: 1, x: 0, y: 0 };
  function clampCam() {
    cam.z = Math.min(2.5, Math.max(1, cam.z));
    if (cam.z < 1.04) cam.z = 1; // snap: pinching out lands exactly on 1x
    cam.x = Math.min(0, Math.max(APP_W * (1 - cam.z), cam.x));
    cam.y = Math.min(0, Math.max(R.BOARD_H * (1 - cam.z), cam.y));
    if (cam.z === 1) { cam.x = 0; cam.y = 0; }
  }
  function resetCam() { cam.z = 1; cam.x = 0; cam.y = 0; }
  // canvas point -> board point (tray coords are canvas coords, unaffected).
  // boardOX() centers the 1280px board inside the full-bleed canvas.
  function toBoard(pt) { return { x: (pt.x - boardOX() - cam.x) / cam.z, y: (pt.y - cam.y) / cam.z }; }

  const activePtrs = new Map(); // pointerId -> last canvas pos
  let pinch = null;             // {ids:[a,b], d0, mid0, cam0}

  function hitPlacement(pt) {
    // topmost (last) placement whose body contains the point (with padding);
    // sensors are invisible helper zones — except fuse and sparkle, whose
    // ONLY body is a sensor: they must stay tappable or can't be edited
    const bodies = S.sim.bodies().filter(b => b.plugin.lab && b.plugin.lab.placed
      && (!b.isSensor || b.plugin.lab.type === 'fuse' || b.plugin.lab.type === 'sparkle'));
    const hits = Core.Matter.Query.point(bodies, pt);
    let body = hits[hits.length - 1];
    if (!body) {
      // generous radius for small parts (kids!) — wider still on phones
      let best = null, bd = 30 * uiBoost;
      for (const b of bodies) {
        const d = Math.hypot(b.position.x - pt.x, b.position.y - pt.y) - Math.min(30, Math.max(b.plugin.lab.w || 0, (b.plugin.lab.r || 0) * 2) / 2);
        if (d < bd) { bd = d; best = b; }
      }
      body = best;
    }
    if (!body) return -1;
    // createSim stores a copy of each placement spec, so match by value
    const s = body.plugin.lab.spec;
    return S.placements.findIndex(p =>
      p.type === s.type && p.x === s.x && p.y === s.y &&
      (p.angle || 0) === (s.angle || 0) && (p.dir || null) === (s.dir || null));
  }

  function onPointerDown(e) {
    A.unlock();
    if (window.LoryAudio && save.music && !onPointerDown._m) { window.LoryAudio.setMusicEnabled(true); onPointerDown._m = true; }
    if (S.screen !== 'game') return;
    const pt = canvasPos(e);
    cv.setPointerCapture(e.pointerId);
    activePtrs.set(e.pointerId, pt);

    // two fingers on the board = pinch zoom/pan; works in every phase and
    // takes over from a one-finger drag (which is safely refunded)
    if (activePtrs.size === 2 && !pinch) {
      const [a, b] = [...activePtrs.values()];
      if (a.y < R.BOARD_H && b.y < R.BOARD_H) {
        cancelDrag();
        pinch = {
          ids: [...activePtrs.keys()],
          d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)),
          mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          cam0: { z: cam.z, x: cam.x, y: cam.y },
        };
        return;
      }
    }
    if (pinch) return;

    // Lory's bubble is drawn topmost, so its ✕ wins the tap — and works in
    // every phase: kids shouldn't have to wait out the say-timer mid-run
    if (S.bubbleClose && S.lory.say) {
      const bp = toBoard(pt);
      if (Math.hypot(bp.x - S.bubbleClose.x, bp.y - S.bubbleClose.y) <= S.bubbleClose.r) {
        S.lory.say = null; S.lory.sayTimer = 0;
        if (S.lory.pose !== 'cheer') S.lory.pose = 'idle';
        A.sfx('button');
        return;
      }
    }

    if (S.phase === 'run' || S.phase === 'won') return;
    if (S.drag) return; // one drag at a time: a second finger must not steal it

    const bpt = toBoard(pt);

    // puzzle-making: taps just toggle parts in/out of the future tray
    if (S.pluckMode) {
      if (pt.y > R.BOARD_H - 6) return;
      const idx = hitPlacement(bpt);
      if (idx >= 0) {
        const p = S.placements[idx];
        if (p.type === 'sparkle') { toast('Stars stay in the scene — the player collects them!', 3); return; }
        p._plucked = !p._plucked;
        A.sfx(p._plucked ? 'pickup' : 'place');
        R.fx.poof(p.x, p.y, 4);
        rebuildSim();
      }
      return;
    }

    // selection buttons (drawn under the camera -> hit-test in board coords)
    for (const b of S.selButtons || []) {
      if (Math.hypot(bpt.x - b.x, bpt.y - b.y) <= b.r) {
        if (b.id === 'rotl') rotateSelection(-1);
        if (b.id === 'rotr') rotateSelection(1);
        if (b.id === 'flip') flipSelection();
        if (b.id === 'lit') toggleLitSelection();
        if (b.id === 'pluck') togglePluckSelection();
        if (b.id === 'info') showPartInfo();
        if (b.id === 'del') { A.sfx('pickup'); removePlacement(S.selection); }
        return;
      }
    }
    // tray wells (tray is outside the camera: canvas coords)
    if (pt.y > R.BOARD_H - 6) {
      // ‹ › page buttons first — they sit at the tray's ends
      for (const ar of S.trayArrows || []) {
        if (Math.hypot(pt.x - ar.x, pt.y - ar.y) <= ar.r) {
          S.trayPage = Math.max(0, Math.min(S.trayPages - 1, S.trayPage + (ar.id === 'next' ? 1 : -1)));
          A.sfx('button');
          return;
        }
      }
      for (const w of S.wells || []) {
        if (Math.abs(pt.x - w.x) < w.w / 2 && w.count > 0) {
          const defs = Core.PART_DEFS[w.type];
          const spec = { type: w.type, x: Math.round(bpt.x), y: Math.round(bpt.y) };
          if (defs.dir) spec.dir = defs.dir[0];
          if (w.type === 'laser') spec.angle = 90;  // out of the tray it fires sideways, not up
          if (w.type === 'cannon') spec.angle = 45; // out of the tray it aims a jaunty 45° up
          trayItem(w.type).count--;
          S.drag = { spec, from: 'tray', invalid: true, pointerId: e.pointerId };
          S.selection = null;
          A.sfx('pickup');
          return;
        }
      }
      // tapping an empty well: give feedback instead of dead silence
      for (const w of S.wells || []) {
        if (Math.abs(pt.x - w.x) < w.w / 2 && w.count === 0) {
          A.sfx('invalid');
          toast('All used up! Move the one on the board.');
          return;
        }
      }
      return;
    }
    // board part
    const idx = hitPlacement(bpt);
    if (idx >= 0) {
      const spec = S.placements[idx];
      S.selection = idx;
      const orig = Object.assign({}, spec);
      S.placements.splice(idx, 1);
      S.selection = null;
      rebuildSim();
      S.drag = { spec, from: 'board', origSpec: orig, invalid: false, grabDx: spec.x - bpt.x, grabDy: spec.y - bpt.y, pointerId: e.pointerId };
      A.sfx('pickup');
      return;
    }
    S.selection = null;
  }

  function onPointerMove(e) {
    const pt = canvasPos(e);
    if (activePtrs.has(e.pointerId)) activePtrs.set(e.pointerId, pt);
    if (pinch) {
      if (!pinch.ids.includes(e.pointerId)) return;
      const a = activePtrs.get(pinch.ids[0]), b = activePtrs.get(pinch.ids[1]);
      if (!a || !b) return;
      const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = pinch.cam0.z * (d / pinch.d0);
      // keep the board point that was under the fingers anchored to them
      const ox = boardOX();
      const bx = (pinch.mid0.x - ox - pinch.cam0.x) / pinch.cam0.z;
      const by = (pinch.mid0.y - pinch.cam0.y) / pinch.cam0.z;
      cam.z = z;
      cam.x = mid.x - ox - bx * cam.z;
      cam.y = mid.y - by * cam.z;
      clampCam();
      return;
    }
    if (!S.drag || e.pointerId !== S.drag.pointerId) return;
    const d = S.drag;
    const bpt = toBoard(pt);
    d.spec.x = Math.round(bpt.x + (d.grabDx || 0));
    d.spec.y = Math.round(bpt.y + (d.grabDy || 0));
    d.overTray = pt.y > R.BOARD_H - 10;
    d.invalid = d.overTray ? true : specInvalid(d.spec);
  }

  function onPointerUp(e) {
    activePtrs.delete(e.pointerId);
    if (pinch && pinch.ids.includes(e.pointerId)) { pinch = null; return; }
    if (!S.drag || e.pointerId !== S.drag.pointerId) return;
    const d = S.drag;
    S.drag = null;
    if (d.overTray) { // return to tray
      const t = trayItem(d.spec.type); if (t) t.count++;
      R.fx.poof(d.spec.x, d.spec.y, 4);
      A.sfx('place');
      rebuildSim();
      return;
    }
    let spec = d.spec;
    if (d.invalid) {
      const near = findNearestValid(d.spec);
      if (near) spec = near;
      else {
        // nowhere sensible nearby: tray parts go home, board parts stay put
        if (d.from === 'tray') {
          const t = trayItem(d.spec.type); if (t) t.count++;
          toast("That spot's too crowded!");
        } else {
          S.placements.push(d.origSpec);
          rebuildSim();
          S.selection = S.placements.length - 1;
        }
        A.sfx('invalid');
        return;
      }
    }
    commitPlacement(spec);
    S.selection = S.placements.length - 1;
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (S.screen === 'levels' && (e.key === 'l' || e.key === 'L')) { secretTick(); return; }
    if (S.screen !== 'game' || S.phase !== 'edit') return;
    if (e.key === 'r' || e.key === 'R') rotateSelection(e.shiftKey ? -1 : 1);
    if (e.key === 'f' || e.key === 'F') flipSelection();
    if (e.key === 'Delete' || e.key === 'Backspace') { if (S.selection != null && S.selection >= 0) removePlacement(S.selection); }
    if (e.key === 'Escape') S.selection = null;
    if (e.key === ' ') { e.preventDefault(); startRun(); }
  }

  // ---------------------------------------------------------------------------
  // main loop
  // ---------------------------------------------------------------------------
  function frame(ts) {
    requestAnimationFrame(frame);
    const dtMs = Math.min(50, ts - (S.lastTs || ts));
    S.lastTs = ts;
    S.t += dtMs / 1000;

    // title screen mascot
    if (S.screen === 'title') {
      const tc = $('#titleLory');
      if (tc) {
        const c = tc.getContext('2d');
        c.clearRect(0, 0, 260, 260);
        c.save(); c.scale(2.4, 2.4); c.translate(4, 6);
        R.drawLory(c, 'idle', S.t);
        c.restore();
      }
      return;
    }
    if (S.screen !== 'game') {
      const wc = $('#winLory');
      if (wc) {
        const c = wc.getContext('2d');
        c.clearRect(0, 0, 200, 200);
        c.save(); c.scale(1.9, 1.9); c.translate(2, 4); R.drawLory(c, 'cheer', S.t); c.restore();
      }
      return;
    }

    // win overlay mascot (game screen, phase won)
    const wc = $('#winLory');
    if (wc) {
      const c = wc.getContext('2d');
      c.clearRect(0, 0, 200, 200);
      c.save(); c.scale(1.9, 1.9); c.translate(2, 4); R.drawLory(c, 'cheer', S.t); c.restore();
    }

    // physics stepping
    if (S.phase === 'run') {
      S.runAcc += dtMs;
      let steps = 0;
      while (S.runAcc >= 1000 / 60 && steps < 3) {
        S.runAcc -= 1000 / 60;
        steps++;
        const events = S.sim.step();
        if (events.length) {
          A.handleEvents(events);
          R.handleEvents(events, S.sim);
          for (const ev of events) {
            if (ev.type === 'sparkle') updateStarChip();
            if (ev.type === 'bell' && S.sandbox) { R.fx.confetti(ev.x, ev.y, 30); }
          }
        }
        if (S.sim.state.won) { onWin(); break; }
        if (S.sandbox) {
          // sandbox autostop: nothing has moved for ~1.5s — the show is over
          if (S.sim.state.quietFrames >= 90) { stopRun(true); break; }
        } else if (S.sim.state.settled || S.sim.state.t > 45) { onStuck(); break; }
      }
      if (S.runAcc > 100) S.runAcc = 0;
    }

    // lory bubble timer
    if (S.lory.sayTimer > 0) {
      S.lory.sayTimer -= dtMs / 1000;
      if (S.lory.sayTimer <= 0) { S.lory.say = null; if (S.lory.pose !== 'cheer') S.lory.pose = 'idle'; }
    }
    if (S.hintTimer > 0) { S.hintTimer -= dtMs / 1000; if (S.hintTimer <= 0) S.hints = null; }

    // draw
    const sel = S.selection != null && S.selection >= 0 ? S.placements[S.selection] : null;
    const out = R.draw({
      sim: S.sim,
      running: S.phase === 'run',
      t: S.t, dt: dtMs / 1000,
      selection: S.phase === 'edit' ? sel : null,
      sandbox: S.sandbox, // selection UI adds the 🧩/📌 puzzle-mark toggle
      dragGhost: S.drag ? Object.assign({ invalid: S.drag.invalid }, S.drag.spec) : null,
      hints: S.hints,
      tray: S.trayStock,
      trayPage: S.trayPage,
      lory: S.lory,
      uiBoost,
      cam,
    });
    S.selButtons = out.selButtons || [];
    S.bubbleClose = out.bubbleClose || null;
    S.wells = out.wells || [];
    S.trayArrows = out.trayArrows || [];
    S.trayPages = out.trayPages || 1;
    S.trayPage = out.trayPage || 0; // render clamps when the layout changes
  }

  // ---------------------------------------------------------------------------
  // layout scale
  // ---------------------------------------------------------------------------
  let appScale = 1, uiBoost = 1, viewW = APP_W;
  const boardOX = () => (viewW - APP_W) / 2;
  function layout() {
    const app = $('#app');
    // visualViewport tracks iOS Safari's collapsing bars; innerHeight lags it
    const vw = (window.visualViewport && window.visualViewport.width) || window.innerWidth;
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const sw = vw / APP_W, sh = vh / APP_H;
    if (sw <= sh) {
      // width-limited (desktop-ish window): classic centered board
      appScale = sw;
      viewW = APP_W;
    } else {
      // height-limited (phones/wide screens): full-bleed — widen the room so
      // the canvas fills the screen; the 1280px board stays centered in it
      appScale = sh;
      viewW = Math.min(2100, Math.floor(vw / appScale));
    }
    app.style.width = viewW + 'px';
    R.setView(viewW);
    app.style.transform = `translate(-50%, -50%) scale(${appScale})`;
    // Touch-target compensation: on small screens (phones) draw UI bigger so
    // physical tap sizes stay usable. 1 on desktop/iPad, up to 1.7 on phones.
    uiBoost = Math.max(1, Math.min(1.7, 0.75 / appScale));
    document.documentElement.style.setProperty('--uiboost', uiBoost);
    // Portrait nudge (touch devices only — desktop narrow windows are fine)
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const portrait = vh > vw;
    const ro = $('#rotateOverlay');
    if (ro) ro.style.display = (coarse && portrait) ? 'flex' : 'none';
  }

  // ---------------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------------
  function boot() {
    cv = $('#game');
    R.init(cv);
    buildDom();
    layout();
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 120));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    cv.addEventListener('pointerup', onPointerUp);
    cv.addEventListener('pointercancel', onPointerUp);
    let wheelTrayAcc = 0;
    cv.addEventListener('wheel', (e) => {
      if (S.screen !== 'game') return;
      // trackpad pinch / ctrl+scroll = camera zoom around the cursor
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const pt = canvasPos(e);
        if (pt.y >= R.BOARD_H) return;
        const b = toBoard(pt);
        cam.z = cam.z * (e.deltaY > 0 ? 0.93 : 1.075);
        cam.x = pt.x - boardOX() - b.x * cam.z;
        cam.y = pt.y - b.y * cam.z;
        clampCam();
        return;
      }
      // wheel over the tray flips its pages (desktop nicety; ‹ › do the rest)
      if (S.trayPages > 1 && canvasPos(e).y > R.BOARD_H - 6) {
        e.preventDefault();
        wheelTrayAcc += (e.deltaY || e.deltaX);
        if (Math.abs(wheelTrayAcc) > 40) {
          S.trayPage = Math.max(0, Math.min(S.trayPages - 1, S.trayPage + (wheelTrayAcc > 0 ? 1 : -1)));
          wheelTrayAcc = 0;
        }
        return;
      }
      // plain wheel over a selected part rotates it
      if (S.phase !== 'edit' || S.selection == null || S.selection < 0) return;
      e.preventDefault();
      const p = S.placements[S.selection];
      const defs = p && Core.PART_DEFS[p.type];
      if (!defs || !defs.rot) return;
      if (p.type === 'cannon') p.angle = Math.max(0, Math.min(75, (p.angle || 0) + (e.deltaY > 0 ? 5 : -5)));
      else p.angle = ((p.angle || 0) + (e.deltaY > 0 ? 5 : -5) + 360) % 360;
      rebuildSim();
      A.sfx('rotate');
    }, { passive: false });
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', function unlockOnce() {
      A.unlock();
      A.setSfx(save.sfx);
      if (save.music) A.setMusic(true);
      document.removeEventListener('pointerdown', unlockOnce);
    }, { once: false, capture: true });
    S.sim = Core.createSim({ fixed: [], sparkles: [] }, []);
    showScreen('title');
    checkSharedPuzzle(); // a #pz=LORY… link opened the game: offer the puzzle
    window.addEventListener('hashchange', checkSharedPuzzle);
    requestAnimationFrame(frame);
  }

  // tiny read-only debug handle (used by automated tests)
  window.__loryDebug = {
    get state() { return { screen: S.screen, phase: S.phase, selection: S.selection, placements: S.placements.map(p => Object.assign({}, p)), tray: S.trayStock.map(t => Object.assign({}, t)), hints: S.hints ? S.hints.length : 0, trayPage: S.trayPage, trayPages: S.trayPages, wellsVisible: (S.wells || []).length, cam: Object.assign({}, cam), viewW, ox: boardOX() }; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

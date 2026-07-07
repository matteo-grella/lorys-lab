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
    ['ball_beach', 3], ['ball_marble', 3], ['berry', 3], ['bowl', 1], ['bell', 1],
    ['balloon_goal', 4], ['spikes', 2],
  ];

  function currentLevel() {
    if (S.puzzle) {
      const counts = {};
      for (const p of S.puzzle.plucked) counts[p.type] = (counts[p.type] || 0) + 1;
      return {
        title: S.puzzle.name, goalType: 'catch', goalText: 'Feed Lory the berry!',
        fixed: S.puzzle.fixed, sparkles: [], solution: [], hintText: '',
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
    setLory('think', `Editing "${p.name}"! Move things around, then press 🧩 and 💾 to save.`, 8);
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
      <button class="chip btn" id="musicBtn" title="Music"></button>
      <button class="chip btn" id="juiceBtn" title="Speed sparkle effects">✨</button>`;
    app.appendChild(bar);

    // play button
    const play = el('button', 'playbtn', '▶');
    play.id = 'playBtn';
    app.appendChild(play);

    // overlay root
    app.appendChild(el('div', 'overlay-root'));
    // toast
    app.appendChild(el('div', 'toast'));

    $('#backBtn').onclick = () => { A.sfx('button'); stopRun(); exitPluckMode(false); showScreen('levels'); };
    $('#hintBtn').onclick = onHint;
    $('#puzzleBtn').onclick = onPuzzleButton;
    $('#pluckExitBtn').onclick = () => { A.sfx('button'); exitPluckMode(false); setLory('idle', null); };
    $('#resetBtn').onclick = () => { A.sfx('button'); stopRun(); exitPluckMode(false); clearPlacements(); };
    $('#sfxBtn').onclick = () => {
      save.sfx = !save.sfx; A.setSfx(save.sfx); persist(); syncAudioBtns(); A.sfx('button');
      if (save.sfx && S.phase === 'run') startLoops(); // re-enable mid-run: bring the hum back
    };
    $('#musicBtn').onclick = () => { save.music = !save.music; A.setMusic(save.music); persist(); syncAudioBtns(); };
    $('#juiceBtn').onclick = () => { save.juice = !save.juice; R.setJuice(save.juice); persist(); syncAudioBtns(); A.sfx('button'); };
    play.onclick = () => { S.phase === 'run' ? stopRun(true) : startRun(); };

    syncAudioBtns();
  }

  function syncAudioBtns() {
    $('#sfxBtn').textContent = save.sfx ? '🔊' : '🔇';
    $('#musicBtn').textContent = save.music ? '🎵' : '𝄽';
    $('#musicBtn').style.opacity = save.music ? 1 : 0.5;
    $('#juiceBtn').style.opacity = save.juice ? 1 : 0.4;
  }

  function updateTopbar() {
    const L = currentLevel();
    const prog = save.progress[S.levelIndex];
    const stars = prog && !S.sandbox && !S.puzzle ? '  ' + '★'.repeat(prog.stars) : '';
    $('#levelChip').textContent = S.puzzle ? `🧩 ${S.puzzle.name}`
      : S.sandbox ? '🎨 Sandbox' : `${S.levelIndex + 1}. ${L.title}${stars}`;
    $('#hintBtn').style.display = (S.sandbox || S.puzzle) ? 'none' : '';
    $('#starChip').style.display = (S.sandbox || S.puzzle) ? 'none' : '';
    $('#puzzleBtn').style.display = S.sandbox ? '' : 'none';
    $('#puzzleBtn').textContent = S.pluckMode ? '💾 Save puzzle' : '🧩 Make puzzle';
    $('#pluckExitBtn').style.display = S.pluckMode ? '' : 'none';
    updateStarChip();
  }
  function updateStarChip() {
    if (S.sandbox || !S.sim) return;
    $('#starChip').textContent = `⭐ ${S.sim.state.sparkles}/3`;
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
        <p class="tag">Build silly machines. Feed the bird. 🍓</p>
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
      <div class="lv-mine" id="mineWrap" style="display:none"><h3>🧩 My puzzles</h3><div class="grid" id="mineGrid"></div></div>
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

    // saved user puzzles
    if (save.myPuzzles.length) {
      $('#mineWrap').style.display = '';
      const mine = $('#mineGrid');
      save.myPuzzles.forEach(p => {
        const card = el('button', 'card mine');
        const solved = save.puzzleWins[p.id] ? '⭐ solved!' : '&nbsp;';
        card.innerHTML = `<div class="num">🧩</div><div class="nm">${p.name.replace(/</g, '&lt;')}</div><div class="stars">${solved}</div><span class="pedit" title="Edit">✎</span><span class="pdel" title="Delete">✕</span>`;
        card.onclick = () => { A.sfx('levelpop'); enterLevel(0, false, p); };
        card.querySelector('.pedit').onclick = (e) => {
          e.stopPropagation();
          A.sfx('button');
          editPuzzleInSandbox(p);
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
    // would sit underneath the DOM button and become ungrabbable
    const half = Math.max(halfW, halfH);
    if (spec.x + half > 1148 && spec.y + half > 592) return true;
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
    p.angle = ((p.angle || 0) + dir * 15 + 360) % 360;
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

  function onHint() {
    if (S.sandbox || S.puzzle || S.phase !== 'edit') return;
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
    for (const p of S.placements.concat(currentLevel().fixed || [])) {
      if (p.type === 'fan') A.startLoop('fan');
      if (p.type === 'conveyor') A.startLoop('conveyor');
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
        if (S.phase === 'won') showWinOverlay(stars, true);
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
    if (!S.sandbox && !S.puzzle) {
      if (save.mode === 'sprout' && S.failCount === 2) {
        onHint(); S.hintsUsed = 0; // free auto-hint for little inventors
      }
      if (S.failCount >= 3) toast('Stuck? The 💡 button shows Lory’s idea!', 4);
      if (S.failCount >= 4) offerSkip();
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
    return { x: (e.clientX - r.left) * (APP_W / r.width), y: (e.clientY - r.top) * ((R.BOARD_H + R.TRAY_H) / r.height) };
  }

  function hitPlacement(pt) {
    // topmost (last) placement whose body contains the point (with padding)
    const bodies = S.sim.bodies().filter(b => b.plugin.lab && b.plugin.lab.placed && !b.isSensor);
    const hits = Core.Matter.Query.point(bodies, pt);
    let body = hits[hits.length - 1];
    if (!body) {
      // generous radius for small parts (kids!)
      let best = null, bd = 30;
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

    if (S.phase === 'run' || S.phase === 'won') return;
    if (S.drag) return; // one drag at a time: a second finger must not steal it

    // puzzle-making: taps just toggle parts in/out of the future tray
    if (S.pluckMode) {
      if (pt.y > R.BOARD_H - 6) return;
      const idx = hitPlacement(pt);
      if (idx >= 0) {
        const p = S.placements[idx];
        p._plucked = !p._plucked;
        A.sfx(p._plucked ? 'pickup' : 'place');
        R.fx.poof(p.x, p.y, 4);
        rebuildSim();
      }
      return;
    }

    // selection buttons
    for (const b of S.selButtons || []) {
      if (Math.hypot(pt.x - b.x, pt.y - b.y) <= b.r) {
        if (b.id === 'rotl') rotateSelection(-1);
        if (b.id === 'rotr') rotateSelection(1);
        if (b.id === 'flip') flipSelection();
        if (b.id === 'del') { A.sfx('pickup'); removePlacement(S.selection); }
        return;
      }
    }
    // tray wells
    if (pt.y > R.BOARD_H - 6) {
      for (const w of S.wells || []) {
        if (Math.abs(pt.x - w.x) < w.w / 2 && w.count > 0) {
          const defs = Core.PART_DEFS[w.type];
          const spec = { type: w.type, x: pt.x, y: pt.y };
          if (defs.dir) spec.dir = defs.dir[0];
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
    const idx = hitPlacement(pt);
    if (idx >= 0) {
      const spec = S.placements[idx];
      if (S.selection === idx) {
        // second touch starts drag
      }
      S.selection = idx;
      const orig = Object.assign({}, spec);
      S.placements.splice(idx, 1);
      S.selection = null;
      rebuildSim();
      S.drag = { spec, from: 'board', origSpec: orig, invalid: false, grabDx: spec.x - pt.x, grabDy: spec.y - pt.y, pointerId: e.pointerId };
      A.sfx('pickup');
      return;
    }
    S.selection = null;
  }

  function onPointerMove(e) {
    if (!S.drag || e.pointerId !== S.drag.pointerId) return;
    const pt = canvasPos(e);
    const d = S.drag;
    d.spec.x = Math.round(pt.x + (d.grabDx || 0));
    d.spec.y = Math.round(pt.y + (d.grabDy || 0));
    d.overTray = pt.y > R.BOARD_H - 10;
    d.invalid = d.overTray ? true : specInvalid(d.spec);
  }

  function onPointerUp(e) {
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
        // sandbox has no goal: let it run until the player presses stop
        if (!S.sandbox && (S.sim.state.settled || S.sim.state.t > 45)) { onStuck(); break; }
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
      dragGhost: S.drag ? Object.assign({ invalid: S.drag.invalid }, S.drag.spec) : null,
      hints: S.hints,
      tray: S.trayStock,
      lory: S.lory,
    });
    S.selButtons = out.selButtons || [];
    S.wells = out.wells || [];
  }

  // ---------------------------------------------------------------------------
  // layout scale
  // ---------------------------------------------------------------------------
  function layout() {
    const app = $('#app');
    const s = Math.min(window.innerWidth / APP_W, window.innerHeight / APP_H);
    app.style.transform = `translate(-50%, -50%) scale(${s})`;
  }

  // ---------------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------------
  function boot() {
    cv = $('#game');
    R.init(cv);
    R.setJuice(save.juice);
    buildDom();
    layout();
    window.addEventListener('resize', layout);
    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    cv.addEventListener('pointerup', onPointerUp);
    cv.addEventListener('pointercancel', onPointerUp);
    cv.addEventListener('wheel', (e) => { // wheel over selected part rotates it
      if (S.screen !== 'game' || S.phase !== 'edit' || S.selection == null || S.selection < 0) return;
      e.preventDefault();
      const p = S.placements[S.selection];
      const defs = p && Core.PART_DEFS[p.type];
      if (!defs || !defs.rot) return;
      p.angle = ((p.angle || 0) + (e.deltaY > 0 ? 5 : -5) + 360) % 360;
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
    requestAnimationFrame(frame);
  }

  // tiny read-only debug handle (used by automated tests)
  window.__loryDebug = {
    get state() { return { screen: S.screen, phase: S.phase, selection: S.selection, placements: S.placements.map(p => Object.assign({}, p)), tray: S.trayStock.map(t => Object.assign({}, t)) }; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

// Level verification harness: proves every level is (a) not trivially won,
// (b) beatable with its stored solution, (c) has a legal solution placement.
// Run: node test/verify.mjs [levelNumber]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Core = require('../src/core.js');
const LEVELS = require('../src/levels.js');

const only = process.argv[2] ? parseInt(process.argv[2], 10) : null;
let pass = 0, fail = 0;
const failures = [];

for (let i = 0; i < LEVELS.length; i++) {
  if (only && i + 1 !== only) continue;
  const L = LEVELS[i];
  const label = `L${String(i + 1).padStart(2, '0')} ${L.title}`;
  const problems = [];

  // (0) structural checks
  const defs = Core.PART_DEFS;
  for (const f of [...L.fixed, ...L.solution]) {
    if (!defs[f.type]) problems.push(`unknown type ${f.type}`);
    if (f.x < 0 || f.x > 1280 || f.y < 0 || f.y > 720) problems.push(`${f.type} out of bounds (${f.x},${f.y})`);
  }
  const trayCount = {};
  for (const t of L.tray) trayCount[t.type] = (trayCount[t.type] || 0) + t.count;
  const solCount = {};
  for (const s of L.solution) solCount[s.type] = (solCount[s.type] || 0) + 1;
  for (const [ty, n] of Object.entries(solCount)) {
    if ((trayCount[ty] || 0) < n) problems.push(`solution uses ${n}x ${ty} but tray has ${trayCount[ty] || 0}`);
  }
  if ((L.sparkles || []).length !== 3) problems.push(`sparkles=${(L.sparkles || []).length}, want 3`);

  // (a) null test — must NOT self-solve
  const nullRes = Core.simulate(L, [], { maxSeconds: 20 });
  if (nullRes.won) problems.push(`SELF-SOLVES with empty board (t=${nullRes.seconds}s)`);

  // (b) solution legality — each placement must not overlap solids
  {
    const sim = Core.createSim(L, []);
    for (const s of L.solution) {
      if (Core.placementOverlaps(sim, s)) problems.push(`solution ${s.type}@(${s.x},${s.y}) overlaps level furniture`);
    }
  }

  // (c) solution beats the level
  const solRes = Core.simulate(L, L.solution, { maxSeconds: 30 });
  if (!solRes.won) problems.push(`solution DOES NOT WIN (settled=${solRes.settled} t=${solRes.seconds}s)`);
  const sparkNote = solRes.won ? ` sparkles=${solRes.sparkles}/3` : '';

  if (problems.length) {
    fail++;
    failures.push({ level: i + 1, problems });
    console.log(`FAIL  ${label}`);
    for (const p of problems) console.log(`      - ${p}`);
  } else {
    pass++;
    console.log(`PASS  ${label}  (win t=${solRes.seconds}s${sparkNote})`);
  }
}

console.log(`\n${pass}/${pass + fail} levels verified`);
if (failures.length) console.log('Failing levels:', failures.map(f => f.level).join(', '));
process.exit(fail ? 1 : 0);

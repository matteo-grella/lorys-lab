// Puzzle wire-format proofs: roundtrip fidelity + the validator's refusal to
// let anything unvetted reach game state. Run: node test/puzzlecode.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Core = require('../src/core.js');
const PC = Core.puzzleCode;

const results = [];
function check(name, pass, note) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${note ? '  — ' + note : ''}`);
}
async function rejects(name, input, wantMsg) {
  try {
    typeof input === 'string' ? await PC.decode(input) : await PC.encode(input);
    check(name, false, 'accepted!');
  } catch (e) {
    check(name, !wantMsg || e.message === wantMsg, `got ${e.message}`);
  }
}

const GOOD = {
  name: 'Castello di Lorenzo', by: 'L.',
  fixed: [
    { type: 'berry', x: 300, y: 271 },
    { type: 'bowl', x: 900, y: 655 },
    { type: 'shelf', x: 300, y: 300 },
    { type: 'candle', x: 500, y: 661, lit: false },   // cold candle
    { type: 'fan', x: 200, y: 470, dir: 'up' },       // non-default dir
    { type: 'hydrant', x: 700, y: 659 },              // default dir (omitted on wire)
  ],
  plucked: [
    { type: 'plank', x: 400, y: 500, angle: 15 },     // rotated part
    { type: 'laser', x: 800, y: 500, angle: 90 },
  ],
};

// 1. roundtrip: everything that matters survives encode -> decode
{
  const code = await PC.encode(GOOD);
  check('encode emits the current prefix', code.startsWith('LORY1.') || code.startsWith('LORY0.'), code.slice(0, 12));
  check('code is URL-safe', /^LORY\d+\.[A-Za-z0-9\-_]+$/.test(code), `${code.length} chars`);
  const back = await PC.decode(code);
  check('name/by survive', back.name === GOOD.name && back.by === 'L.');
  check('part counts survive', back.fixed.length === 6 && back.plucked.length === 2);
  const cold = back.fixed.find(s => s.type === 'candle');
  const fan = back.fixed.find(s => s.type === 'fan');
  const hyd = back.fixed.find(s => s.type === 'hydrant');
  const plank = back.plucked.find(s => s.type === 'plank');
  check('cold candle survives', cold.lit === false);
  check('non-default dir survives', fan.dir === 'up');
  check('default dir normalizes away (same behaviour)', hyd.dir === undefined);
  check('angle survives', plank.angle === 15 && back.plucked[1].angle === 90);
  check('decoded puzzle simulates (author layout wins nothing here, but runs)',
    typeof Core.simulate({ goalType: 'catch', fixed: back.fixed }, back.plucked, { maxSeconds: 2 }).won === 'boolean');
}

// 2. the LORY0 uncompressed fallback decodes too
{
  const payload = {
    v: 1, name: 'Plain', fixed: [['berry', 100, 100], ['bowl', 900, 655]],
    plucked: [['plank', 400, 500]],
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const back = await PC.decode('LORY0.' + b64);
  check('LORY0 fallback decodes', back.name === 'Plain' && back.plucked.length === 1);
}

// 3. canonical identity: dedupe key is stable across spec/tuple forms
{
  const c1 = PC.canonical(GOOD);
  const c2 = PC.canonical(JSON.parse(JSON.stringify(GOOD)));
  const renamed = Object.assign({}, GOOD, { name: 'Altro nome' });
  check('canonical is stable', c1 === c2);
  check('canonical distinguishes renamed puzzles', PC.canonical(renamed) !== c1);
}

// 4. hostile input: every one of these must be refused
await rejects('garbage prefix', 'HACK1.AAAA', 'bad-format');
await rejects('future format version', 'LORY9.AAAA', 'newer-version');
await rejects('non-base64url payload', 'LORY1.$$$$', 'bad-format');
await rejects('corrupt deflate stream', 'LORY1.AAAAAAAA', 'bad-format');
{
  const mk = async (payload) => 'LORY0.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  const base = { v: 1, name: 'x', fixed: [['berry', 100, 100], ['bowl', 900, 655]], plucked: [['plank', 400, 500]] };
  await rejects('payload v:2', await mk(Object.assign({}, base, { v: 2 })), 'newer-version');
  await rejects('unknown part type', await mk(Object.assign({}, base, { plucked: [['tnt', 400, 500]] })), 'newer-version');
  await rejects('__proto__ as part type', await mk(Object.assign({}, base, { plucked: [['__proto__', 400, 500]] })), 'newer-version');
  await rejects('sparkle smuggled in', await mk(Object.assign({}, base, { plucked: [['sparkle', 400, 500]] })), 'newer-version');
  await rejects('x out of board', await mk(Object.assign({}, base, { plucked: [['plank', 99999, 500]] })), 'bad-data');
  await rejects('non-finite y', await mk(Object.assign({}, base, { plucked: [['plank', 400, null]] })), 'bad-data');
  await rejects('angle on a non-rot part', await mk(Object.assign({}, base, { plucked: [['bumper', 400, 500, 45]] })), 'bad-data');
  await rejects('bogus dir', await mk(Object.assign({}, base, { fixed: [['berry', 100, 100], ['bowl', 900, 655], ['fan', 200, 470, 'down']] })), 'bad-data');
  await rejects('lit=true as extra (must be omitted)', await mk(Object.assign({}, base, { fixed: [['berry', 100, 100], ['bowl', 900, 655], ['candle', 500, 661, true]] })), 'bad-data');
  await rejects('empty plucked (not a puzzle)', await mk(Object.assign({}, base, { plucked: [] })), 'bad-data');
  await rejects('missing berry', await mk({ v: 1, name: 'x', fixed: [['bowl', 900, 655]], plucked: [['plank', 400, 500]] }), 'bad-data');
  await rejects('missing bowl', await mk({ v: 1, name: 'x', fixed: [['berry', 100, 100]], plucked: [['plank', 400, 500]] }), 'bad-data');
  const many = { v: 1, name: 'x', fixed: [['berry', 100, 100], ['bowl', 900, 655]], plucked: Array.from({ length: 101 }, () => ['domino', 400, 500]) };
  await rejects('over the part cap', await mk(many), 'bad-data');
}

// 5. name/author hygiene: control chars stripped, lengths capped
{
  const messy = {
    name: '  Ciao \u0000<b>mondo\u001b</b> questo nome molto lungo  ',
    by: 'Lorenzo il magnifico e altri',
    fixed: [{ type: 'berry', x: 100, y: 100 }, { type: 'bowl', x: 900, y: 655 }],
    plucked: [{ type: 'plank', x: 400, y: 500 }],
  };
  const back = await PC.decode(await PC.encode(messy));
  check('name stripped + capped at 24', back.name.length <= 24 && !/[\u0000-\u001f]/.test(back.name), JSON.stringify(back.name));
  check('by capped at 12', back.by.length <= 12, JSON.stringify(back.by));
}

const fails = results.filter(r => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);

// Structural self-test for src/audio.js — no Web Audio required.
// Loads the plain script with a stubbed window/document (AudioContext undefined)
// and asserts the public API shape plus no-throw behavior before unlock().
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');
const win = {};
const doc = { hidden: false, addEventListener() {} };
new Function('window', 'document', src)(win, doc);

const A = win.LoryAudio;
assert.ok(A, 'window.LoryAudio is defined');

for (const m of ['unlock', 'sfx', 'setSfxEnabled', 'setMusicEnabled', 'sfxEnabled',
  'musicEnabled', 'startLoop', 'stopLoop', 'handleEvents']) {
  assert.equal(typeof A[m], 'function', `LoryAudio.${m} is a function`);
}
assert.ok(A.music && typeof A.music === 'object', 'LoryAudio.music is an object');
assert.equal(typeof A.music.start, 'function', 'music.start is a function');
assert.equal(typeof A.music.stop, 'function', 'music.stop is a function');

assert.equal(A.sfxEnabled(), true, 'sfx enabled by default');
assert.equal(A.musicEnabled(), true, 'music enabled by default');

// Everything below runs before unlock (and with AudioContext undefined): must not throw.
for (const name of ['pickup', 'place', 'rotate', 'invalid', 'play', 'win', 'lose',
  'button', 'levelpop', 'pop', 'bell', 'catch', 'nonexistent']) {
  A.sfx(name);
}
A.sfx('wood', { strength: 0.9 });
A.handleEvents([
  { type: 'hit', impact: 6, matA: 'marble', matB: 'wood' },
  { type: 'hit', impact: 2, matA: 'domino', matB: 'domino' },
  { type: 'hit', impact: 9, matA: 'magnet', matB: 'wood' },
  { type: 'hit', impact: 5, matA: 'rubber', matB: 'berry' },
  { type: 'hit', impact: 4, matA: 'berry', matB: 'wood' },
  { type: 'boing', impact: 10 },
  { type: 'bumper', impact: 5 },
  { type: 'pop' },
  { type: 'bell' },
  { type: 'sparkle', n: 2 },
  { type: 'win' },
  { type: 'magnet_on' },
  { type: 'magnet_off' },
  { type: 'cannon_load' },
  { type: 'cannon_fire' },
  { type: 'cannon_dud' },
  { type: 'cord_pull' },
  { type: 'bridge_down' },
  { type: 'bridge_landed' },
  { type: 'basket' },
  { type: 'unknown_event' },
  null,
]);
A.handleEvents([]);
A.handleEvents(undefined);
A.startLoop('fan'); A.startLoop('fan'); A.startLoop('conveyor'); A.startLoop('bogus');
A.stopLoop('fan'); A.stopLoop('fan'); A.stopLoop('conveyor'); A.stopLoop('magnet');
A.music.start();
A.music.stop();

// unlock() with AudioContext undefined: safe and repeatable.
A.unlock();
A.unlock();
A.sfx('win');
A.music.start(); A.music.stop();

// Enable toggles.
A.setSfxEnabled(false);
assert.equal(A.sfxEnabled(), false, 'sfx can be disabled');
A.sfx('button'); // no-op while disabled
A.setMusicEnabled(false);
assert.equal(A.musicEnabled(), false, 'music can be disabled');
A.setSfxEnabled(true);
A.setMusicEnabled(true);
assert.equal(A.sfxEnabled(), true, 'sfx re-enabled');
assert.equal(A.musicEnabled(), true, 'music re-enabled');

console.log('audio-shape: all assertions passed');

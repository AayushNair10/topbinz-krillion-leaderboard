import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  UserError,
  addPlayer,
  addScores,
  parseScoreList,
  removeEntry,
  resolveDate,
  safe,
  validateConfig,
  validateScores,
  validateWorkflowOptions,
} from '../scripts/lib.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const config = {
  title: 'Test',
  repo: 'owner/repo',
  timezone: 'America/New_York',
  games: [
    { id: 'topbinz', name: 'TopBinz', url: 'https://topbinz.io', maxScore: 1000, modes: [{ id: 'normal', name: 'Normal' }, { id: 'niche', name: 'Niche' }] },
    { id: 'krillion', name: 'Krillion', url: 'https://krillion.io', maxScore: 700, scoreHint: 'Use points, not meters.', modes: [{ id: 'daily', name: 'Daily Dive' }] },
  ],
  players: [
    { id: 'aayush', name: 'Aayush' },
    { id: 'sam-b', name: 'Sam B' },
  ],
};
const empty = { version: 1, entries: [] };
const NOW = new Date('2026-11-18T17:00:00Z'); // noon in New York

const userError = (fn, pattern) => assert.throws(fn, (err) => err instanceof UserError && pattern.test(err.message));

test('the committed data, config and workflow are valid', () => {
  const real = JSON.parse(read('../site/data/config.json'));
  const scores = JSON.parse(read('../site/data/scores.json'));
  assert.deepEqual(validateConfig(real), []);
  assert.deepEqual(validateScores(real, scores, '2099-01-01'), []);
  assert.deepEqual(validateWorkflowOptions(real, read('../.github/workflows/add-scores.yml')), []);
});

test('score lists accept several separators and loose name matching', () => {
  assert.deepEqual(parseScoreList(config, 'Aayush 420, sam b: 385'), [
    { player: 'aayush', score: 420 },
    { player: 'sam-b', score: 385 },
  ]);
  assert.deepEqual(parseScoreList(config, 'AAYUSH=1;SamB 2\n'), [
    { player: 'aayush', score: 1 },
    { player: 'sam-b', score: 2 },
  ]);
});

test('score lists reject unknown players, repeats, junk and negatives', () => {
  userError(() => parseScoreList(config, 'Mallory 10'), /Unknown player "Mallory"/);
  userError(() => parseScoreList(config, 'Aayush 1, aayush 2'), /listed twice/);
  userError(() => parseScoreList(config, 'Aayush'), /Couldn't read/);
  userError(() => parseScoreList(config, 'Aayush -5'), /Unknown player|Couldn't read/);
  userError(() => parseScoreList(config, 'Aayush 4.5'), /Unknown player|Couldn't read/);
  userError(() => parseScoreList(config, ''), /No scores/);
  userError(() => parseScoreList(config, 'x'.repeat(3000)), /too long/);
});

test('adding scores creates entries with fresh IDs', () => {
  const r = addScores(config, empty, { gameMode: 'topbinz/niche', scoresText: 'Aayush 420, Sam B 385', dateText: 'today', now: NOW });
  assert.equal(r.date, '2026-11-18');
  assert.equal(r.data.entries.length, 2);
  for (const entry of r.data.entries) assert.match(entry.id, /^[0-9a-f]{8}$/);
  assert.notEqual(r.data.entries[0].id, r.data.entries[1].id);
  assert.deepEqual(validateScores(config, r.data, '2026-11-18'), []);
  assert.equal(empty.entries.length, 0, 'input data is not mutated');
});

test('a second score for the same day needs "replace"', () => {
  const first = addScores(config, empty, { gameMode: 'krillion/daily', scoresText: 'Aayush 300', dateText: '2026-11-17', now: NOW });
  userError(
    () => addScores(config, first.data, { gameMode: 'krillion/daily', scoresText: 'Sam B 100, Aayush 310', dateText: '2026-11-17', now: NOW }),
    /already has a Krillion Daily Dive score on 2026-11-17 \(300\)/,
  );
  const second = addScores(config, first.data, { gameMode: 'krillion/daily', scoresText: 'Aayush 310', dateText: '2026-11-17', replace: true, now: NOW });
  assert.equal(second.data.entries.length, 1);
  assert.equal(second.data.entries[0].score, 310);
  assert.equal(second.data.entries[0].id, first.data.entries[0].id);
  assert.equal(second.changes[0].previous, 300);
});

test('scores above the game max are rejected with the game hint', () => {
  userError(
    () => addScores(config, empty, { gameMode: 'krillion/daily', scoresText: 'Aayush 4200', now: NOW }),
    /above the Krillion max of 700\. Use points, not meters\./,
  );
});

test('unknown game/mode is rejected', () => {
  userError(() => addScores(config, empty, { gameMode: 'topbinz/ranked', scoresText: 'Aayush 1', now: NOW }), /Unknown game\/mode/);
});

test('dates: today, yesterday, ISO; no future or nonsense', () => {
  assert.equal(resolveDate('', 'America/New_York', NOW), '2026-11-18');
  assert.equal(resolveDate('Yesterday', 'America/New_York', NOW), '2026-11-17');
  assert.equal(resolveDate('2026-02-28', 'America/New_York', NOW), '2026-02-28');
  userError(() => resolveDate('2026-02-30', 'America/New_York', NOW), /isn't a date/);
  userError(() => resolveDate('2026-12-25', 'America/New_York', NOW), /future/);
  userError(() => resolveDate('1999-01-01', 'America/New_York', NOW), /too far/);
  userError(() => resolveDate('$(whoami)', 'America/New_York', NOW), /isn't a date/);
});

test('remove entry by ID', () => {
  const r = addScores(config, empty, { gameMode: 'topbinz/normal', scoresText: 'Aayush 1, Sam B 2', now: NOW });
  const id = r.data.entries[0].id;
  const removed = removeEntry(r.data, ` #${id.toUpperCase()} `);
  assert.equal(removed.data.entries.length, 1);
  assert.equal(removed.removed.id, id);
  userError(() => removeEntry(r.data, 'deadbeef'), /No entry/);
  userError(() => removeEntry(r.data, '../../etc'), /isn't an entry ID/);
});

test('add player makes a slug and rejects clashes and odd characters', () => {
  const r = addPlayer(config, '  Riya   K ');
  assert.deepEqual(r.player, { id: 'riya-k', name: 'Riya K' });
  assert.deepEqual(validateConfig(r.config), []);
  userError(() => addPlayer(config, 'samb'), /too close/);
  userError(() => addPlayer(config, 'AAYUSH'), /too close/);
  userError(() => addPlayer(config, '<script>alert(1)</script>'), /Player names/);
  userError(() => addPlayer(config, 'x'.repeat(30)), /Player names/);
  userError(() => addPlayer(config, ''), /Player names/);
});

test('validation catches tampered data', () => {
  const good = { id: '0000000a', date: '2026-11-17', player: 'aayush', game: 'krillion', mode: 'daily', score: 5 };
  const errs = (entries) => validateScores(config, { version: 1, entries }, '2026-11-18');
  assert.deepEqual(errs([good]), []);
  assert.match(errs([{ ...good, email: 'x@y.z' }]).join(), /unexpected fields: email/);
  assert.match(errs([good, { ...good }]).join(), /duplicated/);
  assert.match(errs([good, { ...good, id: '0000000b' }]).join(), /second krillion\/daily score/);
  assert.match(errs([{ ...good, score: 701 }]).join(), /above/);
  assert.match(errs([{ ...good, score: 1.5 }]).join(), /whole number/);
  assert.match(errs([{ ...good, date: '2026-11-20' }]).join(), /out of range/);
  assert.match(errs([{ ...good, player: 'mallory' }]).join(), /not in config.players/);
  assert.match(validateConfig({ ...config, players: [{ id: 'a', name: 'A', email: 'x' }] }).join(), /unexpected fields/);
  assert.match(validateConfig({ ...config, timezone: 'Mars/Olympus' }).join(), /timezone/);
  assert.match(validateConfig({ ...config, games: [{ ...config.games[0], url: 'javascript:alert(1)' }] }).join(), /https/);
});

test('safe() strips anything that could break out of a log line', () => {
  assert.equal(safe('a\nb::error::x'), 'a?b::error::x');
  assert.equal(safe('<b>`x`</b>'), '?b??x??/b?');
  assert.equal(safe('x'.repeat(50)).length, 41);
});

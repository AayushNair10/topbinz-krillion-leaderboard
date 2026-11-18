import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  LeagueError,
  UserError,
  addPlayer,
  addResults,
  addScores,
  normalizeLeagueCode,
  parseScoreList,
  parseShareText,
  readLeague,
  syncLeague,
  topbinzDay,
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
    /already has a Krillion score on 2026-11-17 \(300\)/,
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

// Share text exactly as each game builds it (see scripts/lib.mjs).
const TB_NORMAL = 'TOPBINZ #20 · 410 pts · as Haaland · 🔥3\n🟩🟨🟥🟩🟩⬜🟨\n1. 80  2. 60  3. —  4. 90  5. 70  6. 40  7. 70\ntopbinz.io';
const TB_NICHE = 'TOPBINZ #20 · NICHE · 540 pts · as Haaland\n🟩🟩🟨🟩🟩🟩🟨\n1. 80  2. 90  3. 70  4. 90  5. 70  6. 70  7. 70\ntopbinz.io';
const KR_DAILY = 'Krillion #126 🦐 420  🟦🟪⬛🟦🟦🟪🟦  https://krillion.io';
const shareConfig = {
  ...config,
  games: [
    { ...config.games[0], puzzleDay1: '2026-10-30' },
    { ...config.games[1], puzzleDay1: '2026-07-16' },
  ],
};

test('share text: finds every daily result and dates it from the puzzle number', () => {
  const expected = [
    { game: 'topbinz', mode: 'normal', date: '2026-11-18', score: 410, puzzle: 20 },
    { game: 'topbinz', mode: 'niche', date: '2026-11-18', score: 540, puzzle: 20 },
    { game: 'krillion', mode: 'daily', date: '2026-11-18', score: 420, puzzle: 126 },
  ];
  const sort = (list) => [...list].sort((a, b) => `${a.game}${a.mode}`.localeCompare(`${b.game}${b.mode}`));
  const pasted = `${TB_NORMAL}\n\n${TB_NICHE}\n${KR_DAILY}`;
  assert.deepEqual(sort(parseShareText(shareConfig, pasted)), sort(expected));
  // GitHub's single-line input drops line breaks, so results arrive glued together.
  assert.deepEqual(sort(parseShareText(shareConfig, pasted.replace(/\n/g, ''))), sort(expected));
  assert.deepEqual(parseShareText(shareConfig, 'TopBinz #1 · Niche · 5 pts'), [
    { game: 'topbinz', mode: 'niche', date: '2026-10-30', score: 5, puzzle: 1 },
  ]);
});

test('share text: archive, unlimited and junk are rejected', () => {
  userError(() => parseShareText(shareConfig, 'TOPBINZ #12 · ARCHIVE · 300 pts · as Kane'), /Only Daily results count/);
  userError(() => parseShareText(shareConfig, 'TOPBINZ ∞ · NICHE · 300 pts · as Kane'), /Only Daily results count/);
  userError(() => parseShareText(shareConfig, 'Krillion ⟲ #12 🦐 300  🟦'), /Only Daily results count/);
  userError(() => parseShareText(shareConfig, 'Krillion ∞ #3 🦐 300'), /Only Daily results count/);
  userError(() => parseShareText(shareConfig, 'I got 500 today'), /Couldn't find a TopBinz or Krillion daily result/);
  userError(() => parseShareText(shareConfig, ''), /Paste the text/);
});

test('share text: the same result twice is fine, two different scores is not', () => {
  assert.equal(parseShareText(shareConfig, `${KR_DAILY} ${KR_DAILY}`).length, 1);
  userError(() => parseShareText(shareConfig, `${KR_DAILY} Krillion #126 🦐 300`), /two different scores/);
});

test('pasted results are recorded for the named player', () => {
  const r = addResults(shareConfig, empty, { playerText: 'sam b', resultsText: `${TB_NORMAL}${TB_NICHE}${KR_DAILY}`, now: NOW });
  assert.equal(r.player.id, 'sam-b');
  assert.equal(r.data.entries.length, 3);
  assert.deepEqual(validateScores(shareConfig, r.data, '2026-11-18'), []);
  assert.deepEqual(r.changes.map((c) => [c.label, c.puzzle, c.score]).sort(), [
    ['Krillion', 126, 420],
    ['TopBinz Niche', 20, 540],
    ['TopBinz Normal', 20, 410],
  ]);
  userError(() => addResults(shareConfig, r.data, { playerText: 'Sam B', resultsText: KR_DAILY, now: NOW }), /already has a Krillion score on 2026-11-18/);
  const again = addResults(shareConfig, r.data, { playerText: 'Sam B', resultsText: 'Krillion #126 🦐 455', replace: true, now: NOW });
  assert.equal(again.data.entries.length, 3);
  assert.equal(again.changes[0].previous, 420);
});

test('pasted results: future puzzles, unknown players and impossible scores are rejected', () => {
  userError(() => addResults(shareConfig, empty, { playerText: 'Sam B', resultsText: 'TOPBINZ #30 · 100 pts', now: NOW }), /hasn't happened yet/);
  userError(() => addResults(shareConfig, empty, { playerText: 'Mallory', resultsText: KR_DAILY, now: NOW }), /Unknown player/);
  userError(() => addResults(shareConfig, empty, { playerText: '', resultsText: KR_DAILY, now: NOW }), /Type the player name/);
  userError(() => addResults(shareConfig, empty, { playerText: 'Sam B', resultsText: 'Krillion #126 🦐 750', now: NOW }), /above the Krillion max of 700/);
});

test('the real config dates puzzles correctly', () => {
  const real = JSON.parse(read('../site/data/config.json'));
  const day = (text) => parseShareText(real, text)[0].date;
  assert.equal(day('TOPBINZ #20 · 410 pts'), '2026-11-18');
  assert.equal(day('Krillion #126 🦐 420'), '2026-11-18');
});

// Shaped like the response TopBinz's own league page reads (members + standings.today.rows).
const leagueConfig = {
  ...config,
  players: [
    { id: 'aayush', name: 'Aayush' },
    { id: 'sam-b', name: 'Sam B', topbinz: 'sammy' },
  ],
};
const leagueBody = (rows) => ({
  name: 'Sunday League',
  owner: 'p1',
  members: {
    p1: { name: 'AAYUSH', pl: 'messi', h: '' },
    p2: { name: 'sammy', pl: 'kane' },
    p3: { name: 'Stranger', pl: 'saka' },
    p4: { name: 'aayush', pl: 'messi' }, // same person, second device
  },
  standings: { today: { rows }, week: { start: '2026-11-16', end: '2026-11-22', rows: [] }, month: { month: '2026-11', rows: [] } },
});
const DAY_ROWS = [
  { pid: 'p1', score: 410 },
  { pid: 'p2', score: 380 },
  { pid: 'p3', score: 500 },
  { pid: 'p4', score: 300 },
  { pid: 'p5', score: 200 }, // left the league: no member entry
  { pid: 'p6', score: '999' }, // malformed
  { pid: 'p7', score: 999999 }, // impossible
];

test('league: matches members by alias or name and keeps the best of duplicate devices', () => {
  const r = readLeague(leagueConfig, leagueBody(DAY_ROWS));
  assert.deepEqual(r.scores.sort((a, b) => a.player.localeCompare(b.player)), [
    { player: 'aayush', score: 410 },
    { player: 'sam-b', score: 380 },
  ]);
  assert.equal(r.played, 7);
  assert.equal(r.unmatched, 2);
  assert.equal(r.skipped, 2);
});

test('league: sync records Normal scores, is idempotent and corrects typed scores', () => {
  const typed = addScores(leagueConfig, empty, { gameMode: 'topbinz/normal', scoresText: 'Aayush 400', dateText: '2026-11-18', now: NOW });
  const first = syncLeague(leagueConfig, typed.data, leagueBody(DAY_ROWS), '2026-11-18');
  assert.deepEqual(first.changes.map((c) => [c.name, c.score, c.previous]).sort(), [
    ['Aayush', 410, 400],
    ['Sam B', 380, undefined],
  ]);
  assert.ok(first.data.entries.every((e) => e.game === 'topbinz' && e.mode === 'normal' && e.date === '2026-11-18'));
  assert.deepEqual(validateScores(leagueConfig, first.data, '2026-11-18'), []);
  const again = syncLeague(leagueConfig, first.data, leagueBody(DAY_ROWS), '2026-11-18');
  assert.equal(again.changes.length, 0);
  assert.equal(again.data.entries.length, 2);
});

test('league: errors and changed formats are reported, not guessed at', () => {
  assert.throws(() => readLeague(leagueConfig, { error: 'Code not found' }), (e) => e instanceof LeagueError && /doesn't exist/.test(e.message));
  assert.throws(() => readLeague(leagueConfig, { name: 'x', members: {} }), (e) => e instanceof LeagueError && /changed shape/.test(e.message));
  assert.throws(() => readLeague(leagueConfig, '<html>'), LeagueError);
  assert.deepEqual(readLeague(leagueConfig, leagueBody([])).scores, []);
});

test('league: day rolls over at 02:00 UTC and codes are normalized', () => {
  assert.equal(topbinzDay(new Date('2026-11-18T01:59:00Z')), '2026-11-17');
  assert.equal(topbinzDay(new Date('2026-11-18T02:00:00Z')), '2026-11-18');
  assert.equal(normalizeLeagueCode(' abc123 '), 'ABC123');
  userError(() => normalizeLeagueCode('AB/../C'), /league code/);
  userError(() => normalizeLeagueCode(''), /league code/);
});

test('players can carry a TopBinz league nickname', () => {
  assert.deepEqual(addPlayer(leagueConfig, 'Riya', 'riya_k10').player, { id: 'riya', name: 'Riya', topbinz: 'riya_k10' });
  assert.deepEqual(addPlayer(leagueConfig, 'Riya', 'RIYA').player, { id: 'riya', name: 'Riya' }); // same as name: not stored
  userError(() => addPlayer(leagueConfig, 'Riya', 'Sammy'), /already uses that TopBinz league nickname/);
  const dup = { ...leagueConfig, players: [...leagueConfig.players, { id: 'x', name: 'X', topbinz: 'SAMMY' }] };
  assert.match(validateConfig(dup).join(), /used by two players/);
  assert.match(validateConfig({ ...leagueConfig, players: [{ id: 'x', name: 'X', topbinz: 'a\u0000b' }] }).join(), /league nickname/);
});

test('safe() strips anything that could break out of a log line', () => {
  assert.equal(safe('a\nb::error::x'), 'a?b::error::x');
  assert.equal(safe('<b>`x`</b>'), '?b??x??/b?');
  assert.equal(safe('x'.repeat(50)).length, 41);
});

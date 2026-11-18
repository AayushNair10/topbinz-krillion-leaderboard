import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filterByPeriod,
  gameBoard,
  historyByDay,
  overallBoard,
  sanitizeEntries,
  todayIn,
  weekRange,
} from '../site/leaderboard.js';

const config = {
  title: 'Test',
  repo: 'o/r',
  timezone: 'America/New_York',
  games: [
    { id: 'topbinz', name: 'TopBinz', url: 'https://topbinz.io', maxScore: 1000, modes: [{ id: 'normal', name: 'Normal' }, { id: 'niche', name: 'Niche' }] },
    { id: 'krillion', name: 'Krillion', url: 'https://krillion.io', maxScore: 700, modes: [{ id: 'daily', name: 'Daily Dive' }] },
  ],
  players: [
    { id: 'aayush', name: 'Aayush' },
    { id: 'sam', name: 'Sam' },
    { id: 'riya', name: 'Riya' },
  ],
};

let n = 0;
const e = (date, player, game, mode, score) => ({ id: (n++).toString(16).padStart(8, '0'), date, player, game, mode, score });

const entries = [
  e('2026-11-16', 'aayush', 'topbinz', 'normal', 400),
  e('2026-11-16', 'aayush', 'topbinz', 'niche', 300),
  e('2026-11-16', 'sam', 'topbinz', 'normal', 500),
  e('2026-11-16', 'sam', 'topbinz', 'niche', 100),
  e('2026-11-17', 'aayush', 'topbinz', 'normal', 200),
  e('2026-11-17', 'sam', 'topbinz', 'niche', 650),
  e('2026-11-17', 'riya', 'topbinz', 'normal', 50), // only player in Normal that day
  e('2026-11-16', 'aayush', 'krillion', 'daily', 300),
  e('2026-11-16', 'riya', 'krillion', 'daily', 600),
  e('2026-11-17', 'riya', 'krillion', 'daily', 400), // alone that day: not a win
];

test('game board ranks by the combined total of every mode', () => {
  const board = gameBoard(config, entries, 'topbinz');
  assert.deepEqual(
    board.map((r) => [r.name, r.total, r.modes.normal, r.modes.niche, r.rank]),
    [
      ['Sam', 1250, 500, 750, 1],
      ['Aayush', 900, 600, 300, 2],
      ['Riya', 50, 50, 0, 3],
    ],
  );
});

test('wins go to the day total leader, best day and days played add up', () => {
  const [sam, aayush, riya] = gameBoard(config, entries, 'topbinz');
  // 11-16: Aayush 700 vs Sam 600. 11-17: Sam 650, Aayush 200, Riya 50.
  assert.equal(aayush.wins, 1);
  assert.equal(sam.wins, 1);
  assert.equal(riya.wins, 0);
  assert.equal(aayush.best, 700);
  assert.equal(sam.days, 2);
  assert.equal(sam.share, 1);
  assert.equal(aayush.share, 900 / 1250);
});

test('a day with only one player is not a win', () => {
  const [riya, aayush] = gameBoard(config, entries, 'krillion');
  assert.equal(riya.total, 1000);
  assert.equal(riya.wins, 1); // 11-16 only
  assert.equal(aayush.wins, 0);
  assert.equal(riya.avg, 500);
});

test('ties share a rank', () => {
  const tied = [e('2026-11-16', 'aayush', 'krillion', 'daily', 100), e('2026-11-16', 'sam', 'krillion', 'daily', 100), e('2026-11-16', 'riya', 'krillion', 'daily', 50)];
  const board = gameBoard(config, tied, 'krillion');
  assert.deepEqual(board.map((r) => r.rank), [1, 1, 3]);
  assert.deepEqual(board.map((r) => r.wins), [1, 1, 0]);
});

test('overall gives each game 100 points, shared relative to the leader', () => {
  const board = overallBoard(config, entries);
  const byName = Object.fromEntries(board.map((r) => [r.name, r]));
  assert.equal(byName.Sam.games.topbinz.points, 100);
  assert.equal(byName.Aayush.games.topbinz.points, 72); // 900 / 1250
  assert.equal(byName.Riya.games.krillion.points, 100);
  assert.equal(byName.Aayush.games.krillion.points, 30); // 300 / 1000
  assert.equal(byName.Riya.points, 104); // 4 + 100
  assert.equal(byName.Aayush.points, 102);
  assert.deepEqual(board.map((r) => r.name), ['Riya', 'Aayush', 'Sam']);
  assert.equal(board[0].rank, 1);
});

test('periods filter by ISO week and calendar month', () => {
  assert.deepEqual(weekRange('2026-11-18'), { start: '2026-11-16', end: '2026-11-22' }); // Wed
  assert.deepEqual(weekRange('2026-11-22'), { start: '2026-11-16', end: '2026-11-22' }); // Sun
  assert.deepEqual(weekRange('2026-11-16'), { start: '2026-11-16', end: '2026-11-22' }); // Mon
  const list = [e('2026-11-15', 'sam', 'krillion', 'daily', 1), e('2026-11-16', 'sam', 'krillion', 'daily', 1), e('2026-10-31', 'sam', 'krillion', 'daily', 1)];
  assert.equal(filterByPeriod(list, 'week', '2026-11-18').length, 1);
  assert.equal(filterByPeriod(list, 'month', '2026-11-18').length, 2);
  assert.equal(filterByPeriod(list, 'all', '2026-11-18').length, 3);
});

test('history is newest first with winners marked', () => {
  const days = historyByDay(config, entries);
  assert.deepEqual(days.map((d) => d.date), ['2026-11-17', '2026-11-16']);
  const tb = days[1].games.find((g) => g.game.id === 'topbinz');
  assert.deepEqual(tb.players.map((p) => [p.name, p.total, p.winner]), [['Aayush', 700, true], ['Sam', 600, false]]);
  assert.deepEqual(tb.players[0].parts.map((p) => p.mode), ['normal', 'niche']);
});

test('sanitizeEntries drops unknown players, modes and bad values', () => {
  const dirty = [
    ...entries.slice(0, 2),
    e('2026-11-16', 'mallory', 'topbinz', 'normal', 1),
    e('2026-11-16', 'sam', 'topbinz', 'ranked', 1),
    e('2026-11-16', 'sam', 'topbinz', 'normal', -5),
    e('2026-11-16', 'sam', 'topbinz', 'normal', '10'),
    e('<img>', 'sam', 'topbinz', 'normal', 1),
    null,
  ];
  assert.equal(sanitizeEntries(config, dirty).length, 2);
  assert.deepEqual(sanitizeEntries(config, 'nope'), []);
});

test('todayIn respects the timezone', () => {
  const late = new Date('2026-11-18T03:00:00Z'); // 10pm Nov 17 in New York
  assert.equal(todayIn('America/New_York', late), '2026-11-17');
  assert.equal(todayIn('UTC', late), '2026-11-18');
});

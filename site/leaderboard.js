// Pure leaderboard math, with no DOM access. The site and the tests both use it.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export const modeKey = (gameId, modeId) => `${gameId}/${modeId}`;

/** Drop anything that doesn't reference a known player/game/mode or has a bad value. */
export function sanitizeEntries(config, entries) {
  const players = new Set(config.players.map((p) => p.id));
  const modes = new Set(config.games.flatMap((g) => g.modes.map((m) => modeKey(g.id, m.id))));
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (e) =>
      e &&
      typeof e === 'object' &&
      players.has(e.player) &&
      modes.has(modeKey(e.game, e.mode)) &&
      Number.isSafeInteger(e.score) &&
      e.score >= 0 &&
      typeof e.date === 'string' &&
      DATE_RE.test(e.date),
  );
}

/** Today's date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Monday..Sunday of the week containing `today`. */
export function weekRange(today) {
  const t = toUTC(today);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return { start: fromUTC(t - dow * DAY_MS), end: fromUTC(t + (6 - dow) * DAY_MS) };
}

/** period: 'all' | 'month' | 'week'. */
export function filterByPeriod(entries, period, today) {
  if (period === 'week') {
    const { start, end } = weekRange(today);
    return entries.filter((e) => e.date >= start && e.date <= end);
  }
  if (period === 'month') {
    const prefix = today.slice(0, 7);
    return entries.filter((e) => e.date.startsWith(prefix));
  }
  return entries;
}

/** Standard competition ranking (1, 2, 2, 4) on an already-sorted array. */
function assignRanks(rows, key) {
  rows.forEach((row, i) => {
    row.rank = i > 0 && row[key] === rows[i - 1][key] ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

const byValueThenName = (key) => (a, b) => b[key] - a[key] || a.name.localeCompare(b.name);

/**
 * Per-day totals for one game: Map(date -> Map(playerId -> {total, parts[]})).
 * A day's total is the sum across the game's modes (e.g. Normal + Niche).
 */
function dailyTotals(entries, gameId) {
  const days = new Map();
  for (const e of entries) {
    if (e.game !== gameId) continue;
    if (!days.has(e.date)) days.set(e.date, new Map());
    const day = days.get(e.date);
    if (!day.has(e.player)) day.set(e.player, { total: 0, parts: [] });
    const cell = day.get(e.player);
    cell.total += e.score;
    cell.parts.push(e);
  }
  return days;
}

/** Players who had the top total that day. Needs at least two players to count as a win. */
function dayWinners(day) {
  if (day.size < 2) return new Set();
  const top = Math.max(...[...day.values()].map((c) => c.total));
  if (top <= 0) return new Set();
  return new Set([...day].filter(([, c]) => c.total === top).map(([pid]) => pid));
}

/**
 * Leaderboard for one game, ranked by cumulative total across all of its modes.
 * Each row: { player, name, total, modes: {modeId: sum}, days, wins, best, avg, share, rank }
 */
export function gameBoard(config, entries, gameId) {
  const game = config.games.find((g) => g.id === gameId);
  if (!game) return [];
  const names = new Map(config.players.map((p) => [p.id, p.name]));
  const rows = new Map();

  for (const [, day] of dailyTotals(entries, gameId)) {
    const winners = dayWinners(day);
    for (const [pid, cell] of day) {
      if (!rows.has(pid)) {
        rows.set(pid, {
          player: pid,
          name: names.get(pid) ?? pid,
          total: 0,
          modes: Object.fromEntries(game.modes.map((m) => [m.id, 0])),
          days: 0,
          wins: 0,
          best: 0,
        });
      }
      const row = rows.get(pid);
      row.total += cell.total;
      row.days += 1;
      row.best = Math.max(row.best, cell.total);
      if (winners.has(pid)) row.wins += 1;
      for (const e of cell.parts) row.modes[e.mode] += e.score;
    }
  }

  const list = [...rows.values()].sort(byValueThenName('total'));
  const top = list.length ? list[0].total : 0;
  for (const row of list) {
    row.avg = row.days ? row.total / row.days : 0;
    row.share = top > 0 ? row.total / top : 0;
  }
  return assignRanks(list, 'total');
}

/**
 * Overall standings across games whose scores live on different scales.
 * Each game is worth up to 100 points: the game's leader gets 100 and everyone
 * else gets their total as a percentage of the leader's total.
 */
export function overallBoard(config, entries) {
  const names = new Map(config.players.map((p) => [p.id, p.name]));
  const rows = new Map();

  for (const game of config.games) {
    const board = gameBoard(config, entries, game.id);
    for (const r of board) {
      if (!rows.has(r.player)) {
        rows.set(r.player, { player: r.player, name: names.get(r.player) ?? r.player, points: 0, games: {} });
      }
      const row = rows.get(r.player);
      const points = Math.round(r.share * 1000) / 10; // one decimal place
      row.games[game.id] = { points, rank: r.rank, total: r.total };
      row.points = Math.round((row.points + points) * 10) / 10;
    }
  }

  const list = [...rows.values()].sort(byValueThenName('points'));
  const max = config.games.length * 100;
  for (const row of list) row.share = max ? row.points / max : 0;
  return assignRanks(list, 'points');
}

/**
 * Day-by-day results, newest first:
 * [{ date, games: [{ game, players: [{ player, name, total, parts, winner }] }] }]
 */
export function historyByDay(config, entries) {
  const names = new Map(config.players.map((p) => [p.id, p.name]));
  const byDate = new Map();

  for (const game of config.games) {
    for (const [date, day] of dailyTotals(entries, game.id)) {
      const winners = dayWinners(day);
      const players = [...day]
        .map(([pid, cell]) => ({
          player: pid,
          name: names.get(pid) ?? pid,
          total: cell.total,
          parts: [...cell.parts].sort(
            (a, b) => game.modes.findIndex((m) => m.id === a.mode) - game.modes.findIndex((m) => m.id === b.mode),
          ),
          winner: winners.has(pid),
        }))
        .sort(byValueThenName('total'));
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push({ game, players });
    }
  }

  return [...byDate]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, games]) => ({
      date,
      games: games.sort(
        (a, b) => config.games.indexOf(a.game) - config.games.indexOf(b.game),
      ),
    }));
}

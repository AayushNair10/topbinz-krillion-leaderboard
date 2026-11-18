import {
  filterByPeriod,
  gameBoard,
  historyByDay,
  overallBoard,
  sanitizeEntries,
  todayIn,
} from './leaderboard.js';

// Everything is built with createElement/textContent. No HTML strings, so a
// player name can never be interpreted as markup.

const PERIODS = [
  ['all', 'All time'],
  ['month', 'This month'],
  ['week', 'This week'],
];

const num = new Intl.NumberFormat();
const pts = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const state = { config: null, entries: [], tab: 'overall', period: 'all', today: '' };

function safeHref(value) {
  if (value.startsWith('#')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '#';
  } catch {
    return '#';
  }
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'href') el.href = safeHref(value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const externalLink = (href, text, cls) =>
  h('a', { href, class: cls, target: '_blank', rel: 'noopener noreferrer' }, text);

const workflowUrl = (file) => `https://github.com/${state.config.repo}/actions/workflows/${file}`;

function formatDate(iso, withWeekday = true) {
  const date = new Date(`${iso}T00:00:00Z`);
  const sameYear = iso.slice(0, 4) === state.today.slice(0, 4);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    weekday: withWeekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(date);
}

// ---------------------------------------------------------------------------
// Routing: #/<tab>/<period>
// ---------------------------------------------------------------------------

function tabIds() {
  return ['overall', ...state.config.games.map((g) => g.id), 'history'];
}

function readHash() {
  const [tab, period] = location.hash.replace(/^#\/?/, '').split('/');
  state.tab = tabIds().includes(tab) ? tab : 'overall';
  state.period = PERIODS.some(([id]) => id === period) ? period : 'all';
}

function go(tab, period) {
  const next = `#/${tab}/${period}`;
  if (location.hash !== next) location.hash = next;
  else render();
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function rankBadge(rank) {
  return h('span', { class: `rank${rank <= 3 ? ` r${rank}` : ''}`, 'aria-label': `Rank ${rank}` }, rank);
}

function shareBar(share) {
  const fill = h('i');
  fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  return h('span', { class: 'bar', 'aria-hidden': 'true' }, fill);
}

function totalCell(text, share) {
  return h('td', { class: 'num total' }, h('span', { class: 'total-value' }, text), shareBar(share));
}

function table(columns, rows) {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, columns.map(([label, cls]) => h('th', { class: cls, scope: 'col' }, label)))),
      h('tbody', {}, rows),
    ),
  );
}

function emptyState(message) {
  return h(
    'div',
    { class: 'empty' },
    h('p', {}, message),
    externalLink(workflowUrl('paste-results.yml'), 'Paste a result ↗'),
  );
}

function periodLabel() {
  return PERIODS.find(([id]) => id === state.period)[1].toLowerCase();
}

function cardHead(title, note, extra) {
  return h('div', { class: 'card-head' }, h('div', { class: 'card-title' }, h('h2', {}, title), extra), note && h('p', { class: 'note' }, note));
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function overallView(entries) {
  const { games } = state.config;
  const rows = overallBoard(state.config, entries);
  const note = `Each game is worth up to 100 points. Whoever leads a game gets 100, and everyone else gets their total as a percentage of the leader's. That way games with bigger numbers don't drown out the others.`;
  if (!rows.length) return h('section', { class: 'card overall' }, cardHead('Overall', note), emptyState(`No scores ${periodLabel() === 'all time' ? 'yet' : periodLabel()}.`));

  return h(
    'section',
    { class: 'card overall' },
    cardHead('Overall', note),
    table(
      [['#', 'rank-col'], ['Player', 'player-col'], [`Points / ${games.length * 100}`, 'num'], ...games.map((g) => [g.name, 'num'])],
      rows.map((r) =>
        h(
          'tr',
          { class: r.rank === 1 ? 'leader' : null },
          h('td', { class: 'rank-col' }, rankBadge(r.rank)),
          h('th', { class: 'player-col', scope: 'row' }, r.name),
          totalCell(pts.format(r.points), r.share),
          games.map((g) => {
            const cell = r.games[g.id];
            return h(
              'td',
              { class: `num game-${g.id}` },
              cell ? [pts.format(cell.points), h('span', { class: 'sub' }, ` #${cell.rank}`)] : h('span', { class: 'muted' }, '—'),
            );
          }),
        ),
      ),
    ),
  );
}

function gameView(game, entries) {
  const rows = gameBoard(state.config, entries, game.id);
  const multi = game.modes.length > 1;
  const note = multi
    ? `Ranked by ${game.modes.map((m) => m.name).join(' + ')} combined. Wins = days you had the group's top score.`
    : `Ranked by total score. Wins = days you had the group's top score.`;
  const head = cardHead(game.name, note, externalLink(game.url, `Play ${game.name} ↗`, 'play'));

  if (!rows.length) {
    return h('section', { class: `card game-${game.id}` }, head, emptyState(`No ${game.name} scores ${periodLabel() === 'all time' ? 'yet' : periodLabel()}.`));
  }

  const columns = [
    ['#', 'rank-col'],
    ['Player', 'player-col'],
    ['Total', 'num'],
    ...(multi ? game.modes.map((m) => [m.name, 'num']) : [['Avg', 'num opt']]),
    ['Days', 'num opt'],
    ['Wins', 'num'],
    ['Best day', 'num opt'],
  ];

  return h(
    'section',
    { class: `card game-${game.id}` },
    head,
    table(
      columns,
      rows.map((r) =>
        h(
          'tr',
          { class: r.rank === 1 ? 'leader' : null },
          h('td', { class: 'rank-col' }, rankBadge(r.rank)),
          h('th', { class: 'player-col', scope: 'row' }, r.name),
          totalCell(num.format(r.total), r.share),
          multi
            ? game.modes.map((m) => h('td', { class: 'num' }, num.format(r.modes[m.id])))
            : h('td', { class: 'num opt' }, num.format(Math.round(r.avg))),
          h('td', { class: 'num opt' }, num.format(r.days)),
          h('td', { class: 'num' }, num.format(r.wins)),
          h('td', { class: 'num opt' }, num.format(r.best)),
        ),
      ),
    ),
  );
}

function historyView(entries) {
  const days = historyByDay(state.config, entries);
  const note = h(
    'span',
    {},
    'Typo? Copy the entry ID and run ',
    externalLink(workflowUrl('remove-entry.yml'), 'Remove entry'),
    ', then add the score again.',
  );
  const head = cardHead('History', note);
  if (!days.length) return h('section', { class: 'card' }, head, emptyState(`Nothing recorded ${periodLabel() === 'all time' ? 'yet' : periodLabel()}.`));

  return h(
    'section',
    { class: 'card' },
    head,
    h(
      'ol',
      { class: 'days' },
      days.map((day) =>
        h(
          'li',
          { class: 'day' },
          h('h3', { class: 'day-date' }, h('time', { datetime: day.date }, formatDate(day.date))),
          day.games.map(({ game, players }) => {
            const modeName = (id) => game.modes.find((m) => m.id === id)?.name ?? id;
            return h(
              'div',
              { class: `day-game game-${game.id}` },
              h('p', { class: 'day-game-name' }, game.name),
              h(
                'ul',
                { class: 'results' },
                players.map((p) =>
                  h(
                    'li',
                    { class: p.winner ? 'winner' : null },
                    h('span', { class: 'who' }, p.name, p.winner && h('span', { class: 'crown', title: 'Top score that day' }, ' ★')),
                    h('span', { class: 'num day-total' }, num.format(p.total)),
                    h(
                      'span',
                      { class: 'parts' },
                      p.parts.map((e) =>
                        h(
                          'span',
                          { class: 'part' },
                          game.modes.length > 1 ? `${modeName(e.mode)} ${num.format(e.score)} ` : null,
                          h('code', { class: 'id', title: 'Entry ID' }, e.id),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  const { config } = state;
  const tabs = [['overall', 'Overall'], ...config.games.map((g) => [g.id, g.name]), ['history', 'History']];

  document.getElementById('tabs').replaceChildren(
    ...tabs.map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => go(id, state.period) }, label),
    ),
  );
  document.getElementById('period').replaceChildren(
    ...PERIODS.map(([id, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(state.period === id), onclick: () => go(state.tab, id) }, label),
    ),
  );

  const entries = filterByPeriod(state.entries, state.period, state.today);
  const game = config.games.find((g) => g.id === state.tab);
  const view = state.tab === 'history' ? historyView(entries) : game ? gameView(game, entries) : overallView(entries);
  document.getElementById('view').replaceChildren(view);
}

function renderChrome() {
  const { config, entries } = state;
  document.title = `${config.title} Leaderboard`;
  const parts = config.title.split('×');
  document.getElementById('title').replaceChildren(
    ...parts.flatMap((part, i) => (i === 0 ? [part] : [h('span', { class: 'x' }, '×'), part])),
  );

  document.getElementById('paste-link').href = safeHref(workflowUrl('paste-results.yml'));
  document.getElementById('add-link').href = safeHref(workflowUrl('add-scores.yml'));

  const latest = entries.reduce((max, e) => (e.date > max ? e.date : max), '');
  document.getElementById('updated').textContent = latest
    ? `${num.format(entries.length)} ${entries.length === 1 ? 'score' : 'scores'} recorded · latest ${formatDate(latest, false)}`
    : 'No scores recorded yet';
}

async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-cache', credentials: 'omit' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  try {
    const [config, scores] = await Promise.all([loadJSON('data/config.json'), loadJSON('data/scores.json')]);
    state.config = config;
    state.entries = sanitizeEntries(config, scores.entries);
    state.today = todayIn(config.timezone);
  } catch (err) {
    console.error(err);
    document.getElementById('view').replaceChildren(h('p', { class: 'error' }, "Couldn't load the scores. Try refreshing."));
    return;
  }
  renderChrome();
  readHash();
  render();
  window.addEventListener('hashchange', () => {
    readHash();
    render();
  });
}

main();

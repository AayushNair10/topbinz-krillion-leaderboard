// Validation and data changes for the scoreboard. Shared by the CLI, CI and tests.
import { randomBytes } from 'node:crypto';
import { modeKey, todayIn } from '../site/leaderboard.js';

export const ID_RE = /^[0-9a-f]{8}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const PLAYER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,23}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const EARLIEST_DATE = '2020-01-01';
const ENTRY_KEYS = ['id', 'date', 'player', 'game', 'mode', 'score'];
const MAX_INPUT = 2000;
const MAX_PAIRS = 50;

/** An error caused by bad input. Its message is safe to show to the person who ran the command. */
export class UserError extends Error {}

/** Make user-supplied text safe to echo into logs, annotations and markdown. */
export function safe(text, max = 40) {
  const s = String(text ?? '').replace(/[^A-Za-z0-9 _.,:=+#/-]/g, '?');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Loose match key for player names: "Sam B", "sam_b" and "SAMB" all match. */
export const nameKey = (s) => String(s).toLowerCase().replace(/[\s_.-]+/g, '');

export function isRealDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) return ['config.json must be a JSON object'];

  if (typeof config.title !== 'string' || !config.title.trim() || config.title.length > 60) {
    errors.push('config.title must be a non-empty string (max 60 chars)');
  }
  if (typeof config.repo !== 'string' || !REPO_RE.test(config.repo)) {
    errors.push('config.repo must look like "owner/repo"');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: config.timezone });
    if (typeof config.timezone !== 'string') throw new Error();
  } catch {
    errors.push('config.timezone must be an IANA timezone such as "America/New_York"');
  }

  if (!Array.isArray(config.games) || config.games.length === 0) {
    errors.push('config.games must be a non-empty array');
  } else {
    const gameIds = new Set();
    config.games.forEach((g, i) => {
      const at = `config.games[${i}]`;
      if (!isPlainObject(g)) return errors.push(`${at} must be an object`);
      if (typeof g.id !== 'string' || !SLUG_RE.test(g.id)) errors.push(`${at}.id must be lowercase letters, digits or dashes`);
      else if (gameIds.has(g.id)) errors.push(`${at}.id "${g.id}" is duplicated`);
      else gameIds.add(g.id);
      if (typeof g.name !== 'string' || !g.name.trim() || g.name.length > 40) errors.push(`${at}.name must be a short string`);
      try {
        if (new URL(g.url).protocol !== 'https:') throw new Error();
      } catch {
        errors.push(`${at}.url must be an https:// URL`);
      }
      if (!Number.isSafeInteger(g.maxScore) || g.maxScore <= 0) errors.push(`${at}.maxScore must be a positive integer`);
      if (g.scoreHint !== undefined && (typeof g.scoreHint !== 'string' || g.scoreHint.length > 200)) {
        errors.push(`${at}.scoreHint must be a short string`);
      }
      if (!Array.isArray(g.modes) || g.modes.length === 0) {
        errors.push(`${at}.modes must be a non-empty array`);
      } else {
        const modeIds = new Set();
        g.modes.forEach((m, j) => {
          const mat = `${at}.modes[${j}]`;
          if (!isPlainObject(m)) return errors.push(`${mat} must be an object`);
          if (typeof m.id !== 'string' || !SLUG_RE.test(m.id)) errors.push(`${mat}.id must be lowercase letters, digits or dashes`);
          else if (modeIds.has(m.id)) errors.push(`${mat}.id "${m.id}" is duplicated`);
          else modeIds.add(m.id);
          if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40) errors.push(`${mat}.name must be a short string`);
        });
      }
    });
  }

  if (!Array.isArray(config.players)) {
    errors.push('config.players must be an array');
  } else {
    const ids = new Set();
    const names = new Set();
    config.players.forEach((p, i) => {
      const at = `config.players[${i}]`;
      if (!isPlainObject(p)) return errors.push(`${at} must be an object`);
      const extra = Object.keys(p).filter((k) => k !== 'id' && k !== 'name');
      if (extra.length) errors.push(`${at} has unexpected fields: ${extra.join(', ')} (only id and name are allowed)`);
      if (typeof p.id !== 'string' || !SLUG_RE.test(p.id)) errors.push(`${at}.id must be lowercase letters, digits or dashes`);
      else if (ids.has(p.id)) errors.push(`${at}.id "${p.id}" is duplicated`);
      else ids.add(p.id);
      if (typeof p.name !== 'string' || !PLAYER_NAME_RE.test(p.name)) {
        errors.push(`${at}.name must be 1–24 letters, digits, spaces, dots, dashes or underscores`);
      } else if (names.has(nameKey(p.name))) {
        errors.push(`${at}.name "${p.name}" is too similar to another player's name`);
      } else {
        names.add(nameKey(p.name));
      }
    });
  }
  return errors;
}

export function validateScores(config, data, today) {
  const errors = [];
  if (!isPlainObject(data)) return ['scores.json must be a JSON object'];
  if (data.version !== 1) errors.push('scores.version must be 1');
  if (!Array.isArray(data.entries)) return [...errors, 'scores.entries must be an array'];

  const players = new Set((config.players ?? []).map((p) => p.id));
  const games = new Map((config.games ?? []).map((g) => [g.id, g]));
  const latest = addDays(today, 1); // one day of slack for timezones
  const ids = new Set();
  const keys = new Set();

  data.entries.forEach((e, i) => {
    const at = `entries[${i}]`;
    if (!isPlainObject(e)) return errors.push(`${at} must be an object`);
    const extra = Object.keys(e).filter((k) => !ENTRY_KEYS.includes(k));
    const missing = ENTRY_KEYS.filter((k) => !(k in e));
    if (extra.length) errors.push(`${at} has unexpected fields: ${extra.join(', ')}`);
    if (missing.length) errors.push(`${at} is missing: ${missing.join(', ')}`);

    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) errors.push(`${at}.id must be 8 hex characters`);
    else if (ids.has(e.id)) errors.push(`${at}.id "${e.id}" is duplicated`);
    else ids.add(e.id);

    if (!isRealDate(e.date)) errors.push(`${at}.date must be a real YYYY-MM-DD date`);
    else if (e.date < EARLIEST_DATE || e.date > latest) errors.push(`${at}.date ${e.date} is out of range`);

    if (!players.has(e.player)) errors.push(`${at}.player "${safe(e.player)}" is not in config.players`);
    const game = games.get(e.game);
    if (!game) errors.push(`${at}.game "${safe(e.game)}" is not in config.games`);
    else if (!game.modes.some((m) => m.id === e.mode)) errors.push(`${at}.mode "${safe(e.mode)}" is not a ${game.name} mode`);

    if (!Number.isSafeInteger(e.score) || e.score < 0) errors.push(`${at}.score must be a whole number ≥ 0`);
    else if (game && e.score > game.maxScore) errors.push(`${at}.score ${e.score} is above ${game.name}'s max of ${game.maxScore}`);

    const key = `${e.date}|${e.player}|${modeKey(e.game, e.mode)}`;
    if (keys.has(key)) errors.push(`${at} is a second ${e.game}/${e.mode} score for ${e.player} on ${e.date}`);
    keys.add(key);
  });
  return errors;
}

/** The add-scores workflow's dropdown must list exactly the game/mode pairs in config. */
export function validateWorkflowOptions(config, workflowText) {
  const listed = new Set([...workflowText.matchAll(/^\s*-\s+([a-z0-9-]+\/[a-z0-9-]+)\s*$/gm)].map((m) => m[1]));
  const wanted = new Set(config.games.flatMap((g) => g.modes.map((m) => modeKey(g.id, m.id))));
  const errors = [];
  for (const k of wanted) if (!listed.has(k)) errors.push(`add-scores.yml is missing the option "${k}"`);
  for (const k of listed) if (!wanted.has(k)) errors.push(`add-scores.yml lists "${k}", which isn't in config.json`);
  return errors;
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

function newId(taken) {
  for (;;) {
    const id = randomBytes(4).toString('hex');
    if (!taken.has(id)) return id;
  }
}

const sortEntries = (entries) =>
  [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.game.localeCompare(b.game) ||
      a.mode.localeCompare(b.mode) ||
      a.player.localeCompare(b.player),
  );

export function resolveDate(text, timeZone, now = new Date()) {
  const today = todayIn(timeZone, now);
  const t = String(text ?? '').trim().toLowerCase();
  let date;
  if (t === '' || t === 'today') date = today;
  else if (t === 'yesterday') date = addDays(today, -1);
  else if (isRealDate(t)) date = t;
  else throw new UserError(`"${safe(text)}" isn't a date. Use YYYY-MM-DD, "today" or "yesterday".`);
  if (date > addDays(today, 1)) throw new UserError(`${date} is in the future.`);
  if (date < EARLIEST_DATE) throw new UserError(`${date} is too far in the past.`);
  return date;
}

export function findPlayer(config, text) {
  const k = nameKey(text);
  return config.players.find((p) => nameKey(p.id) === k || nameKey(p.name) === k);
}

/** Parse "Aayush 420, Sam: 385; Riya=300" into [{player, score}]. */
export function parseScoreList(config, text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new UserError('No scores given. Use "name score" pairs, e.g. "Aayush 420, Sam 385".');
  if (raw.length > MAX_INPUT) throw new UserError('That scores list is too long.');
  const chunks = raw.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (chunks.length > MAX_PAIRS) throw new UserError(`Too many scores at once (max ${MAX_PAIRS}).`);

  const out = [];
  const seen = new Set();
  for (const chunk of chunks) {
    const m = chunk.match(/^(.+?)(?:\s*[:=]\s*|\s+)(\d{1,15})$/);
    if (!m) throw new UserError(`Couldn't read "${safe(chunk)}". Write each score as "name score", e.g. "Aayush 420".`);
    const player = findPlayer(config, m[1]);
    if (!player) {
      const known = config.players.map((p) => p.name).join(', ') || 'none yet';
      throw new UserError(`Unknown player "${safe(m[1])}". Known players: ${known}. Add new friends with the "Add player" workflow first.`);
    }
    if (seen.has(player.id)) throw new UserError(`${player.name} is listed twice.`);
    seen.add(player.id);
    out.push({ player: player.id, score: Number(m[2]) });
  }
  return out;
}

/**
 * Record one game/mode's scores for a day. All-or-nothing: any bad input
 * throws before anything changes.
 */
export function addScores(config, data, { gameMode, scoresText, dateText, replace = false, now = new Date() }) {
  const [gameId, modeId] = String(gameMode ?? '').split('/');
  const game = config.games.find((g) => g.id === gameId);
  const mode = game?.modes.find((m) => m.id === modeId);
  if (!game || !mode) {
    const options = config.games.flatMap((g) => g.modes.map((m) => modeKey(g.id, m.id))).join(', ');
    throw new UserError(`Unknown game/mode "${safe(gameMode)}". Options: ${options}.`);
  }
  const date = resolveDate(dateText, config.timezone, now);
  const pairs = parseScoreList(config, scoresText);
  const name = (pid) => config.players.find((p) => p.id === pid).name;

  for (const { player, score } of pairs) {
    if (score > game.maxScore) {
      const hint = game.scoreHint ? ` ${game.scoreHint}` : '';
      throw new UserError(`${name(player)}'s ${score} is above the ${game.name} max of ${game.maxScore}.${hint}`);
    }
  }

  const entries = [...data.entries];
  const taken = new Set(entries.map((e) => e.id));
  const changes = [];
  for (const { player, score } of pairs) {
    const idx = entries.findIndex((e) => e.date === date && e.player === player && e.game === game.id && e.mode === mode.id);
    if (idx >= 0) {
      const existing = entries[idx];
      if (!replace) {
        throw new UserError(
          `${name(player)} already has a ${game.name} ${mode.name} score on ${date} (${existing.score}). Tick "replace" to overwrite it.`,
        );
      }
      entries[idx] = { ...existing, score };
      changes.push({ ...entries[idx], name: name(player), previous: existing.score });
    } else {
      const entry = { id: newId(taken), date, player, game: game.id, mode: mode.id, score };
      taken.add(entry.id);
      entries.push(entry);
      changes.push({ ...entry, name: name(player) });
    }
  }
  return { data: { ...data, entries: sortEntries(entries) }, game, mode, date, changes };
}

export function removeEntry(data, idText) {
  const id = String(idText ?? '').trim().replace(/^#/, '').toLowerCase();
  if (!ID_RE.test(id)) throw new UserError(`"${safe(idText)}" isn't an entry ID. IDs are 8 characters like 3fa9c01b; find them on the History tab.`);
  const removed = data.entries.find((e) => e.id === id);
  if (!removed) throw new UserError(`No entry with ID ${id}.`);
  return { data: { ...data, entries: data.entries.filter((e) => e.id !== id) }, removed };
}

export function addPlayer(config, nameText) {
  const name = String(nameText ?? '').trim().replace(/\s+/g, ' ');
  if (!PLAYER_NAME_RE.test(name)) {
    throw new UserError('Player names must be 1–24 characters: letters, digits, spaces, dots, dashes or underscores. Use a nickname, not a full name.');
  }
  const id = name.toLowerCase().replace(/[\s_.]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!SLUG_RE.test(id)) throw new UserError(`Can't make an ID from "${safe(name)}". Try a different nickname.`);
  const clash = config.players.find((p) => p.id === id || nameKey(p.name) === nameKey(name));
  if (clash) throw new UserError(`"${safe(name)}" is too close to the existing player "${clash.name}".`);
  const player = { id, name };
  return { config: { ...config, players: [...config.players, player] }, player };
}

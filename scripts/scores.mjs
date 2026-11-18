#!/usr/bin/env node
// Change the scoreboard data. Run by the GitHub Actions workflows, or locally:
//
//   GAME_MODE=topbinz/niche SCORES="Aayush 420, Sam 385" node scripts/scores.mjs add-scores
//   PLAYER=Aayush RESULTS="TOPBINZ #20 · NICHE · 540 pts" node scripts/scores.mjs paste-results
//   ENTRY_ID=3fa9c01b node scripts/scores.mjs remove-entry
//   PLAYER_NAME=Sam PLAYER_TOPBINZ=sammy node scripts/scores.mjs add-player
//   TOPBINZ_LEAGUE=ABC123 node scripts/scores.mjs sync-topbinz
//
// Inputs come from environment variables, never from the shell command line, so
// nothing typed into the form can be run as a command.
import { readFileSync, writeFileSync } from 'node:fs';
import { todayIn } from '../site/leaderboard.js';
import {
  LeagueError,
  TOPBINZ_API,
  UserError,
  addPlayer,
  addResults,
  addScores,
  normalizeLeagueCode,
  removeEntry,
  safe,
  syncLeague,
  topbinzDay,
  validateConfig,
  validateScores,
} from './lib.mjs';

const CONFIG = new URL('../site/data/config.json', import.meta.url);
const SCORES = new URL('../site/data/scores.json', import.meta.url);
const env = process.env;
const IN_ACTIONS = env.GITHUB_ACTIONS === 'true';

const readJSON = (url) => JSON.parse(readFileSync(url, 'utf8'));
const writeJSON = (url, value) => writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`);

/** A temporary problem (network, TopBinz down). Logged as a warning; the next run tries again. */
class TransientError extends Error {}

function check(config, data) {
  const errors = [...validateConfig(config), ...validateScores(config, data, todayIn(config.timezone))];
  if (errors.length) throw new Error(`Refusing to save invalid data:\n- ${errors.join('\n- ')}`);
}

function annotate(level, title, message) {
  if (IN_ACTIONS) console.log(`::${level} title=${title}::${message}`);
  else console.error(`${level}: ${message}`);
}

async function fetchLeague(code, day) {
  let res;
  try {
    res = await fetch(`${TOPBINZ_API}/league/${encodeURIComponent(code)}?d=${day}`, {
      headers: { accept: 'application/json', 'user-agent': 'friends-leaderboard-sync/1.0' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TransientError("Couldn't reach TopBinz. Trying again on the next run.");
  }
  const text = await res.text().catch(() => '');
  if (text.length > 2_000_000) throw new LeagueError('TopBinz sent an unexpectedly large response.');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    if (res.status >= 500 || res.status === 429) throw new TransientError(`TopBinz is having trouble (HTTP ${res.status}). Trying again on the next run.`);
    throw new LeagueError(`TopBinz sent something that isn't JSON (HTTP ${res.status}).`);
  }
  if (!res.ok && body?.error === undefined) {
    if (res.status >= 500 || res.status === 429) throw new TransientError(`TopBinz is having trouble (HTTP ${res.status}). Trying again on the next run.`);
    throw new LeagueError(`TopBinz answered HTTP ${res.status}.`);
  }
  return body;
}

async function run(cmd) {
  const config = readJSON(CONFIG);
  const data = readJSON(SCORES);
  const by = env.ACTOR ? `\n\nRequested by ${safe(env.ACTOR)} via GitHub Actions.` : '';

  switch (cmd) {
    case 'add-scores': {
      const r = addScores(config, data, {
        gameMode: env.GAME_MODE,
        scoresText: env.SCORES,
        dateText: env.DATE,
        replace: env.REPLACE === 'true',
      });
      check(config, r.data);
      writeJSON(SCORES, r.data);
      const label = `${r.game.name} ${r.mode.name}`;
      const line = (c) => `${c.name} ${c.score}${c.previous !== undefined ? ` (was ${c.previous})` : ''}`;
      return {
        message: `Add ${label} scores for ${r.date}\n\n${r.changes.map(line).join(', ')}${by}`,
        summary: [
          `### ✅ ${label} · ${r.date}`,
          '',
          '| Player | Score | Entry ID |',
          '| --- | ---: | --- |',
          ...r.changes.map((c) => `| ${c.name} | ${c.score}${c.previous !== undefined ? ` (was ${c.previous})` : ''} | \`${c.id}\` |`),
        ].join('\n'),
      };
    }
    case 'paste-results': {
      const r = addResults(config, data, {
        playerText: env.PLAYER,
        resultsText: env.RESULTS,
        replace: env.REPLACE === 'true',
      });
      check(config, r.data);
      writeJSON(SCORES, r.data);
      const line = (c) => `${c.label} #${c.puzzle} (${c.date}): ${c.score}${c.previous !== undefined ? ` (was ${c.previous})` : ''}`;
      return {
        message: `Add ${r.player.name}'s pasted results\n\n${r.changes.map(line).join('\n')}${by}`,
        summary: [
          `### ✅ ${r.player.name}'s results`,
          '',
          '| Game | Puzzle | Day | Score | Entry ID |',
          '| --- | ---: | --- | ---: | --- |',
          ...r.changes.map(
            (c) => `| ${c.label} | #${c.puzzle} | ${c.date} | ${c.score}${c.previous !== undefined ? ` (was ${c.previous})` : ''} | \`${c.id}\` |`,
          ),
        ].join('\n'),
      };
    }
    case 'remove-entry': {
      const r = removeEntry(data, env.ENTRY_ID);
      check(config, r.data);
      writeJSON(SCORES, r.data);
      const e = r.removed;
      const who = config.players.find((p) => p.id === e.player)?.name ?? e.player;
      const desc = `${who} ${e.game}/${e.mode} ${e.score} on ${e.date}`;
      return {
        message: `Remove entry ${e.id} (${desc})${by}`,
        summary: `### 🗑️ Removed entry \`${e.id}\`\n\n${desc}`,
      };
    }
    case 'sync-topbinz': {
      if (!String(env.TOPBINZ_LEAGUE ?? '').trim()) {
        annotate('notice', 'TopBinz league', 'No TOPBINZ_LEAGUE secret is set, so there is nothing to sync.');
        return null;
      }
      const code = normalizeLeagueCode(env.TOPBINZ_LEAGUE);
      const day = topbinzDay();
      const r = syncLeague(config, data, await fetchLeague(code, day), day);
      if (r.league.unmatched) {
        // Count only: nicknames of people who aren't on the public leaderboard stay out of public logs.
        annotate(
          'notice',
          'TopBinz league',
          `${r.league.unmatched} league score(s) today belong to people who aren't on the leaderboard. Add them with Add player, using their TopBinz league nickname.`,
        );
      }
      if (!r.changes.length) {
        console.log(`League checked for ${day}: ${r.league.played} played, nothing new.`);
        return null;
      }
      check(config, r.data);
      writeJSON(SCORES, r.data);
      const line = (c) => `${c.name} ${c.score}${c.previous !== undefined ? ` (was ${c.previous})` : ''}`;
      return {
        message: `Sync TopBinz league for ${day}\n\n${r.changes.map(line).join(', ')}`,
        summary: [
          `### ⚽ TopBinz league · ${day}`,
          '',
          '| Player | Normal | Entry ID |',
          '| --- | ---: | --- |',
          ...r.changes.map((c) => `| ${c.name} | ${c.score}${c.previous !== undefined ? ` (was ${c.previous})` : ''} | \`${c.id}\` |`),
        ].join('\n'),
      };
    }
    case 'add-player': {
      const r = addPlayer(config, env.PLAYER_NAME, env.PLAYER_TOPBINZ);
      check(r.config, data);
      writeJSON(CONFIG, r.config);
      return {
        message: `Add player ${r.player.name}${by}`,
        summary: [
          `### 👋 Added player **${r.player.name}**`,
          '',
          r.player.topbinz ? `TopBinz league nickname: ${safe(r.player.topbinz, 24)}` : 'Their TopBinz league nickname should match this name.',
        ].join('\n'),
      };
    }
    default:
      throw new UserError('Usage: node scripts/scores.mjs <add-scores|paste-results|remove-entry|add-player|sync-topbinz>');
  }
}

try {
  const result = await run(process.argv[2]);
  if (result) {
    if (env.COMMIT_MSG_FILE) writeFileSync(env.COMMIT_MSG_FILE, `${result.message}\n`);
    if (env.SUMMARY_FILE) writeFileSync(env.SUMMARY_FILE, `${result.summary}\n`);
    console.log(result.message.split('\n\n')[0]);
  }
} catch (err) {
  if (err instanceof TransientError) {
    annotate('warning', 'TopBinz league', err.message);
    process.exit(0);
  }
  if (!(err instanceof UserError || err instanceof LeagueError)) throw err;
  annotate('error', 'Scoreboard not updated', err.message);
  process.exit(1);
}

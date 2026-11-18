#!/usr/bin/env node
// Change the scoreboard data. Run by the GitHub Actions workflows, or locally:
//
//   GAME_MODE=topbinz/niche SCORES="Aayush 420, Sam 385" node scripts/scores.mjs add-scores
//   PLAYER=Aayush RESULTS="TOPBINZ #20 · NICHE · 540 pts" node scripts/scores.mjs paste-results
//   ENTRY_ID=3fa9c01b node scripts/scores.mjs remove-entry
//   PLAYER_NAME=Sam node scripts/scores.mjs add-player
//
// Inputs come from environment variables, never from the shell command line, so
// nothing typed into the form can be run as a command.
import { readFileSync, writeFileSync } from 'node:fs';
import { todayIn } from '../site/leaderboard.js';
import { UserError, addPlayer, addResults, addScores, removeEntry, safe, validateConfig, validateScores } from './lib.mjs';

const CONFIG = new URL('../site/data/config.json', import.meta.url);
const SCORES = new URL('../site/data/scores.json', import.meta.url);
const env = process.env;

const readJSON = (url) => JSON.parse(readFileSync(url, 'utf8'));
const writeJSON = (url, value) => writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`);

function check(config, data) {
  const errors = [...validateConfig(config), ...validateScores(config, data, todayIn(config.timezone))];
  if (errors.length) throw new Error(`Refusing to save invalid data:\n- ${errors.join('\n- ')}`);
}

function run(cmd) {
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
    case 'add-player': {
      const r = addPlayer(config, env.PLAYER_NAME);
      check(r.config, data);
      writeJSON(CONFIG, r.config);
      return {
        message: `Add player ${r.player.name}${by}`,
        summary: `### 👋 Added player **${r.player.name}**\n\nYou can now use "${r.player.name}" in the Add scores form.`,
      };
    }
    default:
      throw new UserError('Usage: node scripts/scores.mjs <add-scores|paste-results|remove-entry|add-player>');
  }
}

try {
  const { message, summary } = run(process.argv[2]);
  if (env.COMMIT_MSG_FILE) writeFileSync(env.COMMIT_MSG_FILE, `${message}\n`);
  if (env.SUMMARY_FILE) writeFileSync(env.SUMMARY_FILE, `${summary}\n`);
  console.log(message.split('\n\n')[0]);
} catch (err) {
  if (!(err instanceof UserError)) throw err;
  if (env.GITHUB_ACTIONS === 'true') console.log(`::error title=Scoreboard not updated::${err.message}`);
  else console.error(`Error: ${err.message}`);
  process.exit(1);
}

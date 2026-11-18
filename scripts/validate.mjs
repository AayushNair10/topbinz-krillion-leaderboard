#!/usr/bin/env node
// Checks the data files (and the add-scores dropdown) before anything is deployed.
import { readFileSync } from 'node:fs';
import { todayIn } from '../site/leaderboard.js';
import { validateConfig, validateScores, validateWorkflowOptions } from './lib.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

let errors = [];
try {
  const config = JSON.parse(read('../site/data/config.json'));
  const data = JSON.parse(read('../site/data/scores.json'));
  errors = validateConfig(config);
  if (!errors.length) {
    errors = [
      ...validateScores(config, data, todayIn(config.timezone)),
      ...validateWorkflowOptions(config, read('../.github/workflows/add-scores.yml')),
    ];
  }
} catch (err) {
  errors = [`Couldn't read the data files: ${err.message}`];
}

if (errors.length) {
  for (const e of errors) {
    console.log(process.env.GITHUB_ACTIONS === 'true' ? `::error title=Invalid scoreboard data::${e}` : `✗ ${e}`);
  }
  process.exit(1);
}
console.log('✓ Scoreboard data is valid');

# TopBinz × Krillion leaderboard

A leaderboard for a group of friends playing the daily [TopBinz](https://topbinz.io) and [Krillion](https://krillion.io) games.

**Site:** https://aayushnair10.github.io/topbinz-krillion-leaderboard/

It's a static site on GitHub Pages. Scores live in [`site/data/scores.json`](site/data/scores.json) and get added through a form in GitHub Actions. There's no server, no database and no API keys.

## How scoring works

| Board | Ranked by |
| --- | --- |
| **TopBinz** | Cumulative **Normal + Niche** total. Each mode is also shown in its own column. |
| **Krillion** | Cumulative Daily Dive total, in points. |
| **Overall** | Each game is worth up to 100 points. Whoever leads a game gets 100, and everyone else gets their total as a percentage of the leader's. That way Krillion and TopBinz count equally even though their numbers are on different scales. |

- **Wins**: days you had the group's top score in that game (only counts when at least two people played).
- **Best day**: your highest single-day total in that game (for TopBinz, Normal + Niche that day).
- **All time / This month / This week**: filters every board. Weeks run Monday to Sunday.
- Each player gets one score per game mode per day. A second score for the same day is rejected unless you tick **replace**.

## Adding scores

Neither game has a public API. **TopBinz Normal** scores come in automatically through your TopBinz league. Everything else (TopBinz Niche and Krillion) is pasted or typed in, which works in a phone browser.

### Automatic: TopBinz league (Normal only)

TopBinz has built-in **Leagues**. Once you're in one, your Daily Strike score is sent to the league when you finish. The [Sync TopBinz league](https://github.com/AayushNair10/topbinz-krillion-leaderboard/actions/workflows/sync-topbinz.yml) workflow reads your league's table every two hours, plus twice shortly before TopBinz's 02:00 UTC daily reset. It records new scores as **TopBinz Normal**.

Setup, once:

1. In TopBinz, open **Leagues**, then create a league and have everyone join with its 6-letter code (or use the one you already have).
2. Save the code as a secret: **Settings → Secrets and variables → Actions → New repository secret**, name `TOPBINZ_LEAGUE`, value the code. It stays out of the repo and the logs, since anyone with the code could join your league.
3. Each friend's TopBinz league nickname must match their leaderboard name (not case-sensitive). If it doesn't, give it in the optional "TopBinz league nickname" box when you **Add player**.

Good to know:

- League scores are only TopBinz **Normal**, because the league doesn't get Niche. Paste Niche and Krillion results as below.
- A league score overwrites a different Normal score typed in by hand for the same day, since TopBinz has verified it.
- League members who aren't on the leaderboard are skipped. The run log shows how many, but not their names.
- This uses TopBinz's undocumented internal server, the same one its own league page uses. It could break if TopBinz changes it. If the league data changes shape, the run fails with an error saying so.
- GitHub pauses scheduled workflows in public repos after 60 days without commits, so a long break from playing may need a manual **Run workflow** to restart it.

### Paste a result

1. On the game's daily results screen, tap **Share** (or **Copy**).
2. Go to **[Actions → Paste results](https://github.com/AayushNair10/topbinz-krillion-leaderboard/actions/workflows/paste-results.yml)** and click **Run workflow**.
3. Type the player's name and paste. You can paste TopBinz Normal, Niche and Krillion one after another in the same box.
4. Run it. About a minute later the site has the new scores.

The game, mode, day and score are all read from the share text, e.g. `TOPBINZ #20 · NICHE · 540 pts` or `Krillion #126 🦐 420`. The day comes from the puzzle number, so pasting yesterday's result files it under yesterday. Archive and Unlimited results are ignored. This needs the game set to English.

### Type scores

1. Go to **[Actions → Add scores](https://github.com/AayushNair10/topbinz-krillion-leaderboard/actions/workflows/add-scores.yml)** and click **Run workflow**.
2. Pick the game and mode, e.g. `topbinz/niche`.
3. Type everyone's scores at once: `Aayush 420, Sam 385, Riya 300`. Names aren't case-sensitive.
4. Leave the date as `today`, or type `yesterday` or a date like `2026-11-17`.

> **Krillion:** enter **points** (max 700 a day). If you only have the depth in meters, divide by 10.

If a run fails, open it and the error at the top says what was wrong, e.g. an unknown player or a duplicate score. Nothing is saved from a failed run.

### Other actions

| Workflow | Use it to |
| --- | --- |
| [Add player](https://github.com/AayushNair10/topbinz-krillion-leaderboard/actions/workflows/add-player.yml) | Add a friend to the roster. **Use a nickname**, because the site and repo are public. Add their TopBinz league nickname if it's different. |
| [Remove entry](https://github.com/AayushNair10/topbinz-krillion-leaderboard/actions/workflows/remove-entry.yml) | Delete one score by its ID (shown on the site's **History** tab), then add the right one. |

### Letting friends add their own scores

Only people with write access to this repo can run the workflows. To let a friend add scores, invite them under **Settings → Collaborators**. That also lets them edit the repo, so only invite people you trust. Otherwise, one person enters everyone's scores.

## Editing data by hand

You can also edit `site/data/config.json` (games, modes, players, max scores, timezone) or `site/data/scores.json` directly on GitHub. Every push is validated, and data that fails validation doesn't get deployed, so the live site keeps the last good version. To add a game or mode, add it to `config.json` **and** to the dropdown in `.github/workflows/add-scores.yml`. Validation fails if the two disagree.

## Running locally

Needs Node 20+ and has no dependencies.

```sh
npm run dev       # preview at http://localhost:8080
npm test          # unit tests
npm run validate  # check the data files
```

## Security and privacy

- **No secrets in the code.** No backend, no database, no API keys, no tokens in the repo. Writes go through GitHub, so you need a GitHub login and write access to this repo. Turn on 2FA for your GitHub account.
- **The TopBinz league code** is the only secret. It lives in GitHub's encrypted Actions secrets, is only passed to the sync step, and GitHub masks it in logs. The sync only reads (one GET request per run, no login). It treats TopBinz's response as untrusted: each score is checked, and nicknames are only used for matching, never saved or logged.
- **Locked-down workflows.** Each job gets only the token permissions it needs. Form inputs reach the script through environment variables (never pasted into shell commands) and are strictly validated: known players only, whole-number scores within the game's max, real dates. Every third-party action is pinned to a full commit SHA, and Dependabot proposes updates monthly.
- **Repo settings.** Only GitHub-made actions are allowed and they must be SHA-pinned. The default workflow token is read-only. Pull requests from outside contributors need approval before any workflow runs. `main` can't be force-pushed or deleted. Secret scanning with push protection is on.
- **The site** loads nothing from other domains: no analytics, fonts, CDNs or cookies. A strict Content-Security-Policy allows only its own files. Names are rendered as plain text, never as HTML. It's also marked `noindex` to keep it out of search engines.
- **Everything here is public:** the repo, the site, and Actions run logs. Only nicknames and scores belong here. Don't add real full names, emails or anything else personal.

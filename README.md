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

1. Go to **[Actions → Add scores](https://github.com/AayushNair10/topbinz-krillion-leaderboard/actions/workflows/add-scores.yml)** and click **Run workflow**. It works in a phone browser too.
2. Pick the game and mode, e.g. `topbinz/niche`.
3. Type everyone's scores at once: `Aayush 420, Sam 385, Riya 300`. Names aren't case-sensitive.
4. Leave the date as `today`, or type `yesterday` or a date like `2026-11-17`.
5. Run it. About a minute later the site has the new scores.

> **Krillion:** enter **points** (max 700 a day). If you only have the depth in meters, divide by 10.

If a run fails, open it and the error at the top says what was wrong, e.g. an unknown player or a duplicate score. Nothing is saved from a failed run.

### Other actions

| Workflow | Use it to |
| --- | --- |
| [Add player](https://github.com/AayushNair10/topbinz-krillion-leaderboard/actions/workflows/add-player.yml) | Add a friend to the roster. **Use a nickname**, because the site and repo are public. |
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

- **No secrets anywhere.** No backend, no database, no API keys, no tokens in the code. Writes go through GitHub, so you need a GitHub login and write access to this repo. Turn on 2FA for your GitHub account.
- **Locked-down workflows.** Each job gets only the token permissions it needs. Form inputs reach the script through environment variables (never pasted into shell commands) and are strictly validated: known players only, whole-number scores within the game's max, real dates. Every third-party action is pinned to a full commit SHA, and Dependabot proposes updates monthly.
- **Repo settings.** Only GitHub-made actions are allowed and they must be SHA-pinned. The default workflow token is read-only. Pull requests from outside contributors need approval before any workflow runs. `main` can't be force-pushed or deleted. Secret scanning with push protection is on.
- **The site** loads nothing from other domains: no analytics, fonts, CDNs or cookies. A strict Content-Security-Policy allows only its own files. Names are rendered as plain text, never as HTML. It's also marked `noindex` to keep it out of search engines.
- **Everything here is public:** the repo, the site, and Actions run logs. Only nicknames and scores belong here. Don't add real full names, emails or anything else personal.

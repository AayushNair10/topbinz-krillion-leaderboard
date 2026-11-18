#!/usr/bin/env bash
# Used by the scoreboard workflows: apply one change to the latest main and push it.
# If someone else's update lands first, start again from the new main (up to 5 tries).
set -euo pipefail

cmd="$1"
work="$(mktemp -d)"
export COMMIT_MSG_FILE="$work/message" SUMMARY_FILE="$work/summary"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for attempt in 1 2 3 4 5; do
  git fetch --quiet origin main
  git reset --quiet --hard origin/main
  node scripts/scores.mjs "$cmd"

  if git diff --quiet -- site/data; then
    echo "Nothing changed."
    exit 0
  fi
  git add site/data
  git commit --quiet -F "$COMMIT_MSG_FILE"

  if git push --quiet origin HEAD:main; then
    cat "$SUMMARY_FILE" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
    exit 0
  fi
  echo "Someone else updated the scoreboard at the same time. Retrying ($attempt/5)…"
  sleep $((attempt * 3))
done

echo "::error title=Scoreboard not updated::Couldn't push after 5 attempts. Try running the workflow again."
exit 1

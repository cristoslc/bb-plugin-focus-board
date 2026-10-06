#!/bin/bash
# Self-healing watchdog for the focus-board plugin's main checkout
# (/Users/cristos/Documents/code/bb-plugin-focus-board), the checkout bb serves.
#
# Runs as a bb script automation (every 5 minutes). Silent exit-0 tick while
# healthy. Repairs automatically when repo-root node_modules is a symlink —
# the recurring failure that makes the Focus Board vanish — by reinstalling,
# rebuilding, and reloading the plugin. Never notifies; repairs are visible in
# `bb automation runs`. $BB_CLI is injected by the automation runtime.
#
# Never create node_modules symlinks in this repo (see AGENTS.md).
set -u

MAIN="/Users/cristos/Documents/code/bb-plugin-focus-board"
NM="$MAIN/node_modules"

if [ -d "$NM" ] && [ ! -L "$NM" ]; then
  exit 0
fi

if [ -L "$NM" ]; then
  detail="a symlink -> $(readlink "$NM" 2>/dev/null || echo '?')"
else
  detail="missing"
fi

rm -f "$NM"
cd "$MAIN" || { echo "repair FAILED: cannot enter $MAIN (node_modules was $detail)"; exit 1; }

npm ci --no-audit --no-fund >/dev/null 2>&1 \
  || { echo "repair FAILED: npm ci (node_modules was $detail)"; exit 1; }

npm run build >/dev/null 2>&1 \
  || { echo "repair FAILED: build after npm ci (node_modules was $detail)"; exit 1; }

if [ -n "${BB_CLI:-}" ]; then
  "$BB_CLI" plugin reload focus-board >/dev/null 2>&1 \
    || echo "REPAIRED but plugin reload failed; run manually: bb plugin reload focus-board (node_modules was $detail)"
else
  echo "REPAIRED but BB_CLI unavailable; run manually: bb plugin reload focus-board (node_modules was $detail)"
fi

echo "REPAIRED: focus-board node_modules (was $detail); reinstalled, rebuilt, reloaded."
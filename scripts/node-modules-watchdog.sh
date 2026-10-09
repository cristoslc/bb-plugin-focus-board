#!/bin/bash
# Self-healing watchdog for the focus-board plugin's main checkouts.
#
# Runs as a bb script automation (every 5 minutes). Silent exit-0 tick while
# healthy. Repairs automatically when repo-root node_modules is a symlink —
# the recurring failure that makes the Focus Board vanish — by reinstalling,
# rebuilding, and reloading the plugin. Only the checkout bb actually loads
# the plugin from gets a reload. Never notifies; repairs are visible in
# `bb automation runs`. $BB_CLI is injected by the automation runtime.
#
# Never create node_modules symlinks in this repo (see AGENTS.md).
set -u

SERVED="/Users/cristos/Documents/code/bb-plugin-focus-board"
DEV="/Users/cristos/code/bb-plugin-focus-board"

# repair_if_corrupt <checkout>: echoes a status line, returns 0 when healthy,
# 1 when a repair was attempted and failed. Skips a checkout whose npm
# install is mid-flight (node_modules/.staging marker) to avoid clobbering.
repair_if_corrupt() {
  local main="$1" nm="$1/node_modules" detail repaired=""
  if [ -d "$nm" ] && [ ! -L "$nm" ]; then return 0; fi
  if [ -d "$nm/.staging" ]; then
    echo "SKIPPED: $main node_modules is mid-install (npm .staging present)"
    return 0
  fi
  if [ -L "$nm" ]; then
    detail="a symlink -> $(readlink "$nm" 2>/dev/null || echo '?')"
  else
    detail="missing"
  fi
  rm -f "$nm"
  cd "$main" || { echo "repair FAILED: cannot enter $main (node_modules was $detail)"; return 1; }
  npm ci --no-audit --no-fund >/dev/null 2>&1 \
    || { echo "repair FAILED: npm ci in $main (node_modules was $detail)"; return 1; }
  npm run build >/dev/null 2>&1 \
    || { echo "repair FAILED: build in $main after npm ci (node_modules was $detail)"; return 1; }
  if [ "$main" = "$SERVED" ]; then
    if [ -n "${BB_CLI:-}" ]; then
      "$BB_CLI" plugin reload focus-board >/dev/null 2>&1 \
        || echo "repaired $main but plugin reload failed; run: bb plugin reload focus-board (node_modules was $detail)"
    else
      echo "repaired $main but BB_CLI unavailable; run: bb plugin reload focus-board (node_modules was $detail)"
    fi
  fi
  echo "REPAIRED: $main node_modules (was $detail); reinstalled, rebuilt."
}

overall=0
repair_if_corrupt "$SERVED" || overall=1
repair_if_corrupt "$DEV" || overall=1
exit "$overall"
Focus Board is a nav panel in the bb sidebar that shows all your threads as a kanban board. It reads bb's live thread view through the plugin SDK's sidebar hooks, so it updates in real time as your threads change.

## What you get

- **Orient at a glance.** The default lanes rank threads by attention — pinned, needs-you, unread, working — and quiet threads settle beneath them by how long they have been quiet. Reslice anytime by project, provider, machine, activity, or parent; search and filters persist across sessions.
- **Act from the board.** Drag to hand-order a column, or drop a card on Pinned, Unread, Done, or another card to change its state or nest it in the same motion. Sweep a lane's stragglers to a destination before a daily pass, and spawn a child thread preset to its parent's project from the card menu.
- **Depth, one click away.** When a card deserves it, the thread opens beside the board or full-screen on phone: read, reply, answer the agent's questions, open its workspace in your editor or terminal, and let AI name the thread from its opening prompt.
- **Your tracker rides along.** GitHub issues and PRs chip from the title, branch, or the board's own link store — with a live status dot and nothing that cannot be validated.

This page describes the shape of the board, not the release history. The running record lives in the [CHANGELOG](https://github.com/cristoslc/bb-plugin-focus-board/blob/main/CHANGELOG.md); each update surfaces its own highlights in the board's What's-new view on first open, and the full history is on the [Releases page](https://github.com/cristoslc/bb-plugin-focus-board/releases).

## How it works

The board writes only pin state, read state, Done marks, and per-thread tracker-item links through bb's own stores — never thread content. Sweep thresholds are configurable in Settings → Installed plugins or with the CLI, and any thread can be exempted with a per-card "Keep from sweep" override.

## CLI

One subcommand, `bb focus-board`, manages the plugin's own state: marks, snoozes, links, auto-titling, sweeps, and config. All commands accept `--json`, and the sweep never archives without `--confirm`.

## Requirements

- Node 18 or newer
- bb 0.43 or newer with plugin SDK 0.5.9 or newer
- Optional: the official GitHub plugin, for ticket status dots. Without its local cache, chips render without dots and everything else works.


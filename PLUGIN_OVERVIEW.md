Focus Board is a nav panel in the bb sidebar that shows all your threads as a kanban board. It reads bb's live thread view through the plugin SDK's sidebar hooks, so it updates in real time as your threads change.

## What you get

- **Orient at a glance.** Group threads by attention (the default: pinned, needs you, unread, working, then idle lanes by how long they have been quiet), last activity, project, provider, machine, or parent thread. Filters and search by state, project, provider, branch, or title persist across sessions.
- **Act from the board.** Drag to hand-order a column, drop a card on Pinned, Unread, or Done to change its state in the same drag, or drop it on a card's middle to nest it as that thread's child. Select several cards and sweep a lane to its destination (archive stale, idle to Done, unpin, mark read) before a daily pass; card and pane menus cover the everyday moves, and "New child thread…" spawns a child preset to the parent's project and checkout.
- **Work from the pane.** Open a card to read and reply beside the board, full screen on phone; answer the agent's questions right there; open the thread's workspace in your editor, file explorer, or terminal; and let the title editor name the thread from its opening prompt with bb's AI services, falling back to the thread's own model.
- **See the work.** GitHub issue and PR refs in a thread's title or branch become chips with a live status dot; text refs only chip when something attached to the project can validate them, and the board's own link store ties any thread to any https tracker item (through the agent tool or the CLI). A gift button in the toolbar lists what changed after each update.

This page describes the shape of the board, not the release history. The running record lives in the [CHANGELOG](https://github.com/cristoslc/bb-plugin-focus-board/blob/main/CHANGELOG.md); each update surfaces its own highlights in the board's What's-new view on first open, and the full history is on the [Releases page](https://github.com/cristoslc/bb-plugin-focus-board/releases).

## How it works

The board writes only pin state, read state, Done marks, and per-thread tracker-item links through bb's own stores — never thread content. Sweep thresholds are configurable in Settings → Installed plugins or with the CLI, and any thread can be exempted with a per-card "Keep from sweep" override.

## CLI

One subcommand, `bb focus-board`, manages the plugin's own state: marks, snoozes, links, auto-titling, sweeps, and config. All commands accept `--json`, and the sweep never archives without `--confirm`.

## Requirements

- Node 18 or newer
- bb 0.43 or newer with plugin SDK 0.5.9 or newer
- Optional: the official GitHub plugin, for ticket status dots. Without its local cache, chips render without dots and everything else works.
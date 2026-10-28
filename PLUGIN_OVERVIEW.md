Focus Board turns your bb threads into a kanban board in the sidebar that updates live, ranked so the threads that need you come first.

## What you get

- **Orient at a glance.** Lanes rank threads by attention and let quiet ones settle out as they age. Reslice by project, provider, machine, activity, or parent, with search and filters that persist.
- **Act in the drag.** Drop a card to re-order a column, change its state, or nest it as a child. Sweep a lane's stragglers to Done or Archive so the board stays fresh.
- **Open the thread where you are.** Read, reply, and answer an agent's questions inside the board, from your browser, desktop, or phone.

More about our features in the [README](https://github.com/cristoslc/bb-plugin-focus-board).

## CLI

One subcommand, `bb focus-board`, manages the plugin's own state: done status, feature groups, links, snoozes, auto-titling, and sweeps. Every command takes `--json`, and the sweep never archives without `--confirm`.

## Requirements

- Node 18 or newer
- bb 0.43 or newer with plugin SDK 0.5.9 or newer
- Optional: the official GitHub plugin, for ticket status dots. Without its cache, chips render without dots and everything else works.

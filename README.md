# Focus Board

<p align="center">
  A kanban board for your bb threads, grouped by what needs your attention.
</p>

<p align="center">
  <a href="#install"><img alt="bb plugin" src="https://img.shields.io/badge/install%20with-bb%20plugin-8a2be2"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-339933">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/cristoslc/bb-plugin-focus-board"></a>
</p>

<p align="center">
  <a href="docs/screenshots/board-thread-pane-dark.png">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/board-thread-pane-dark.png">
      <img src="docs/screenshots/board-thread-pane-light.png" alt="Focus Board with a thread conversation pane open beside it" width="100%">
    </picture>
  </a>
</p>

> [!NOTE]
> **What is bb?** An open-source, local-first IDE for coding agents — Claude Code, Codex, Cursor, Pi, OpenCode, and more — where work runs in *threads*: live agent conversations you can follow, steer mid-run, or hand off. Focus Board is a bb *plugin* that turns those threads into a kanban board. Learn more at [getbb.app](https://getbb.app) or [github.com/get-bb/bb](https://github.com/get-bb/bb).

## What it does

The board lives in bb's sidebar as a nav panel and updates in real time as your threads change. Lanes read left to right in order of attention: **Pinned, Needs you, Unread, Working**, then idle threads bucketed by how long they've been quiet.

- **Group and filter** — lanes by Attention, Last activity, Project, Provider, Machine, or Parent thread; filter and search by state, project, provider, or title.
- **Drag to act** — hand-order a column, or drop a card on Pinned, Unread, or Done to change its state in the same drag. Subthreads nest under their parent card.
- **Thread pane** — open a card to read and reply beside the board; full screen on phone. Agent questions are answered right from the pane.
- **Sweep** stale Done threads to Archive and long-idle threads to Done, in two clicks; swept idle threads resurface in Done and archive later.
- **Ticket chips** with GitHub status dots when the official GitHub plugin is installed.
- **What's new** — a 🎁 toolbar button lists recent changes after an update.

Finer behavior notes (hand-ordering rules, Escape handling, pin behavior, pane history) live in [docs/features.md](docs/features.md).

## Screenshots

<p align="center">
  <a href="docs/screenshots/board-thread-pane-dark.png">
    <img src="docs/screenshots/board-thread-pane-dark.png" alt="Opening a card slides in a thread pane with the conversation" width="85%">
  </a>
  <br>
  <strong>Thread pane</strong> — opening a card slides in the conversation alongside the board
</p>

<p align="center">
  <a href="docs/screenshots/phone-board-light.png">
    <img src="docs/screenshots/phone-board-light.png" alt="Board on a phone: toolbar stacked vertically, columns scrolling horizontally" width="32%">
  </a>
  &nbsp;&nbsp;
  <a href="docs/screenshots/phone-thread-pane-dark.png">
    <img src="docs/screenshots/phone-thread-pane-dark.png" alt="Thread pane full screen on a phone, with the conversation and reply box" width="32%">
  </a>
  <br>
  <strong>Phone</strong> — the toolbar stacks and columns scroll horizontally;
  the thread pane goes full screen
</p>

## Requirements

- Node ≥ 18
- bb ≥ 0.43 with plugin SDK ≥ 0.5.9
- Optional: the official GitHub plugin, for ticket status dots. Without its
  local cache, chips render without dots and everything else works.

## Install

Install straight from GitHub, no clone needed:

```sh
bb plugin install https://github.com/cristoslc/bb-plugin-focus-board
```

To update later, run the same command again (add `--yes` to skip the
confirmation prompt). To pin a version:

```sh
bb plugin install git:https://github.com/cristoslc/bb-plugin-focus-board@v0.3.1
```

## Configuration

Set sweep thresholds in Settings → Installed plugins or with the CLI. Each
threshold is a count plus a unit (hours, days, or weeks); both default to
2 days:

| Setting | Default | Effect |
|---|---|---|
| `doneArchiveValue` | 2 | Done threads older than this (in `doneArchiveUnit`) become sweep-eligible |
| `doneArchiveUnit` | days | Unit for the Done threshold: `hours`, `days`, or `weeks` |
| `idleArchiveValue` | 2 | Threads idle longer than this (in `idleArchiveUnit`) become sweep-eligible |
| `idleArchiveUnit` | days | Unit for the idle threshold: `hours`, `days`, or `weeks` |

Any thread can be exempted from both sweeps with the card-menu
"Keep from sweep" override.

## CLI

The plugin registers one `bb` subcommand for managing its own state:

```sh
bb focus-board done list [--json]
bb focus-board done mark <thread-id>...
bb focus-board done clear <thread-id>...
bb focus-board sweep [--ids <id>...] [--confirm]
bb focus-board config show
bb focus-board config set <doneArchiveValue|doneArchiveUnit|idleArchiveValue|idleArchiveUnit> <count|hours|days|weeks>
```

All commands accept `--json`. The sweep never archives without `--confirm`;
without it the command is a dry-run: it prints what would be archived and
exits 1.

## Data and privacy

The board reads bb's live thread view through the plugin SDK and writes only
pin state, read state, and Done marks through bb's own stores — never thread
content. For ticket status dots it reads the official GitHub plugin's local
cache read-only. Nothing leaves your machine.

## Development

```sh
npm install
bb plugin build
bb plugin install . --yes
bb plugin reload focus-board
# or: bb plugin dev
npm test           # vitest
npx tsc --noEmit   # typecheck
```

The screenshots in `docs/screenshots/` are captured with a harness in
`scripts/screenshot/` — see its README for usage.

## Contributing

Issues and PRs are welcome at
[github.com/cristoslc/bb-plugin-focus-board](https://github.com/cristoslc/bb-plugin-focus-board).
Run `npm test` and `npx tsc --noEmit` before submitting.

## License

[MIT](LICENSE).

## Changelog

Notable changes are documented in [CHANGELOG.md](CHANGELOG.md).
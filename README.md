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

## What it does

The default grouping reads left to right in order of attention: **Pinned,
Needs you, Unread, Working**, then idle threads bucketed by how long
they've been quiet.

- **Group by** Attention, Last activity, Project, Provider, or Machine
- **Filter and search** by state, project, provider, or title
- **Reorder a column** by dragging cards into your own order instead of the
  board's recency order. The order belongs to the column, not the thread, so
  a card that leaves a column and comes back returns to the slot it left.
  Alt+ArrowUp / Alt+ArrowDown does the same from the keyboard, and a lane
  with a hand-set order says so in its header.
- **Nest** subthreads under their parent card
- **Sweep** stale Done and long-idle threads to Archive in two clicks
- **Ticket chips** with GitHub status dots, linking to the tracker
- **Thread pane** slides in beside the board; works on phone. The open pane
  is part of the panel's URL (`…/board/t/<threadId>`), so bb's back arrow
  returns you to the pane you left after following a link out to a full
  thread in main bb — and walks back through cards you lost track of, one
  pane per step. A deep link opens the board with that pane directly.
  Grouping, filters, and search are preferences, not history: they persist
  across sessions in localStorage and are deliberately not replayed by the
  back arrow (see
  [ADR 0001](docs/adr/0001-pane-history-in-url-preferences-in-localstorage.md)).
  The board keeps the active card in view when its lane changes (pin, done,
  grouping) and when a pane is restored from history.
- **What's new**: a 🎁 button in the toolbar lists recent changes after an
  update. It pulses until opened; the button never disappears, so the
  changelog stays reachable.
- **Answer questions in the pane**: when an agent asks a question (the
  ask-user-question tool), the pane renders the form and submits the answer
  from the board — the host's embedded chat only shows these in the main
  thread view. Both payload shapes are handled: provider `user_question`
  interactions (answered through `interactions.resolve`) and plugin forms
  (answered through `interactions.respond`). Unsupported plugin forms get an
  "Open in main view" fallback.

It lives in the sidebar as a nav panel and updates in real time through
the plugin SDK.

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

Set sweep thresholds in Settings → Installed plugins or with the CLI:

| Setting | Default | Effect |
|---|---|---|
| `doneArchiveDays` | 7 | Done threads older than this become sweep-eligible |
| `idleArchiveDays` | 30 | Threads idle longer than this become sweep-eligible |

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
bb focus-board config set <doneArchiveDays|idleArchiveDays> <days>
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
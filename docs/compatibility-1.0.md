# Compatibility — what Focus Board 1.0 commits to

This note is the stability promise that ships with 1.0.0. Version 1.0.0 is
the line where the surfaces below stop changing without a major bump.

## Frozen at 1.0.0

### CLI (`bb focus-board …`)

The command set and everything an operator or an agent can script against:

| Command | Committed shape |
|---|---|
| `done list [--json]` | rows with thread id, `doneAt`, `keep` |
| `done mark <id>… / clear <id>…` | state write, published as `done-changed` |
| `snooze list [--json]` | wake-soonest-first rows with overdue flags |
| `snooze set <when> <id>… / clear <id>…` | `+<N>m\|h\|d\|w` or a future timestamp; invalid input exits 1 |
| `autotitle availability \| prompt \| probe --thread-id <id>` | diagnostics unchanged in semantics |
| `sweep [--ids <id>…] [--confirm]` | dry-run default, exit 1; `--json` reports `archived` and `markedDone` separately |
| `config show / config set` | the four threshold keys and their validation |

Every command keeps accepting `--json`. Output is additive-safe: new fields
may appear, existing fields never change shape or meaning without a major
bump. Removing or renaming a command is a major bump.

### Stored state (server side, via `bb.storage.kv` and per-thread plugin metadata)

| Store | Key | Record |
|---|---|---|
| Rank orders | `focus-board:rank-orders` | per-column ordered id lists |
| Sweep keep flags | `sweep-keep-flags` | `keep` rows |
| Done index (reporting aid) | `done-index` | array of thread ids |
| Done record (per thread) | metadata key `done` | `{ doneAt: ISO-8601, keep?: boolean }` |
| Snooze record (per thread) | metadata key `snooze` | `{ wakeAt, setAt }` |
| Parked-pin record (per thread) | metadata key `pin` | parked-pin row |

Parsers keep their contracts: malformed stored state fails loud (done,
ranks) or degrades with a log line (keep flags, preference lists). Any
future migration must import the 1.0 shapes read-only and never lose them;
the legacy `done-thread-ids` shim (import once, delete the old key,
idempotent re-runs) is the pattern.

### localStorage preferences (client side)

- `focus-board:groupBy`, `focus-board:filter`, `focus-board:search`, `focus-board:nestChildren`, `focus-board:collapsedFamilies`, `focus-board:parentLaneOrder`, `focus-board:paneWidth`, `focus-board:lastSeenVersion`, `focus-board:lastSeenUnreleased`, and `bb.workspaceOpenTarget` keep their names and value shapes. Two consequences of the 0.3.1 plugin-rename lesson stand from 1.0.0 onward:

- Renaming any of these keys is a breaking change. A rename needs a
  read-both migration in the same release that ships it.
- No 1.x release resets preferences: corrupt values degrade to their
  documented fallbacks (exactly what the parsers do today), never a wipe.

### Realtime payloads

`done-changed` `{ threadId, done }`, `rank-changed` `{ columnKey }`, and
`snooze-changed` `{ threadId }` keep their names and payload shapes.
Additive fields only.

### Plugin RPC contract (`bb.rpc.register` in `server.ts`)

Every method in `rpcContract` is zod-contracted and frozen for shape and
semantics: `done_list`, `done_set`, `pin_parks_list`, `pin_park_set`,
`snooze_list`, `snooze_set`, `snooze_clear`, `rank_list`, `rank_move`,
`thread_reparent`, `workspace_files_exist`, `workspace_open_targets`,
`workspace_open_in_target`, `tracker_status`, `thread_autotitle`,
`thread_autotitle_services`. The CLI remains the documented public
surface; the RPC contract is frozen for anything that already bridges to
it (such as the autotitle service probe).

## Volatile (never promised)

- Internal module exports (`lib/*`, `components/*`): they change freely.
  The zod contracts above are the boundary, not the JavaScript.
- The board's visual design, menu compositions, and default sorts: these
  change in minors, announced in the changelog.
- New RPC methods and new CLI subcommands: additive on a minor.
- The screenshot and UAT harnesses, generated changelog tooling, and
  everything under `scripts/`: development-only.

## Host and SDK range

- Engines stay `bb >= 0.43` with plugin SDK `>= 0.5.9` in 1.x; the devDependency SDK version tracks bb's current stable per release.
- The plugin leans on host surfaces that are still marked experimental upstream (the workspace file preview among them). A plugin 1.0.0 cannot promise what bb has not: compatibility is verified against a named bb version per release, noted by that release's changelog section, and the embedded pane is re-checked against every new bb stable before the plugin's next cut. The chat-click-jump guard exists precisely because bb host updates can change embedded behavior with no plugin-side change (see `docs/chat-click-jump-2026-09-29.md`).

## Breaking changes

A change that breaks any frozen surface ships as a new major version,
with every removed or reshaped surface listed in its changelog section.
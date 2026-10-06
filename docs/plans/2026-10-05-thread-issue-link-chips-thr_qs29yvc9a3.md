# Plan: Board-linked GitHub issues — own-store chips (thread thr_qs29yvc9a3)

*Repro + root cause: GitHub issue [cristoslc/bb-plugin-focus-board#13](https://github.com/cristoslc/bb-plugin-focus-board/issues/13) ("Board card shows no GitHub-issue chip for a thread linked to an issue (no data path from the GitHub plugin's link records)"). Screenshots attached there.*

## Goal

A thread tied to a GitHub issue or PR shows a `#12`-style chip on its card, with a live OPEN/CLOSED/MERGED status dot, driven entirely by the Focus Board plugin's own data. The official builtin GitHub plugin (`builtin:github` 0.2.1) stores thread↔issue links in bb.db `plugin_kv` rows under its own namespace, and focus-board cannot read another plugin's KV (no cross-plugin surface in `BbPluginApi`, verified in the bundled SDK typings 0.5.29), so the plugin stops watching a foreign store and keeps its own.

## Store shape

Per-thread plugin metadata under pluginId `focus-board`, key `"linkedIssues"` → `ThreadLink[]`:

```ts
type ThreadLink = {
  repo: string;        // "owner/repo" slug
  issue: number;       // issue/PR number, positive int
  kind: "issue" | "pull";
  href: string;        // full https URL
  createdAt: string;   // ISO-8601
  source: "agent" | "operator" | "auto";
};
```

The first entry is the primary link. Helpers follow `lib/done-metadata.ts` exactly: pure functions in `lib/link-metadata.ts`, absent key = unlinked, a malformed present value throws (fail loud, never coerce). Setting an already-linked `repo+number` moves it to the front and refreshes nothing else but stamping stays; clearing removes one entry or all.

## Feed paths

1. **Agent tool** `focus_board_link_issue` (`bb.agents.registerTool`): the tool's `instructions` nudge — the AGENTS.md-style push, appended to thread instructions whenever the tool is in the session's tool set — tells the thread's agent to link what it just filed. Parameters: GitHub issue URL (preferred) or bare number + kind; repo resolved from the URL, or from `ctx.project.gitRemoteUrl` (via `resolveRepoSlug`). Writes go through the same server-side writer the RPCs use, and publish the realtime signal.
2. **CLI** `bb focus-board link list|set|clear`: set takes `<thread-id> <number-or-url>` with `--repo owner/repo` fallback; without `--repo`, the server looks the thread's project up through `bb.sdk.projects.list()` and resolves `gitRemoteUrl`. `--pull` marks kind `pull`.
3. **Auto-detect** (V2, same store): `threads.search` scoped to the project's remote slug, run when a thread's `updatedAt` moves, cached by `threadId + updatedAt`, matched against `https://github.com/<owner>/<repo>/(issues|pull)/\d+`. Multi-match rules from the design discussion apply (auto-link only one in-repo item; otherwise candidates). Explicit `agent`/`operator` links always outrank auto ones.

## RPC surface (server.ts, mirroring done_set/done_list)

- `link_list` (input null) → `{ links: Record<threadId, ThreadLink[]> }`, live threads only (the board renders live columns; archived links resurface with the thread).
- `link_set` `{ threadId, repo, number, kind, source }` → upserts, publishes `link-changed` `{ threadId }`, returns the record.
- `link_clear` `{ threadId, number? }` → removes one number or all; publishes `link-changed`.

Realtime channel `link-changed`. Plugin metadata writes emit no thread realtime event (the reason `done-changed` exists), so a dedicated publish stays.

## Chip merge (client)

- `app.tsx` fetches `link_list` on mount alongside `done_list`, refetches on `link-changed`, and threads `linksByThread` into `statusFor`'s inputs: the `visibleRefKey` memo (app.tsx:899) gains `repo#issue` entries from link records, so the existing batched `tracker_status` fetch covers linked chips for free.
- `thread-card.tsx` merges metadata links into `ticketRefs` (thread-card.tsx:339): a link becomes a `TicketRef` with raw `#N`, tracker `github`, its stored `href`; it is skipped when an existing ref already has the same href (title text wins; dedupe by href because a full-URL title ref and a hash ref for the same item must not render twice). Compact cards keep their no-chip rule.

## CLI + tool surfaces

`bb focus-board link` joins the existing `done`, `snooze`, `autotitle`, `sweep`, `config` command groups (`bb.cli.register` in server.ts:2232). The agent tool registers with a `PluginRowPresentation` `{ glyph }`-free default label and `suppress: true` styling is not used (the link event is worth seeing in the timeline).

## Docs

- `docs/test-coverage-matrix.md`: rows for unit A-D tests.
- `README.md` + `PLUGIN_OVERVIEW.md`: feature bullet (linked-issue chips with live dots) and CLI section entry. (`docs/api_to_audit.md` does not exist in this repo; the agent tool and the three RPC methods are documented here, in the coverage-matrix row, in the README/PLUGIN_OVERVIEW bullets instead.)
- `README.md` + `PLUGIN_OVERVIEW.md`: feature bullet (linked-issue chips with live dots) and CLI section entry.
- `CHANGELOG.md`: `[Unreleased]` bullets ride the merge into `dev` per the repo release rules; the drafted bullet is "Board cards show a GitHub-issue chip for threads linked via the new agent tool, CLI, or RPC, with live OPEN/CLOSED/MERGED status dots."
- Generated `lib/whats-new.generated.ts` is release-time generated, never hand-edited.

## Tests (red first, per the mandatory test-suite standards)

- `tests/link-metadata.test.ts`: parse (absent → null, malformed → throw, round-trip), stamp set-first dedupe, clear one/all, href building.
- `tests/link-rpc.test.ts`: fake-host suite mirroring `tests/done-rpc.test.ts` — set/clear round-trips, `link-changed` payloads, malformed store entry rejects `link_list` loudly, cross-thread isolation.
- `tests/link-cli.test.ts`: number form, URL form, `--pull`, missing repo fallback failure, list render.
- `tests/link-chips.test.ts`: chip merge (link-only card renders chip with href, title-text link skips duplicate, cross-repo link still renders), app-level `visibleRefKey` inclusion via the pure merge helper.
- `tests/link-agent-tool.test.ts`: fake-host registers the tool, execute resolves repo from URL/project remote, publishes + writes; bad input returns an error result (isError), never a thrown validation crash without content.

## Non-goals

- Reading the builtin GitHub plugin's `plugin_kv` link rows (impossible cross-plugin, and the KV-mirror fallback from the issue report is rejected as a race-prone read of the plugin's internal storage).
- Auto-detect (V2 above).
- Writing to GitHub (the plugin mirrors; it never mutates the tracker).
- Bidirectional sync with the builtin plugin's links; a link set in both places is two records, and each surface renders its own.
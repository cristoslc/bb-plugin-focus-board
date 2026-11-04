# Pane parity audit: the pane vs bb 0.48.1's primary chat surface

*2026-11-04 · audit only, no product code · compared Focus Board `dev` at `7159161` (1.7.2-dev) against bb `desktop-v0.48.1` (installed 0.48.1), with the 0.46.0 → 0.48.1 release notes swept for transcript-visible changes · commissioned from the focus-board orchestrator thread.*

## The finding in one paragraph

bb 0.48.0 deliberately closed the gap this pane was built to fill: the changelog's Usability section states "**Side chat and plugin thread chats match the main thread view:** interactions, editing and forking messages, context usage, and the cards above the composer" (bb CHANGELOG.md, 0.48.0). The host rewrote `PluginThreadChat` from a stripped embedded panel to the full `ThreadScreen` (bb `apps/app/src/components/plugin/PluginThreadChat.tsx:296-345`), so the pane's embedded `ThreadChat` (`components/thread-pane.tsx:1183`) now renders the same transcript rows, the same composer, and the same cards as the main thread page. Most of the inventory below is therefore not "the pane lacks X" but "the pane duplicates X that the host now renders, on a premise that expired". Ten gaps follow: nine are missing or divergent behaviors, one is a cluster of stale compensations. Four of the nine need upstream (SDK or host) cooperation; five are fixable inside this repo.

## How the pane is built (for reading the citations)

The pane renders two plugin-side cards above an embedded host chat: `PendingInteractionCard` (`components/thread-pane.tsx:1157`), `DecidedQuestionsCard` (`components/thread-pane.tsx:1162`), then the SDK's `ThreadChat` with `variant="compact"` and `layout="contained"` (`components/thread-pane.tsx:1183`). The SDK's `ThreadChat` is a runtime component the host supplies (`packages/plugin-sdk/src/app.ts:118`); the host implementation is `PluginThreadChat`, which renders bb's own `ThreadScreen` with presentation `{ kind: "panel", measure: "panel", tone: "sidebar" }` (`apps/app/src/components/plugin/PluginThreadChat.tsx:296-305`). `ThreadScreen` is the same component the main thread page uses; only the surrounding chrome differs (`apps/app/src/views/thread-detail/ThreadScreen.tsx:606-666`). A transcript row type exists in the pane if and only if it exists in the main view, because both render `ThreadTimelineSurface` (`ThreadScreen.tsx:503-555`).

Both cards' header comments state premises about the host that the 0.47.x/0.48.x releases falsified. That is the audit's core.

## Gaps

Each gap: what the primary surface shows, what the pane does today, the impact, a suggested approach, and a coarse cost (S ≤ a day, M = a few days, L = needs design or upstream work).

### Gap 1 — A pending question renders twice in the pane

- **Primary surface:** when an interaction is pending, the composer renders `ThreadPendingInteractionBanners` — the full interactive forms for user questions, plan reviews, approvals, and plugin forms (`ThreadScreen.tsx:459-461` fetches pending interactions with no presentation gate; `ThreadDetailPromptArea.tsx:2219-2232` renders the banners into the composer stack; `ThreadPendingInteractionBanner.tsx:104-158` dispatches to the question form, plan review, approval, and plugin-form composers).
- **Pane today:** the plugin-side `PendingInteractionCard` renders its own question form above the chat (`components/thread-pane.tsx:1153-1157`, `components/pending-interaction-card.tsx:836-1086`). Its header comment — "the host's embedded chat renders no interaction UI at all (only the main thread view does)" (`components/pending-interaction-card.tsx:16-20`) — was true before 0.48.0 and is false on 0.48.x: the embedded chat's composer now renders the banner forms. An operator with the pane open sees the plugin's question card and the host's question banner at the same time, two forms for one interaction.
- **Impact:** double question forms in one pane; answering one leaves the other stale until refresh, and the pane carries ~1,000 lines of re-implemented host UI to maintain.
- **Approach:** drop the card's question-form role and keep only what the host banner lacks (nothing found this pass — the banner renders every kind the card handled, including plugin forms via `PluginPendingInteractionComposer`, `ThreadPendingInteractionBanner.tsx:148-158`). Keep the card's localStorage draft-persistence tests only if the host banner's draft behavior is confirmed weaker; 0.46.0 already ships "keep partial answers while navigating" (bb CHANGELOG.md, 0.46.0 Composer).
- **Cost:** S (removal plus screenshot-harness coverage that a pending question shows exactly one form in the pane).

### Gap 2 — The recent-decisions card duplicates rows the transcript now renders

- **Primary surface:** answered questions persist and render. Provider `user_question` interactions produce a `question` work row carrying `questions` and `answers: interaction.resolution?.answers` (`packages/thread-view/src/parse-operation-message.ts:370-391`), rendered as prompt-plus-answer text for lifecycle `answered`/`resolving` (`apps/app/src/components/thread/timeline/QuestionWorkRowBody.tsx:16-58`). Plugin-form interactions persist `resolution: { kind: "plugin_submitted", description: { title, detail, payload: { questions, answers } } }` (`apps/server/src/services/interactions/pending-interactions.ts:665-670`), and the `form` work row takes its title and detail from that description — bb renders "Answered <prompt> — <label>" in the turn (`parse-operation-message.ts:407-446`; verified against bb 0.48.0 in [get-bb/bb#4463](https://github.com/get-bb/bb/issues/4463) "Plugin-form (AskUserQuestion) answers are never persisted to the interaction record, so the transcript loses every answered question", closed 2026-10-29, crediting `describeSubmission` persistence #3878/#5263).
- **Pane today:** `DecidedQuestionsCard` rebuilds decisions by parsing raw `client/turn/requested` events, on the stated premise that "the host transcript drops every trace of an answered AskUserQuestion … the interaction row stores only `plugin_submitted` — no answers" (`components/decided-questions-card.tsx:9-23`, parsing at `:72-78`). That premise is false on 0.47.0+ (provider answered rows, first release with `QuestionWorkRowBody`) and 0.48.0+ (plugin-form answered rows). The pane does render the transcript's answered rows — it uses the same `ThreadTimelineSurface` — so the card is a second, weaker copy (max 5, text-parsed) of what the transcript already shows.
- **Impact:** the same decision appears twice in the pane in two formats, and the card's text-parsing is a maintenance liability against a structured source that now exists.
- **Approach:** remove the card; if the operator values a cross-restart "recent decisions" digest, rebuild it from the structured `resolution.description.payload` instead of event-text parsing — but the transcript rows already cover the need.
- **Cost:** S.

### Gap 3 — No unread/NEW divider and no reading-position landing in the pane

- **Primary surface:** the main view computes an `unreadDividerState` (placement plus auto-scroll) and honors the experiments "unread threads open at the NEW divider" (bb CHANGELOG.md, 0.47.0, App) and "NEW divider before final assistant message: a thread that finished while you were away opens at its answer instead of its first tool call" (bb CHANGELOG.md, 0.48.0, New experiments; experiment flag `unreadDividerAtAnswer`, `apps/app/src/views/thread-detail/ThreadDetailView.tsx:387-398`, passed at `:1739-1740`).
- **Pane today:** the plugin path hardcodes `unreadDividerAutoScroll: false` and `unreadDividerPlacement: null` (`apps/app/src/components/plugin/PluginThreadChat.tsx:339-340`), and the SDK's `ThreadChatProps` exposes no way to change it (`packages/plugin-sdk/src/app-contract.ts:4614-4645`). The pane always lands at the bottom with no marker of what is new.
- **Impact:** reopening a pane on a thread that finished while away shows the answer with no divider saying where "new" begins — the main view's reading-position affordance is silently absent on the board.
- **Approach:** needs upstream — either the host stops overriding the divider for plugin panels, or the SDK exposes the two props. File a bb feature request citing the 0.48.0 experiment; until then nothing to ship here.
- **Cost:** L (upstream-dependent).

### Gap 4 — File-change row titles are dead clicks in the pane

- **Primary surface:** a file-change row's title is clickable; the click resolves a `TimelineTitleAction` of kind `open-file-diff` and opens the file's diff in the main view's secondary panel (`packages/thread-view/src/timeline-row-title.ts:105-113` builds the action; `apps/app/src/components/thread/timeline/TimelineTitleView.tsx:35-41,325-329` render it only when a resolver is wired; `ThreadDetailView.tsx:1303-1315` wires `handleTimelineTitleAction`). Delegation rows that point at a side-chat plugin thread carry the second action kind, `open-plugin-side-chat` (`timeline-row-title.ts:111-113`).
- **Pane today:** the plugin path passes no `onTitleAction` (`apps/app/src/components/plugin/PluginThreadChat.tsx:334-341` omits it), so `title.action && onTitleAction` is null and the click does nothing. The pane's own link decoration (`components/thread-pane.tsx:547-620`) claims markdown links and inline code, not row titles.
- **Impact:** every file-change row in the pane looks like the main view's clickable title but is inert — a dead affordance on one of the most common row types.
- **Approach:** two options — small: detect title-action rows in the pane's existing click-capture and open the thread in the main view (maximize) where the diff opens; or upstream: give plugin panels a default resolver. The partial fix is in this repo.
- **Cost:** S for the maximize-and-open fallback; M for a real in-pane answer (needs a diff surface the pane does not have).

### Gap 5 — Other plugins' message and selection actions are absent in the pane

- **Primary surface:** plugins register per-message actions and selection-menu actions through the plugin registry; the main view includes them (`ThreadTimelineRows.tsx:2400-2406` gates plugin selection actions on `includePluginMessageActions !== false`; `:2462-2467` the same for row actions; `ThreadDetailView` leaves the flag at its default true).
- **Pane today:** the plugin path hardcodes `includePluginMessageActions: false` (`apps/app/src/components/plugin/PluginThreadChat.tsx:334`) and the SDK lets the consumer pass only its own `messageActions` (`app-contract.ts:4641-4645`), which Focus Board does not pass (`components/thread-pane.tsx:1183`).
- **Impact:** a row action that works in the main view (for example another plugin's "open in X") is missing in the pane, so the transcript behaves differently depending on which surface shows it.
- **Approach:** in-repo half — pass Focus Board's own `messageActions` if the board wants any (for example "open this thread on the board"); the other-plugins half needs upstream to relax `includePluginMessageActions` for plugin panels.
- **Cost:** S in-repo; the full fix is upstream.

### Gap 6 — No table of contents in the pane

- **Primary surface:** the page presentation mounts `ThreadTableOfContents` beside the transcript, with navigation-to-row (`ThreadScreen.tsx:623-637`, page case only).
- **Pane today:** the panel presentation renders no TOC (`ThreadScreen.tsx:643-653`), and the SDK exposes none.
- **Impact:** long transcripts in the pane have no jump navigation; the operator scrolls or uses find.
- **Approach:** upstream — ask for the TOC in panel presentations or an SDK surface; an in-pane re-implementation would duplicate host UI the pane just finished deleting.
- **Cost:** L (upstream-dependent).

### Gap 7 — Thread context card slots do not render in the pane

- **Primary surface:** 0.48.1 added the thread context card behind an early-adopter experiment (bb commit #6529 "Add the thread context card behind an early-adopter experiment", 2026-10-29), a plugin-slot surface (rows and sections) mounted beside the page transcript (`apps/app/src/components/plugin/PluginThreadContextCard.tsx:37-63,104+`; `ThreadScreen.tsx:625` mounts it on page, `:645` wraps panels in `WithoutThreadContextCard`).
- **Pane today:** panels explicitly exclude the card, and the SDK exposes no slot for it.
- **Impact:** plugins that add context-card rows show them in the main view only; the pane is a second-class transcript for that new surface.
- **Approach:** upstream; track it so the pane is not forgotten when the experiment graduates.
- **Cost:** L (upstream-dependent).

### Gap 8 — The pane never focuses the composer

- **Primary surface:** the SDK's `focusRequest` prop bumps composer focus (`app-contract.ts:4627-4628`); the main view and side chats wire it where needed.
- **Pane today:** Focus Board passes only `threadId`, `variant`, and `layout` (`components/thread-pane.tsx:1183`); nothing in the pane ever requests composer focus, so opening the pane, clicking a card, or returning to a thread always leaves the composer unfocused.
- **Impact:** keyboard-first operators must click into the composer by hand every time they open or switch a pane.
- **Approach:** add a `focusRequest` counter to `ThreadPaneThread` open/switch and pass it through; optionally a "focus composer on open" preference.
- **Cost:** S.

### Gap 9 — Composer menu entries for thread Info and same-environment spawn are hidden

- **Primary surface:** the composer host options `onOpenThreadInfo` and `onCreateNewThreadInEnvironment` gate those entries (`ThreadScreen.tsx:578-579`, `ThreadScreenComposerHost` at `:112-120`); the main view supplies both.
- **Pane today:** `PluginThreadChat` supplies neither (`apps/app/src/components/plugin/PluginThreadChat.tsx:311-319` sets only checkout, chrome, focus, context environment, and permission policy), so the entries are hidden. The board's own actions menu has "New child thread…" (`components/thread-pane.tsx:1051-1060`) but no thread-Info path short of maximizing.
- **Impact:** the operator cannot open thread Info (context window detail, automations, storage) or spawn a thread in this environment without leaving the pane.
- **Approach:** maximize-and-open fallback via the pane's existing actions menu; or upstream to default the entries in panels.
- **Cost:** S.

### Gap 10 — Stale compensations: three pane mechanisms whose premises predate 0.48.x

Each is code the pane carries against a host behavior that 0.48.0's scroll and presentation rewrite may have removed. None is verifiable statically; each needs one runtime probe, then retirement or retention with a dated note.

1. **Chat-click jump guard** — `components/chat-jump-guard.ts`, armed at `components/thread-pane.tsx:756-763,781-788`, documented in `docs/chat-click-jump-2026-09-29.md` against bb 0.44.0's page-shell scroll manager. 0.48.0 replaced the page shell behind panel presentations with `BottomAnchoredScrollBody` + `ScrollPositionKeeper` and shipped the scroll-accuracy fixes #5951 → #6405 → #6434 ("Keep an attached timeline at the end through scrolls with no input", 2026-10-27, in 0.48.0) and #6437. Probe the original repro (`scripts/probe-chat-click-jump.mjs`) on 0.48.1; retire the guard if the jump is gone.
2. **Touch-reveal CSS overrides** — the pane re-emits the host's `[@media(hover:none)]` utilities so the queued-message row's "…" is reachable on phones (`components/thread-pane.tsx:1163-1183`, tracked as Focus Board [#296](https://github.com/cristoslc/bb-plugin-focus-board/issues/296), "In the Focus Board pane on a touch phone the queued-message actions control is invisible, so its Send button cannot be reached", closed fixed-by-workaround). Re-run the `uat` touch suite on 0.48.1; if the host scoping now keeps the control visible unaided, drop the overrides.
3. **Context-row fallback** — `components/pane-context-row.tsx` via `usePaneContextRowMissing` (`components/thread-pane.tsx:750-755,1185-1192`) compensates for the composer footer's collapsed project/checkout chips. It self-quiets when the host paints its own row, so worst case it is dead code, but the collapse heuristic should be re-verified against 0.48.1's rewritten composer footer (`ThreadDetailPromptArea` → `FollowUpPromptBox` `environmentSummary`/`compactEnvironmentSummary`, `ThreadDetailPromptArea.tsx:2270-2280`).

**Impact:** stale compensations can misfire against the rewritten host (the guard can fight a legitimate scroll restore), and all three are untested against the version that now ships.
**Approach:** one verification pass per item on 0.48.1, retire what fails to reproduce, date-stamp what stays.
**Cost:** S each.

## What the pane already does at parity (so the gap list stays honest)

The pane embeds the host's full chat; these hold on 0.48.1 without plugin-side work. Citations are the shared code paths the pane renders.

1. **Every transcript row type.** The contract enumerates conversation (user/assistant, attachments, mentions, per-turn request kind `message`/`steer` with pending/accepted/rejected status), work rows (command, tool, file-change, web-search, web-fetch, image-generation, image-view, file-read, search, plan-steps, extension, approval with `file-edit` and `permission-grant`, question, form, delegation with nested `childRows`, workflow), system rows (`debug`, `error`, `reconnect`, plus operations `generic`, `reasoning`, `compaction`, `context-clear`, `parent-change`, `thread-provisioning`, `thread-interrupted`, `provider-unhandled`, `warning`, `deprecation`), and `turn`/`bundle-summary`/`step-summary` (`packages/server-contract/src/thread-timeline.ts:98-114,163-174,260-640`). The pane renders all of them via the same `ThreadTimelineSurface` (`ThreadScreen.tsx:503-555`). Steering chips, compaction summaries, subagent/delegation rows, and workflow rows are therefore at parity.
2. **Pending interactions, all kinds.** The composer banner forms render in the pane (`ThreadScreen.tsx:459-461`; `ThreadDetailPromptArea.tsx:2219-2232`; `ThreadPendingInteractionBanner.tsx:104-158`) — 0.48.0's parity work. (The duplication is Gap 1; the capability itself is present.)
3. **Queued sends.** Full queued list with send-now/steer-when-ready, reorder, group boundary, inline edit, delete, and the collapsed-count card (`ThreadDetailPromptArea.tsx:2140-2171`; actions at `:905-930`).
4. **Sent-message editing and forking.** `useSentMessageEditing` runs for any presentation with a composer (`ThreadScreen.tsx:488-499`); fork is wired when the provider supports it (`PluginThreadChat.tsx:320-345`) — 0.48.0's "editing and forking messages".
5. **Cards above the composer:** todos, prompt mode, goal, active workflows, background commands, model fallback, parent/child thread banners including answering a child's question in place (`ThreadScreen.tsx:591-600`; `ThreadDetailPromptArea.tsx:2069-2136`).
6. **Context window usage.** `contextWindowUsage` renders in the shared composer indicator (`ThreadScreen.tsx:567`; `apps/app/src/components/promptbox/FollowUpPromptBox.tsx:832`).
7. **Steering.** Enter-steers-while-running follows the system setting (`ThreadScreen.tsx:585-588`), and steered turns render the `steer` request kind on the user row (`thread-timeline.ts:98-114`).
8. **Approvals.** Permission-grant and file-edit approval rows with auto-expansion (`thread-timeline.ts:454-502`; `apps/app/src/components/thread/timeline/timeline-auto-expand.test.ts:1-30`), chained commands per line since 0.47.0 (bb CHANGELOG.md, 0.47.0).
9. **Answered questions in the transcript.** Provider rows since 0.47.0, plugin-form "Answered" rows since 0.48.0 (Gap 2's citations) — the pane shows them.
10. **Read tracking.** Opening the pane marks the thread read via the host's `useThreadReadTracking` (`PluginThreadChat.tsx:112-118`).
11. **Selection → Add to chat.** The composer exists in the pane, so `selectionAddToChat` is wired (`ThreadScreen.tsx:501-504`).
12. **Stop and connection states.** Stop-requested row, working/catch-up indicators, host-disconnected notice (`ThreadTimelineSurface.tsx:88-135,257-278`).
13. **History windowing.** Load-older/auto-load and the 0.48.0 delta-update protocol reach the pane through the shared controller (`ThreadTimelineSurface.tsx:204-221,284-326`; bb CHANGELOG.md, 0.48.0 Performance).
14. **Images.** Lightbox zoom/pan and galleries render from shared components (bb CHANGELOG.md, 0.48.0 Usability).
15. **External and app links.** Link routing is per-anchor in the shared markdown renderer (`apps/app/src/lib/url-open-routing.tsx:96-115`), so the browser/app-link preference applies inside the pane too.
16. **Attachments and paste.** The composer's attachment pipeline is the host's own; the known paste-to-attachment → OMP `resource_link` defect (`docs/upstream/bb-bug-report-pasted-attachments-omp-resource-link.md`) is transport-level and affects both surfaces identically.
17. **The permission picker being read-only in the pane is a boundary, not a gap.** The SDK doc is explicit: `"inherit"` "pins every send to the thread's own resolved default … a plugin surface can never widen it" (`app-contract.ts:4629-4637`).
18. **Tabs (Terminal, Diff, Info, Browser, plugin tabs) are outside the chat surface by the pane's design.** They exist on the main thread page (`ThreadDetailView.tsx:1745-1760`); the pane's answer is Maximize. Listed here so the boundary is a recorded decision rather than an unexamined absence.

## Ranked shortlist

1. **Gap 1 — double question form (S).** Active operator-facing confusion on every pending question, and the fix deletes ~1,000 lines of host-duplicated UI. Chase first.
2. **Gap 2 — decisions card duplicate (S).** Same shape as Gap 1: stale premise, cheap removal, transcript already covers the need.
3. **Gap 4 — dead file-change title clicks (S for the fallback).** A dead affordance on the most common row type; the maximize-and-open fallback is small and honest about the pane's limits.
4. **Gap 10 — stale compensations (S each).** Three mechanisms of unverified code against a rewritten host; one probe each, then delete or date-stamp. Pairs naturally with 1–3 in one cleanup cut.
5. **Gap 8 — composer focus (S).** Small quality-of-life win, fully in-repo.
6. **Gap 5 — message actions (S in-repo half).** Ship the board's own actions if wanted; file the upstream ask for other plugins' actions alongside Gap 3's.
7. **Gaps 3, 6, 7, 9 — the upstream batch (M/L).** One bb feature request covering the plugin-panel overrides (`unreadDividerPlacement`/`unreadDividerAutoScroll`, `onTitleAction`, `includePluginMessageActions`, TOC, context card, composer menu entries) is worth more than four separate asks; none blocks the in-repo work above.

## Method note

bb-side citations are paths at the `desktop-v0.48.1` tag in the get-bb/bb repo (the tag exists locally; the installed `bb --version` is 0.48.1). Focus Board citations are `components/…` file:line at `dev` `7159161`. Release-note quotes are from bb's CHANGELOG.md at the tag. The #4463 closure comment (0.48.0 verification, `describeSubmission` persistence) and the #6434 commit message were read from the tracker and git history respectively. Nothing here was verified in a running 0.48.1 UI; every static conclusion that depends on runtime behavior (all of Gap 10, and the Gap 1 double-form claim) is marked for a runtime probe before any fix lands.

> AGENT GENERATED CONTENT

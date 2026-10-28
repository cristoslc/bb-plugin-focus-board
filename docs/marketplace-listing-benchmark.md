# Marketplace listing benchmark

Focus Board competes for installs inside the bb community marketplace, so its listing copy competes with every other community plugin's. This document benchmarks our store copy against the top installed community entries, reports where our structure and style diverge, and proposes a tightened short `description` and a rewritten `PLUGIN_OVERVIEW.md`.

Gathered 2026-10-28 against the live catalog served by `bb plugin search` on bb 0.47.1. The listing has two author-owned pieces:

- The short `description` is a frozen-v1 field in `entries/focus-board.json` in the [get-bb/marketplace](https://github.com/get-bb/marketplace) repo. It can only be changed by a marketplace pull request carrying the `v1-change` label, so the replacement proposed below lives in this document until the operator opens that separate pull request.
- The long `overview` is this repo's root `PLUGIN_OVERVIEW.md`, copied verbatim to `overview/focus-board.md` in the marketplace repo. A rewritten copy lands here and ships to the store through the same marketplace pull request.

## How the numbers were gathered

`bb plugin search <query> --json` returns each listed plugin with `installs`, `description`, `overview`, `screenshots`, and `category`. A single broad query does not surface every community entry, so the script below sweeps single characters and common bigrams, merges by `entryId`, keeps entries whose `marketplace` is `bb-community`, and sorts by installs. It reached 442 community entries, which matches the count a single wide `bb plugin search e --json` returns. Run it from a machine with `bb` on `PATH`. It reads no network beyond bb's own store.

```js
// node gather-marketplace.mjs > community.json
import { execFileSync } from "node:child_process";

const queries = [
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  ..."0123456789".split(""),
  "bb", "th", "er", "in", "on", "an", "re", "st", "ce", "de", "ll", "la",
  "se", "te", "to", "tt", "ss", "pp", "rr", "oo", "ee", "aa", "ii",
];

const byId = new Map();
for (const q of queries) {
  const arr = JSON.parse(execFileSync("bb", ["plugin", "search", q, "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }));
  for (const e of arr) {
    if (e.marketplace !== "bb-community") continue;
    byId.set(e.entryId, e);
  }
}
const rows = [...byId.values()].sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0));
console.log(JSON.stringify({ communityCount: rows.length, rows }));
```

Character counts are JavaScript string lengths. Sentence counts split on `[.!?]` followed by whitespace or end of string. "Overview chars" is the `overview` field's length, 0 when absent.

## The top 25 community entries by installs, beside ours

| Rank | Entry                  | Installs | Desc chars | Desc sentences | Has overview | Overview chars | Screenshots | Category               |
|------|------------------------|----------|------------|----------------|--------------|----------------|-------------|------------------------|
| 1    | bb-sidebar             | 709      | 121        | 1              | no           | 0              | 2           | Thread Management      |
| 2    | usage-tracker          | 552      | 191        | 2              | no           | 0              | 1           | Token Usage & Limits   |
| 3    | file-manager           | 530      | 631        | 6              | yes          | 2615           | 3           | File Viewers & Editors |
| 4    | genui                  | 396      | 800        | 5              | yes          | 2443           | 3           | Thread Content         |
| 5    | taskboard              | 396      | 195        | 1              | no           | 0              | 0           | Tasks & Workflows      |
| 6    | t3sidebar              | 394      | 89         | 1              | no           | 0              | 0           | Thread Management      |
| 7    | files-editor           | 367      | 1080       | 7              | no           | 0              | 3           | File Viewers & Editors |
| 8    | usage                  | 358      | 80         | 1              | no           | 0              | 0           | Token Usage & Limits   |
| 9    | bots-sidebar           | 349      | 420        | 5              | yes          | 1447           | 3           | Agents & Providers     |
| 10   | agent-graph            | 348      | 188        | 1              | yes          | 1240           | 1           | Thread Management      |
| 11   | context-meter          | 348      | 116        | 1              | no           | 0              | 0           | Token Usage & Limits   |
| 12   | handoff                | 311      | 329        | 1              | no           | 0              | 0           | Agents & Providers     |
| 13   | agent-board            | 281      | 257        | 5              | yes          | 1383           | 1           | Thread Content         |
| 14   | notify                 | 257      | 129        | 1              | no           | 0              | 0           | Notifications          |
| 15   | message-timestamps     | 238      | 77         | 1              | no           | 0              | 0           | Thread Content         |
| 16   | beautiful-chat         | 230      | 136        | 1              | yes          | 2418           | 2           | Themes & Appearance    |
| 17   | thread-namer           | 219      | 169        | 1              | no           | 0              | 0           | Thread Management      |
| 18   | image-preview          | 214      | 78         | 1              | no           | 0              | 0           | Thread Content         |
| 19   | google-antigravity-acp | 209      | 159        | 2              | no           | 0              | 0           | Agents & Providers     |
| 20   | usage-page             | 209      | 89         | 1              | no           | 0              | 0           | Token Usage & Limits   |
| 21   | advisor                | 208      | 114        | 1              | yes          | 2058           | 2           | Code & Reviews         |
| 22   | aura                   | 202      | 315        | 4              | no           | 0              | 4           | Themes & Appearance    |
| 23   | chime                  | 201      | 116        | 1              | no           | 0              | 0           | Notifications          |
| 24   | linear                 | 199      | 272        | 1              | no           | 0              | 0           | Tasks & Workflows      |
| 25   | agentation             | 199      | 211        | 1              | no           | 0              | 0           | Plugin Development     |
| 51   | focus-board            | 108      | 463        | 3              | yes          | 1520           | 2           | Thread Management      |

Aggregates:

- Median short-description length: 193 chars across the top 10, 164 across the top 20, 169 across the top 25. Ours is 463, roughly 2.8x the top-20 median.
- 19 of the top 25 descriptions run one or two sentences. Ours runs three.
- 14 of the top 20 have no overview at all. Of the six that do, lengths run 1240 to 2615 chars, median 1933. Ours is 1520, so our overview length already sits inside the range. The divergence is structural, not size.
- 14 of the top 25 ship no screenshots. Ours ships two, so screenshots are not the differentiator.
- 21 of the top 25 descriptions carry no semicolon, and 22 carry no em dash. Ours carries three semicolons and one em dash.

## Style findings

Length is a symptom, not the rule. The common property across the top entries is that each description delivers one idea, and the ranking does not punish the handful of entries that spend more words on a single product area in depth.

**One value sentence leads.** The strongest leads name what the thing is and immediately say what it is for, often with a named differentiator or a contrast against the default:

- context-meter (116 chars): "Keeps threads in the smart zone, by tracking context against a limit you set rather than the provider's full window."
- bb-sidebar (121 chars): "A sidebar inspired by T3 Code that adds manual and automatic thread sorting, collapsible shelves, and bulk actions to bb."
- notify (129 chars): "Sends a native macOS notification when a bb thread finishes or fails, and adds a notify_user agent tool plus a bb notify command."
- agent-graph (188 chars): "Shows your bb agents as a live node graph of threads, turns, tool calls, subagents and workflow agents, color-coded by type or status, so you can see what every agent is doing at a glance."

**Feature enumeration is rare and earns its place.** Only the three longest outliers (file-manager 631, genui 800, files-editor 1080) list several capabilities, and each spends the words on concrete, specific behavior rather than a tour of every control. Meanwhile usage-tracker (191) enumerates providers because the provider list is the product ("Track Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity, and DeepSeek"). Enumeration is not banned. A long flat inventory of every button is what reads as unfocused.

**No semicolon chains, rarely an em dash.** 21 of the top 25 avoid semicolons and 22 avoid em dashes entirely. A chain of `;`-joined clauses reads as a spec, not a hook. The two entries that lean on semicolons (file-manager and files-editor) are the longest in the set and still sit at ranks 3 and 7, so the pattern costs clarity rather than installs, and clarity is the thing we can still fix.

**The overview is optional and, when present, pillar-shaped.** The six top-20 entries that ship an overview all follow the same shape: a one-line hook, a `## What you get` heading with a handful of bold-led flat bullets, then optional `## How it works` and `## Requirements` sections. None nests sub-bullets under a bullet. None chains semicolons inside a bullet. Ours nests sub-bullets under each pillar, chains a semicolon in the lead, uses an em dash mid-bullet, and spends a parenthetical inventory in the CLI line.

## Where our lead already works

"A kanban of your bb threads, focused on what needs you first." (61 chars) is a single sentence with a named value and a concrete frame, in the register of bb-sidebar and context-meter. It is the strongest line on the page, it is the lead the marketplace already ships, and it stays verbatim in the proposal below. The opening is fine. The problem is everything the description keeps going after it.

## Where ours breaks the pattern

- **Three sentences where the pack uses one or two.** Sentences 2 and 3 are a feature tour: grouping, drag, sweep, snooze, search, card contents, click behavior.
- **Two semicolon chains.** "Group threads by ... ; drag to act ... ; sweep stale lanes ..." and "Cards show state, pin, ... ; a click opens ...".
- **An em dash** in "drag to act — hand-order a column".
- **A flat inventory of card contents** ("state, pin, pending-interaction badge, update time, and branch or host") that describes the UI rather than the value.
- **The overview nests sub-bullets** under each pillar and repeats the description's enumeration, and its CLI line carries a parenthetical command inventory.

## Drift across the four copy surfaces

The product's one-line value statement appears on four surfaces, and all four disagree in wording. Numbers are character counts.

| Surface | Lead text | Chars |
|---|---|---|
| Marketplace `description` (live) | "A kanban of your bb threads, focused on what needs you first." | 61 |
| `PLUGIN_OVERVIEW.md` (line 1) | "Focus Board is a nav panel in the bb sidebar that shows all your threads as a kanban board." | 91 |
| `package.json` `bb.description` | "A kanban board of your threads, focused on what needs you first." | 64 |
| `README.md` (line 4) | "A kanban board for your bb threads, grouped by what needs your attention." | 73 |

The drift, item by item:

- **Noun form.** Marketplace says "A kanban", package.json and README say "A kanban board", and the overview calls it a "nav panel" until it reaches "kanban board" mid-sentence.
- **Preposition.** Marketplace and package.json say "of your threads", while README says "for your bb threads".
- **Scope word.** Marketplace and README say "bb threads", while package.json says plain "threads".
- **Value clause.** Marketplace and package.json say "focused on what needs you first", while README says "grouped by what needs your attention".
- **Depth.** The marketplace description runs to 463 chars with a feature walkthrough, while the other three are one line each. The marketplace copy is also the only surface that names "pending-interaction badge", a term that appears nowhere else.

None of this is required to change in this pull request, and the marketplace surface can only change through the operator's frozen-v1 submission. It matters because the four lines should agree once the submission ships.

## Proposed short `description`

Proposed replacement, to be pasted into the marketplace entry when the operator opens the `v1-change` pull request. It keeps the strongest lead verbatim, drops the feature enumeration, and adds one concrete differentiator.

> A kanban of your bb threads, focused on what needs you first, where you act on a thread by dragging its card instead of opening a menu.

135 characters. One sentence. Zero semicolons, zero em dashes. It keeps the 61-char lead, names the board's one distinctive interaction (acting on a thread is a drag, not a menu), and drops the group/drag/sweep/snooze/search tour and the card-contents inventory. It sits between bb-sidebar (121) and context-meter (116) in the pack rather than chasing the median, because the pack's median is pulled up by four long outliers and the mode is one idea in roughly 120 to 190 chars.

## Proposed `PLUGIN_OVERVIEW.md`

The rewrite lands in this repo and follows the pillar rule already stated in `.agents/agents-md-detail/release.md`: a handful of bold-led capability bullets, each an invitation rather than a specification, at most two short sentences each, no nested sub-bullets, no parenthetical inventories, no semicolon chains. The before and after:

| | Bytes | Chars | Pillars | Nested sub-bullets | Em dashes in prose | Semicolons |
|---|---|---|---|---|---|---|
| Before | 1525 | 1520 | 3 | 4 | 2 | 1 |
| After | 1203 | 1203 | 3 | 0 | 0 | 0 |

The before copy also carried three ASCII double hyphens (`--`) where a dash belonged.

The rewrite stays well under the marketplace's hard 4000-character overview cap. Its full text is the root `PLUGIN_OVERVIEW.md` in this pull request.

## What this pull request does not do

It does not touch the get-bb/marketplace repo, does not push a branch there, and does not open a pull request there. The short `description` is a frozen-v1 field that needs the `v1-change` label, which a submitter cannot self-apply, so the store submission is the operator's call. Shipping the new copy to the marketplace needs that separate pull request, which should carry this repo's `PLUGIN_OVERVIEW.md` verbatim as `overview/focus-board.md` and the proposed `description` above. Aligning `package.json`'s `bb.description` and the README opening with the same lead belongs in that follow-up.

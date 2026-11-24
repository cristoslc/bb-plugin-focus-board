# The web-browser card click, measured

> The operator's report, verbatim: "split pane not working in web browser, but not falling back to in-pane panel either -- just navs whole page"

This folder holds the probe that drove the report in Chrome against the installed bb 0.50.1 host, before and after the fix. The headline is that the report did **not** reproduce: every phase either split beside the board or opened the board's own pane, the board never vanished, and no phase performed a document navigation. The condition the report needs is still missing, and the fix below covers the state the report names even though the probe cannot reach it.

## What ran

`scripts/screenshot/probe-web-one-pane.mjs`, a fresh browser profile and a fresh bb context per phase, the click's own branch lines on (`nativeOpenDebug`), sampling the host's layout atom, the rendered pane containers, the route and the board marker at 0, 50, 150, 300, 600, 1000, 2000 and 4000ms after one card click.

| Run | Bundle served | 1600px | 1024px | 700px |
|---|---|---|---|---|
| `before/` | `bd255bbfbd268032`, no split guard | split, 2 panes, board mounted | split, 2 panes, board mounted | board's own pane, board mounted |
| `after/` | `780feef1e2210812`, carries the split guard | split, 2 panes, board mounted | split, 2 panes, board mounted | board's own pane, board mounted |

Both `evidence.json` files record the served bundle hash and whether its bytes carry the guard's `restore-only` token, so "which code ran" is a fact in the evidence rather than an assumption. Every phase's final sample carries a live boot marker, which means the module scope survived: **no phase was a document navigation**.

The branch lines, identical in both runs:

```
[focus-board:native-open] {"threadId":"…","branch":"one-pane: asking the opener for the split","compactViewport":false,"layout":null,"record":null}
[focus-board:native-open] {"threadId":"…","branch":"one-pane: the host split","paneId":"pane-2"}
[focus-board:native-open] {"threadId":"…","branch":"in-board: compact viewport","compactViewport":true,"layout":null,"record":null}
```

## The extra states, `before/`

These driven states are recorded beside the canonical phases, each with its own JSON:

| File | State |
|---|---|
| `states-sidebar-secondpane-reload.json` | the board reached from the sidebar's Focus Board entry, a second pane opened from bb's own "Open in split", and a click after a reload |
| `early-click.json` | six runs that click the first card as soon as it exists after a page load, before a comfortable settle |
| `cross-tab-layout-reset.json` | a second tab writes the empty split-layout atom while the board is open, the closest the probe could get to a host with no layout to split |
| `F-detail-*` | the plugin detail route `/plugins/focus-board` renders no board at all, so it cannot be the reported state |

Every one of them split or fell back to the board's own pane.

## Why the fix exists anyway

The report names one state the probe cannot create on this host: a split ask answered by a plain navigation while the click believed it had asked a host that could split. On 0.50.1 that needs the host's own predicate to disagree with what the board read. The code had a real hole there, independent of how the disagreement arises: the fresh-pane and replacement asks were settled by React effects that die with the panel, so a whole-page answer from either branch left the operator with neither surface, which is exactly "not falling back to in-pane panel either".

The repair (`lib/native-one-pane-dance.ts`) is now armed for every split ask, not only the one-pane one, and it adds one later watch so a host that answers after the board's own pane opened is caught too. `tests/app-card-click-one-pane-split.test.tsx` drives the state by holding the host's placement back and destroying the panel, and `tests/native-one-pane-dance.test.ts` pins the four answers plus the late watch.

## The gap, stated plainly

The repair itself is proved in jsdom, not live, because the installed host never answers with a whole-page navigation here. If the operator can supply the missing condition (browser, window width, splits setting, and whether the click came from a card or a menu), re-running this probe with `OUT_DIR` pointed at a new folder will show the branch line and the guard's outcome line in the same evidence shape.

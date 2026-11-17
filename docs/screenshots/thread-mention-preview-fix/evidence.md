# Thread mention opened a "File not found." preview — evidence

The operator's follow-up report (2026-11-17): clicking the
"Refine strategic engineering goals" reference inside the pane opened a
right-hand panel titled `@thread:thr_cvvvkw6rjz` reading "File not found."
Phase 2 of the pane link-routing work; the directory-reference case from
2026-11-16 stays its own decision.

## The anchor's DOM, captured live (bb 0.49.0, pane of `thr_msyjn52jwr`)

```html
<a class="break-words [overflow-wrap:anywhere] underline underline-offset-2"
   href="file:///Users/cristos/Documents/projects/bv-brain2/%40thread%3Athr_cvvvkw6rjz"
   rel="noopener noreferrer" target="_blank">Refine strategic engineering goal<span
   class="whitespace-nowrap"><span data-focus-board-host-glue=""
   style="white-space: nowrap;">s<svg ... data-icon="ExternalLink"
   data-icon-root=""></svg></span></span></a>
```

- The label is the resolved thread title; the destination is the raw token,
  percent encoded, resolved into a `file://` URL under the thread's
  environment root (`/Users/cristos/Documents/projects/bv-brain2`).
- `data-focus-board-ref-kind` and `data-focus-board-path-link` are both
  absent: neither the reference chips nor the code-span decoration painted
  this anchor. `data-focus-board-host-glue` is present, the icon glue only.
- `thr_cvvvkw6rjz` is a real, listed thread in the same project
  (`proj_9da9h742i7`); `bb thread show` reports it idle and visible.

## Which layer routed it

1. bb's shared markdown renderer autolinks the raw `@thread:` token (its own
   mention renderer is not wired for the pane's embedded ThreadChat), and
   bb's file-link builder turns the destination into an absolute `file://`
   URL. The plugin's decorator skips nodes inside `a[href]`
   (`claimedByOtherSurface`, components/decorate-reference-mentions.ts), so
   no chip replaces it.
2. The pane's click capture declined the click: the anchor branch's
   `isExternalHref("file:…")` is true (components/thread-pane.tsx), so the
   plugin called nothing.
3. bb's own anchor click routing mapped the `file:` href to a preview target
   and opened its file preview with the token as the path. Reproduced
   headlessly in the live app: the panel opens in-app (URL unchanged) with
   the "File not found." body — `before-file-not-found-pane.jpg`.

## The guard (phase 2)

`components/thread-pane.tsx`, inside the existing anchor branch of
`onChatClickCapture`, before the external-href check:

- `mentionReferenceInAnchor` decodes the href and parses the first mention
  token with the decorator's own grammar (`mentionReferenceInText`, newly
  exported from `components/decorate-reference-mentions.ts`).
- A parsed reference claims the click (`preventDefault` + `stopPropagation`)
  and opens through `referenceMentions.onOpen` — the same opener the painted
  chips use: a listed thread opens in the pane, an unlisted one in bb's main
  view, a project opens its project page.
- A destination that is mention shaped but malformed (`@thread:proj_nope`,
  an id under the wrong prefix) claims the click and does nothing: inert, so
  the host's preview fallback never runs.
- A pane without `referenceMentions` wiring also ends inert, never a preview.
- Everything else keeps the existing routing: relative markdown links still
  open the workspace preview, route-style hrefs (`/projects/…/threads/…`)
  carry no token and are untouched.

Host shapes not claimed, with the reason: a `/threads/<id>`-style route
anchor was not observed in this DOM (the destination carries the encoded
token), so the guard deliberately does not invent that route; the
`bb-thread-mention` element and painted chips keep their existing claim path.

## Frames

- `before-mention-link-in-pane.jpg` — the link as rendered (live).
- `before-file-not-found-pane.jpg` — the click's result (live, headless):
  the `@thread:thr_cvvvkw6rjz` panel reading "File not found."
- `harness-before-click.jpg` — the harness fixture pane before the click.
- `after-mention-opens-thread.jpg` — after the guard, the same click opens
  the mentioned thread in the board's pane ("Thread: Wrap check: long path
  with the open glyph").

The after frame runs the real app components against the screenshot
harness's SDK stand-in (`?mentionAnchor=1`, added this round), because bb on
this host serves the plugin from the main checkout, which stays untouched
until a release fast-forwards it.

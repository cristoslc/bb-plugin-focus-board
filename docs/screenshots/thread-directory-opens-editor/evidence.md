# A directory reference in the pane opens the editor, not an error pane — evidence

The operator's ruling on dec_7b3a9tcf8nt7 (2026-11-17) asked three questions
and pointed at hijacking the link instead of fixing it upstream. These are
the answers, each with the source that settles it, then the change.

## 1. Is there a directory-viewer plugin that would work?

Several file-tree plugins exist in the catalog (File Tree, Files, Workbench
Explorer, Treehouse, Dynamic File Tree, File Explorer), and they all render a
folder tree as their own panel. None of them can receive a link click from
this pane:

- bb's file-opener slot is keyed by extension, not by entry type: a plugin
  registers `extensions: readonly string[]` (SDK `PluginFileOpenerRegistration`)
  and becomes an "Open with" choice for matching files. A directory has no
  extension, and the preview pipeline reads file contents before an opener is
  chosen, so a folder can never match.
- A plugin cannot navigate another plugin's panel: `BbNavigate` exposes
  `toThread`, `toProject`, `toPluginPanel` (own panels), `toCompose`,
  `openThreadPanel`, `openUrl` (http/https/mailto), `experimental_openFilePreview`
  and `experimental_openFileExternally`. There is no cross-plugin reveal.

So the answer is no: not as a click destination. A tree plugin beside the
pane is a fine companion, but it does not answer the click.

## 2. Should we hijack the links to open in Finder/editor?

Yes, and it is the only directory-capable destination a plugin can reach.
The local host daemon's `POST /open-in-target` accepts any existing path: its
`CB()` implementation stats the path and returns `{type:"directory"}` or
`{type:"file"}`, refusing only something that is neither. The daemon also
reports `openDirectory` per target, and this plugin already speaks to that
endpoint for the pane header's open menu (`lib/workspace-open.ts`,
`workspace_open_in_target`). Two small extensions were missing: the RPC only
passed the workspace root, and the click never claimed `file://` anchors.

## 3. How does bb handle this natively?

- In bb's own thread view the same `@thread:` mention renders as the same
  `file://` anchor and click lands on the same "File not found." panel. I
  reproduced it live in the main view (2026-11-17): the host's linkifier, its
  click routing, and its preview agree with each other and all are wrong for
  a directory or a mention token.
- bb's file preview cannot show a directory at all: its daemon read endpoint
  throws `invalid_path "Path is not a regular file"` (bb 0.49.0
  `host-daemon/dist/daemon-bundle.mjs`).
- bb has no directory surface a plugin can target: no listing route, no
  reveal-in-tree, no folder tab in the SDK. The extension-keyed opener slot
  (above) is the closest thing, and it cannot match a folder.

## The change

- `components/chat-link-intercept.ts`: `isFileHref` marks a `file:` anchor.
- `components/thread-pane.tsx`: the anchor branch claims `file:` destinations
  and calls `workspace_path_kind`; a file keeps BB's preview, a directory
  goes to `workspace_open_targets` then `workspace_open_in_target` with the
  workspace-relative path, and anything outside the workspace or missing
  stays inert (no error pane, no navigation).
- `lib/workspace-link.ts` (new): decodes the `file:` URL, maps an absolute
  path back inside the workspace root, and reads the entry kind from the
  environment host's own directory listing (`hosts.directory`, which carries
  `kind: "file" | "directory"`).
- `lib/workspace-open-pick.ts` (new): one place for target picking (the
  operator's `bb.workspaceOpenTarget` preference, then a file manager, then
  any directory-capable target). The header menu now imports it too.
- `server.ts`: `workspace_open_in_target` takes an optional workspace-relative
  `path` (re-validated with `resolveWithinRoot`), and the new
  `workspace_path_kind` RPC classifies an href against the thread's
  environment, using the host that owns it so remote worktrees classify
  correctly.

Tests (red first): `tests/thread-pane-file-anchors.test.tsx` failed 3 of 4
before the change; `tests/workspace-link.test.ts` and
`tests/workspace-open-pick.test.ts` cover the pure helpers.

## Frames and the routing trace

- Before (live, 2026-11-16, `docs/screenshots/diag-directory-chip/`): the
  host's `.worktrees` anchor, and the "Path is not a regular file" preview in
  the operator's screenshot.
- After (harness, `?directoryAnchor=1`, real app components): the same anchor
  click produced `workspace_path_kind` → `workspace_open_targets` →
  `workspace_open_in_target { targetId: "vscode", path: ".worktrees" }` and no
  preview call (`routing-trace.txt`, `after-click-routes-to-editor.jpg`).
  The editor launch itself is an external side effect, so the trace is the
  evidence rather than a screenshot.

Honest limit: on this host bb serves the plugin from the main checkout, which
stays untouched until a release fast-forwards it, so the after frame runs the
real components in the harness.

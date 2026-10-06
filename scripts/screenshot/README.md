# Screenshot harness

Renders the real plugin app (app.tsx + components/) against a mocked
`@get-bb/plugin-sdk/app` with simulated threads, then captures the README
screenshots in `docs/screenshots/` with headless Chrome. No bb server or
host app involved.

- `data.ts` — simulated projects, providers, and threads (shapes mirror the
  SDK's `PluginSidebarThread`), plus `SIM_DEMO_THREADS`: three fresh demo
  families (Working/expanded, Needs-you/collapsed, Unread/expanded) appended
  in demo mode so shots show nested child threads both folded and unfolded
  in the attention lanes — the base fixture's families are deliberately old
  (parent-lane UAT stability) and never surface there.
- `mock-sdk.tsx` — SDK stand-in: hooks return the simulated state,
  `ThreadChat` renders a canned conversation, and `useBbNavigate` drives a
  minimal real-history router (hash-based) so UAT suites can exercise the
  app's pane-history behavior with genuine browser back/forward. Its `useSdk`
  returns one stable object across renders — a per-render object loops the
  app (effect deps + setState). Vite aliases the SDK specifier
  here, so the app code runs unmodified. `?demo=1` switches the simulated
  sidebar to the base fixture plus the demo families; suites never set it.
- `main.tsx` — seeds localStorage from the query string (`?groupBy=…`,
  `?collapsed=` folds family cards by seeding the persisted
  collapsed-families list) and mounts the registered panel component through
  the mock router.
- `index.html` — defines bb's built-in theme tokens (extracted from the bb
  app bundle): the dark set on `html.dark`, a light set on `html:not(.dark)`,
  plus a minimal preflight (the plugin's compiled CSS ships without one
  because the host app provides it) and the `data-bb-plugin="focus-board"`
  attribute so the compiled utilities' scoping matches.
- `shoot.mjs` — the capture driver. Captures three shots in both themes,
  toggling the `dark` class per pass: board with the thread pane open
  (1920x1080), plus board and thread pane at phone size (390x844) —
  `name-dark.png` / `name-light.png` files.

Regenerate the screenshots:

```sh
npm i --no-save puppeteer-core   # uses the system Chrome, no download
npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
node scripts/screenshot/shoot.mjs                     # terminal 2
```

`CHROME_PATH` and `HARNESS_URL` override the Chrome binary and harness URL.
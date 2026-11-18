# Tech debt

Each entry: what breaks or smells, where, why it is not fixed inline, and how
to verify it is still there.

## The thread header action is retired by the host, ahead of our SDK typings

`npm run build` prints this warning on every build, twice:

```
warning: experimental_threadHeaderAction is retired from SDK typings. Register a thread action with placement "header" instead: app.slots.experimental_threadAction({ id, title, icon, group, placement: "header", item }). Existing plugins remain supported. See bb-plugin-authoring, frontend-registration.md#a-button-in-the-thread-header.
```

Where: `app.tsx:4743` registers the board's thread header control through `app.slots.experimental_threadHeaderAction`, and `components/thread-header-actions.tsx` supplies its component. The host prints the warning once per build and once per source location, so the second copy names the registration site.

Why it is not fixed inline: the replacement does not exist in the SDK we compile against. `@get-bb/plugin-sdk` at `0.6.19` declares `experimental_threadHeaderAction(registration)` and has no `experimental_threadAction` slot, so swapping the call today means calling a method the typings do not have, which the typecheck would refuse and a cast would only hide. The host is ahead of the package.

What the fix actually requires, checked against `@get-bb/plugin-sdk@0.6.150` (the newest published version, fetched and read on 2026-11-18):

- `0.6.150` declares `experimental_threadAction<Data = undefined>(registration: PluginThreadActionRegistration<Data>): void` (`bundled-types/bb-plugin-sdk.d.ts:25676`), and that registration carries the `placement: "header"` the warning names.
- `0.6.150` no longer declares `experimental_threadHeaderAction` at all, so the swap is not optional past that point: the old call stops compiling.
- The jump is `0.6.19` to `0.6.150`. A package that crossed 131 published versions is an upgrade with its own audit, not a rename inside a chore commit: every slot, RPC schema and host-capability probe the board reads needs checking against the new declarations, and the panel and pane surfaces this repo leans on (split layout, native pane, family state) are all experimental and free to move.

So the warning stays until an SDK upgrade lands. It is honest noise: the host supports the retired call ("Existing plugins remain supported"), the build succeeds, and nothing ships differently because of it.

How to verify it is still there: `npm run build` and read the first two lines of output, or `grep -n "experimental_threadHeaderAction" app.tsx`.

How to close it: bump `@get-bb/plugin-sdk`, replace the registration at `app.tsx:4743` with `app.slots.experimental_threadAction({ id, title, icon, group, placement: "header", item })`, confirm the header control still renders in a live window (the board's Done, Snooze and New-child actions on a thread page), and delete this entry.

# The nightly release commission

This is the whole text a nightly release run needs. Everything mechanical is
`scripts/release-pipeline.mjs` (the release contract in
`.agents/agents-md-detail/release.md` is the spec it implements); the only
judgement call is the storyboard manifest, and it is yours to write.

## 1. Storyboard first

Read the `[Unreleased]` group of `CHANGELOG.md`. For every bullet, decide
*demonstrable* or *skip* against
[`demo-gif-convention.md`](demo-gif-convention.md), and write
`docs/releases/<version>/storyboard.yaml`:

```yaml
version: 1.7.12                 # the version the -dev stamp names
demos:
  - bullet: "**The bullet's opening words.**"   # enough to match one bullet
    gif: docs/screenshots/release-demos/v1.7.12-<name>.gif
    caption: "One line that rides under the bullet on the release page."
    steps:                                    # a reference…
      - "goto ?fixture=1"                     # …or the outline itself
      - "the gesture the gif shows"
skips:
  - bullet: "**The bullet that cannot be filmed.**"
    reason: "Render count; identical pixels frame to frame."
```

Commit it on the release branch before the driver runs: `upload-demos` reads
the manifest at `HEAD`, and it refuses a bullet that has neither a demo nor a
named skip. Skipped bullets land in the release notes as named skips, so a
missing gif is never silent.

Then capture each demo against the tag's own tree (the convention's budget and
the recorder's commands are in that doc), so the gifs land where the manifest
says. Capture before `run`, or between `publish` and `upload-demos`.

## 2. Then the driver

```sh
node scripts/release-pipeline.mjs run --dry-run   # read the plan first
node scripts/release-pipeline.mjs run             # preflight → finalize, then it pauses
```

`run` stops at the finalize commit's PR: open it, merge it on the remote, then

```sh
node scripts/release-pipeline.mjs run --from tag
```

which tags, publishes, uploads the demos and re-arms. It pauses once more
after the re-arm commit for that commit's own PR; merge it and the release is
done. `run` exits 0 on a pause (a human step is outstanding) and non-zero on a
failure, so the automation can tell "waiting" from "broken".

Every subcommand also stands alone (`preflight`, `finalize`, `tag`, `publish`,
`upload-demos`, `re-arm`, `verify`), each with `--dry-run`; the tag push alone
needs `--yes`.

## 3. When a step fails

Stop. Do not retry, hand-edit around it, or move a tag. The failure names its
step and reason (`release-pipeline:tag:finalize-not-merged`), which is the
whole diagnosis. A `--dry-run` of the same subcommand shows the plan it was
refusing. Fix the cause in a normal landing (`npm test`, `npm run build`,
`npm run release-safety`), then resume from the failed step with
`run --from <step>`. Two rules do not bend: a tag is never moved (a fix after
tagging is a new version), and a published changelog section is never
back-edited. Leave the tree clean and record the failure in the thread.

## 4. What the driver will not do

- It does not run `npm test`, `npm run build` or `npm run release-safety`. The
  gate chain is its own command; run it before `run` and paste its exit codes.
- It does not merge pull requests. The finalize and re-arm commits ride PRs,
  and those merges are the operator's step; `run` pauses and says so.
- It does not judge. Storyboard decisions, release-note wording, and the
  marketplace check (`.agents/agents-md-detail/release.md` section 4a) stay
  with the agent.
- It does not notify. Focus Board's ntfy channel is disabled by operator
  ruling, and `scripts/release-safety.mjs` keeps its silent no-op.

# Contributing to Focus Board

Thanks for helping. This guide covers people and AI agents alike. Agents also read [AGENTS.md](AGENTS.md) and [.agents/agents-md-detail/contribution.md](.agents/agents-md-detail/contribution.md), which add the rules that only matter to an agent.

Focus Board is MIT licensed. A contribution is accepted under the same license. There is no CLA and no DCO sign-off.

## Before you start

- Search [existing issues and pull requests](https://github.com/cristoslc/bb-plugin-focus-board/issues?q=is%3Aissue+is%3Apr) first, open and closed. Comment on a match instead of opening a duplicate.
- For anything bigger than a small fix, open an issue before writing code so the direction is agreed. A pull request that lands a large unplanned change may be closed unmerged.
- Report security problems privately, never in a public issue. See [SECURITY.md](SECURITY.md).

## Reporting a bug

Use the **Bug report** form. A report needs these sections, in this order, and a section with nothing to say is filled with "None" or "None known", never dropped:

1. Related issues or pull requests (number plus title)
2. Environment (Focus Board version, bb version, OS, desktop app or browser)
3. Reproduction steps (numbered, minimal, deterministic, starting from a known state)
4. Expected result
5. Actual result (error text and logs quoted verbatim in code blocks)
6. Workarounds
7. Request or recommendation (optional)

Reproduce the bug yourself before filing it, headlessly when you can. The repo ships a screenshot harness in [scripts/screenshot](scripts/screenshot) that mounts the real app in Chrome. Attach the screenshots or recording you captured and write the steps from what the successful run actually did. A report you could not reproduce is still welcome, but say so under Actual result and name the environment you tried.

One bug per report. Every claim carries a concrete example with real values, such as the exact thread id, lane, or setting involved.

## Requesting a feature

Use the **Feature request** form, which covers new features and improvements to existing behavior. Fill the sections in this order, writing "None" or "None known" where there is nothing to say:

1. Related issues or pull requests (number plus title)
2. Environment (the Focus Board version and surface the request is written against)
3. Problem (what you were doing and what got in the way, with a concrete example)
4. Goal (the outcome that should be possible, stated as behavior and not as an implementation)
5. Acceptance sketch (numbered steps and the result you would see)
6. Alternatives and workarounds
7. Request or recommendation (optional: a proposed design, priority, or offer to contribute)

Describe the problem first, because the best fix is not always the feature you had in mind. Search open and closed issues and the [changelog](CHANGELOG.md) first, and check that the latest release does not already do it. Behavior that contradicts the docs is a bug, so use the bug form for it. One request per issue.

## Setting up

```bash
git clone https://github.com/cristoslc/bb-plugin-focus-board.git
cd bb-plugin-focus-board
git checkout dev
npm ci
```

Never create or retarget a `node_modules` symlink, in the main checkout or in a worktree. Run `npm ci` in each checkout that needs dependencies. A self-pointing symlink makes the board vanish, and the `pretest`, `prebuild`, and `preuat` hooks abort when they find one.

## Branches

- `main` is the stable public branch. It only ever moves by fast-forward at release time. Never open a pull request against `main`.
- `dev` is the integration branch. Branch from it, and open every pull request against it.
- `dev` is also GitHub's default branch, so a new pull request defaults to the right base, and a `Fixes #N` link closes its issue when the pull request lands on `dev` (the fix reaches a shipped release at the next release).
- Name your branch for the change: `fix-chip-overflow`, `add-group-filter`. Maintainer threads use `bb/<slug>-thr_<id>`, which you can ignore.
- Fork the repo if you do not have write access. Rebase onto the latest `origin/dev` before you open the pull request, never after:

```bash
git fetch origin
git rebase origin/dev
```

## Making the change

- Keep a change to one behavior. Unrelated cleanups go in their own pull request.
- Match the surrounding code: naming, comment density, and idiom. Fix the root cause of a warning or deprecation notice, never suppress it.
- A bug fix arrives with a test that fails without the fix. Write the failing test first, watch it fail, then fix.
- A new or changed workflow path updates its row in [docs/test-coverage-matrix.md](docs/test-coverage-matrix.md).
- Do not change the version in `package.json` or `APP_VERSION`, edit a published changelog section, move a tag, or touch `main`. Maintainers own releases.

## Checks to run

Run these in your checkout and paste any failure into the pull request instead of hiding it:

| Command | When |
|---|---|
| `npm test` | Always |
| `npm run typecheck` | Always |
| `npm run build` | When the change affects the shipped bundle |
| `npm run gates` | When the change touches network calls, storage, or anything security-adjacent |
| `npm run uat` | When the change alters board interaction. Needs `npm run build` first and a system Chrome (`CHROME_PATH` if it is not in the default place). Run one suite with `npm run uat -- tests/manual/uat-rank.yaml` |

## Changelog

A pull request that changes what a user sees adds bullets to the `[Unreleased]` group at the top of [CHANGELOG.md](CHANGELOG.md):

- Only user-facing behavior earns a bullet. Tests, refactors, docs, and build plumbing do not.
- File each bullet under the matching subsection: **Added** for new capability, **Changed** for a behavior change, **Fixed** for a bug fix.
- Write it Slack-punchy: a bold lead that names the feature surface and reads on its own, plus at most two short sentences. Fold same-behavior bullets into one with sub-bullets.
- Never edit a published `[X.Y.Z]` section. If a rebase leaves your bullets inside one, move them back into `[Unreleased]`.

The full rules, including the What's-new modal grouping, live in [.agents/agents-md-detail/release.md](.agents/agents-md-detail/release.md). Release pages carry a demo gif under every demonstrable bullet; that rule and its capture tooling are in [docs/releases/demo-gif-convention.md](docs/releases/demo-gif-convention.md).

## Opening the pull request

- Title: one line stating the behavior change, in the style of recent history ("The done checkbox swaps into the state dot's slot on hover"). Leave out ticket prefixes and branch names.
- Body: fill in the pull request template. When the pull request closes a tracked issue, carry the closing keyword line (`Fixes #N` or `Closes #N`) exactly once. Without it the issue never auto-closes and stays open after its fix is merged. Link related issues that are not closed by this change with plain `#N` references only. If the issue closed in an earlier pull request, name that in "What changed" instead.
- Commits: write each message as a short behavior summary. Add a body when the why is not obvious from the diff. Keep history reviewable, with no fixup chains left behind.
- A maintainer reviews and merges with a merge commit. Squash and rebase merges are not used, so each commit that carries a changelog bullet stays in the history. You do not merge your own pull request.
- Respond to review by pushing new commits to the same branch. Rebase onto `origin/dev` again only when a maintainer asks or the branch conflicts.
- After the merge, check the linked issue actually closed. The auto-close needs the keyword line in the pull request that landed on `dev`. An issue still open after its fix merged is a bookkeeping bug: close it the same day with a comment citing the fix commit and pull request.

## AI-assisted contributions

Using an AI agent to write code, tests, or reports is fine. The rules are the same as for everyone else, plus these:

- A person is accountable for every contribution. That person has read the diff and run the checks.
- Disclose agent involvement in the pull request or issue. The templates have a field for it.
- Any issue, pull request, or comment written wholly or mostly by an agent ends with the signature line `> AGENT GENERATED CONTENT`, as a markdown blockquote on its own last line, like bb adds to agent-written threads. The line goes on the written content itself, not a commit message or checklist field.
- Do not paste unverified agent output. A bug report needs a real reproduction. A fix needs a test that failed first.
- Agents must not mark a pull request ready for review, request reviewers, merge, or close issues unless the person they work for says to.
- Agents must read [AGENTS.md](AGENTS.md) and the files it links before touching the repo.

## Code of conduct

Be direct and kind. Critique the change, not the person. Maintainers may close threads that turn hostile.

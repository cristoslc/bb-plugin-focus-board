#!/usr/bin/env node
/**
 * The deterministic release driver: one subcommand per mechanical step of
 * `.agents/agents-md-detail/release.md`, and one `run` that sequences them.
 *
 * The split is deliberate. Everything the release spoke describes as a
 * mechanical transform lives here and is proved by tests; the one judgement
 * call a release needs (which demonstrable bullet gets a gif, and the exact
 * gesture each gif shows) lives in the per-release storyboard manifest, which
 * the nightly agent authors before calling `run`. Neither half re-implements
 * the other's tooling: the gate chain is `scripts/release-safety.mjs`, the
 * shots are `scripts/uat/release-shots.mjs`, the signing contract is
 * `scripts/release-signing.allowed`, and both generated changelog modules
 * come from their own scripts.
 *
 * Steps:
 *   preflight     refuse to start unless the tree, branch, version, changelog
 *                 and signing config can all carry a release
 *   finalize      the finalize commit on the dev lineage: strip `-dev`, rename
 *                 `[Unreleased]` to `[X.Y.Z] - <date>`, regenerate the
 *                 generated modules, commit
 *   tag           fast-forward main in a temporary worktree, annotated signed
 *                 tag, push tag then main (needs --yes: it is irreversible)
 *   publish       `gh release create`, notes = the section verbatim plus the
 *                 compare link, no binary assets
 *   upload-demos  the manifest's gifs as release assets, each one embedded
 *                 under its bullet with its one-line caption
 *   re-arm        the dev-only prep commit bumping to the next `-dev`
 *   verify        the release page, its assets, main's tip, and dev's re-arm
 *   run           preflight → finalize → (merge gate) → tag → publish →
 *                 upload-demos → re-arm → verify, stopping at the first
 *                 failure with the step and reason named
 *
 * Every subcommand takes `--dry-run`: it prints the planned actions and
 * validates the inputs it can read, and writes no file, makes no commit, tag,
 * push, upload or release. Dry-run's one relaxation is documented at
 * `uploadDemos`: a gif the storyboard has not captured yet is a warning
 * instead of a failure, because a plan run may legitimately precede capture.
 *
 * Failure shape: `release-pipeline:<step>:<reason>: <detail>` on stderr, then
 * an optional hint, and a non-zero exit. A *gate* (a human step outstanding,
 * such as the finalize commit's PR merge) is not a failure: it prints and
 * exits 0 with its name, so a nightly automation can tell "ship the rest" from
 * "something is wrong".
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseUnreleasedChangelog } from "../lib/unreleased-changelog.ts";
import * as plan from "./release-pipeline/plan.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The subcommands, in `run` order. */
export const STEP_NAMES = ["preflight", "finalize", "tag", "publish", "upload-demos", "re-arm", "verify"];

/** The paths a finalize commit carries (release.md section 3). */
export const FINALIZE_PATHS = [
  "CHANGELOG.md",
  "package.json",
  "package-lock.json",
  "lib/whats-new.ts",
  "tests/whats-new.test.ts",
  "lib/unreleased-changelog.generated.ts",
  "lib/whats-new.generated.ts",
];

/** A named refusal: step-qualified, with a reader-facing detail and an optional hint. */
export class PipelineFailure extends Error {
  /**
   * @param {string} reason stable slug, step-qualified by the caller's report
   * @param {string} detail what is wrong, in plain words
   * @param {string | null} hint what to do about it
   */
  constructor(reason, detail, hint = null) {
    super(`${reason}: ${detail}`);
    this.name = "PipelineFailure";
    this.reason = reason;
    this.detail = detail;
    this.hint = hint;
  }
}

/** Spawns a command and returns its status and streams; never throws on exit codes. */
export function defaultExec(command, args, { cwd, input } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", input });
  if (result.error) {
    throw new PipelineFailure("exec:spawn", `${command} did not start: ${result.error.message}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * The pipeline's context: the root, the flags, the injected seams (so tests
 * drive it without a network or a real gh), and the state one step hands the
 * next (the version a planned finalize is about to write, the notes body a
 * planned publish would carry).
 */
export function createPipeline({
  root = REPO_ROOT,
  dryRun = false,
  yes = false,
  bump = "patch",
  now = () => new Date(),
  log = (line = "") => console.log(line),
  warn = (line) => console.warn(line),
  exec = defaultExec,
  readFile = (path) => readFileSync(path, "utf8"),
  writeFile = (path, text) => writeFileSync(path, text),
  exists = existsSync,
  remove = (path) => rmSync(path, { recursive: true, force: true }),
  fetchUrl = (url, init) => fetch(url, init),
  env = process.env,
} = {}) {
  return {
    root,
    dryRun,
    yes,
    bump,
    now,
    log,
    warn,
    exec,
    readFile,
    writeFile,
    exists,
    remove,
    fetchUrl,
    env,
    state: {
      version: null,
      date: null,
      summary: null,
      changelog: null,
      finalizePlanned: false,
      repoUrl: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Small seams
// ---------------------------------------------------------------------------

function git(p, args, { mutating = false } = {}) {
  if (mutating && p.dryRun) {
    p.log(`  plan: git ${args.join(" ")}`);
    return { status: 0, stdout: "", stderr: "" };
  }
  return p.exec("git", args, { cwd: p.root });
}

function gitOrFail(p, step, args, options) {
  const result = git(p, args, options);
  if (result.status !== 0) {
    throw new PipelineFailure(
      `${step}:git`,
      `git ${args.join(" ")} exited ${result.status}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`,
    );
  }
  return result;
}

function gh(p, step, args) {
  const result = p.exec("gh", args, { cwd: p.root });
  if (result.status !== 0) {
    throw new PipelineFailure(
      `${step}:gh`,
      `gh ${args.join(" ")} exited ${result.status}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`,
    );
  }
  return result;
}

function repoPath(p, relative) {
  return join(p.root, relative);
}

function readRepoFile(p, relative) {
  try {
    return p.readFile(repoPath(p, relative));
  } catch (error) {
    throw new PipelineFailure("file:unreadable", `${relative} could not be read: ${error.message}`);
  }
}

function writeRepoFile(p, relative, text) {
  p.writeFile(repoPath(p, relative), text);
}

function asFailure(step, error) {
  if (error instanceof PipelineFailure) return error;
  if (error instanceof plan.PlanError) return new PipelineFailure(`${step}:${error.reason}`, error.detail);
  return new PipelineFailure(`${step}:unexpected`, error?.message ?? String(error));
}

/** A failure's reason once, step-qualified: a step that already named itself keeps its name. */
function qualify(step, failure) {
  return failure.reason.startsWith(`${step}:`) ? failure.reason : `${step}:${failure.reason}`;
}

function readPackageVersion(p) {
  let parsed;
  try {
    parsed = JSON.parse(readRepoFile(p, "package.json"));
  } catch (error) {
    throw asFailure("version", error);
  }
  if (typeof parsed.version !== "string") {
    throw new PipelineFailure("version:unreadable", "package.json carries no string version");
  }
  return parsed.version;
}

function formatDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function requireCleanTree(p, step) {
  const status = git(p, ["status", "--porcelain"]).stdout.trim();
  if (status === "") return;
  const paths = status.split("\n");
  throw new PipelineFailure(
    `${step}:dirty-tree`,
    `${paths.length} uncommitted path(s), starting "${paths[0].trim()}"`,
    `the ${step} step writes a commit-shaped change, so the tree must be clean first`,
  );
}

/** The repo's GitHub https URL, from `origin`, as the release pages link it. */
function repoUrlFor(p, step) {
  // The configured URL, not `git remote get-url`: that applies url.insteadOf
  // rewrites, and a mirror's local path is never the page a reader clicks.
  const remote = gitOrFail(p, step, ["config", "--get", "remote.origin.url"]).stdout.trim();
  const withoutSuffix = remote.replace(/\.git$/, "");
  const ssh = /^git@([^:]+):(.+)$/.exec(withoutSuffix);
  if (ssh !== null) return `https://${ssh[1]}/${ssh[2]}`;
  if (withoutSuffix.startsWith("https://")) return withoutSuffix;
  throw new PipelineFailure(
    `${step}:remote-url`,
    `origin reads "${remote}", which is not a GitHub https or ssh remote`,
    "the compare link and the asset URLs are built from the origin remote",
  );
}

/**
 * The changelog a post-finalize step works from: the one this run carried, the
 * tag's own tree, or (in a dry run, where the tag does not exist yet) this
 * tree's. A live run never substitutes the working copy for a published tag.
 */
function changelogFor(p, step, tagName) {
  if (p.state.changelog !== null) return p.state.changelog;
  const fromTag = git(p, ["show", `${tagName}:CHANGELOG.md`]);
  if (fromTag.status === 0) return fromTag.stdout;
  if (p.dryRun || p.state.finalizePlanned) {
    p.log(`  plan: ${tagName} has no tree yet; reading this tree's CHANGELOG.md`);
    return readRepoFile(p, "CHANGELOG.md");
  }
  throw new PipelineFailure(
    `${step}:tag-tree`,
    `${tagName} carries no CHANGELOG.md to work from`,
    "the release page and the demo captions both derive from the tagged section",
  );
}

/**
 * The release tag immediately below this one on main: the newest tag reachable
 * from `origin/main` that is not the tag being published. Git's own version
 * sort does the ordering, so no second semver implementation lives here.
 */
function previousReleaseTag(p, step, tagName) {
  const listed = gitOrFail(p, step, [
    "tag",
    "--list",
    "v[0-9]*.[0-9]*.[0-9]*",
    "--merged",
    "origin/main",
    "--sort=-v:refname",
  ]);
  const tags = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const index = tags.indexOf(tagName);
  const previous = index >= 0 ? tags[index + 1] : tags[0];
  if (!previous) {
    throw new PipelineFailure(
      `${step}:previous-tag`,
      `no release tag below ${tagName} is reachable from origin/main`,
      "the notes always close with a compare link against the previous release",
    );
  }
  return previous;
}

// ---------------------------------------------------------------------------
// preflight
// ---------------------------------------------------------------------------

/**
 * Refuses to start a release unless every input it needs can carry one. All
 * checks run (none short-circuits) so one pass names every blocker.
 */
export async function preflight(p) {
  const failures = [];
  const report = (name, ok, detail = "") => {
    p.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail === "" ? "" : ` — ${detail}`}`);
    if (!ok) failures.push({ name, detail });
  };

  const status = git(p, ["status", "--porcelain"]).stdout.trim();
  report(
    "clean-tree",
    status === "",
    status === "" ? "" : `${status.split("\n").length} uncommitted path(s), starting "${status.split("\n")[0].trim()}"`,
  );

  const mergeHead = git(p, ["rev-parse", "--git-path", "MERGE_HEAD"]).stdout.trim();
  const mergeInFlight = mergeHead !== "" && p.exists(resolve(p.root, mergeHead));
  report("no-merge-in-flight", !mergeInFlight, mergeInFlight ? "a merge is unresolved in this checkout; wait for it" : "");

  const branch = git(p, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  report(
    "not-on-main",
    branch !== "main",
    branch === "main" ? "releases finalize on the dev lineage; main only ever fast-forwards" : "",
  );

  const fetched = git(p, ["fetch", "origin", "--quiet"]);
  report("origin-fetched", fetched.status === 0, fetched.status === 0 ? "" : (fetched.stderr || fetched.stdout).trim().slice(0, 200));

  if (fetched.status === 0) {
    const contains = git(p, ["merge-base", "--is-ancestor", "origin/dev", "HEAD"]);
    report(
      "dev-up-to-date",
      contains.status === 0,
      contains.status === 0 ? "" : `${branch} does not contain origin/dev; rebase onto the fetched origin/dev first`,
    );
  }

  let version = null;
  try {
    version = readPackageVersion(p);
  } catch (error) {
    report("version-readable", false, asFailure("preflight", error).detail);
  }
  let parsed = null;
  if (version !== null) {
    try {
      parsed = plan.parseReleaseVersion(version);
    } catch (error) {
      report("version-readable", false, asFailure("preflight", error).detail);
    }
  }
  if (parsed !== null) {
    report(
      "version-is-dev-candidate",
      parsed.dev,
      parsed.dev ? "" : `package.json reads ${version}; dev wears the next candidate as X.Y.Z-dev`,
    );
  }

  let items = [];
  try {
    items = parseUnreleasedChangelog(readRepoFile(p, "CHANGELOG.md")).items;
  } catch (error) {
    report("unreleased-readable", false, asFailure("preflight", error).detail);
  }
  report(
    "unreleased-non-empty",
    items.length > 0,
    items.length > 0 ? `${items.length} bullet(s) waiting` : "CHANGELOG.md's [Unreleased] group carries no bullets",
  );

  const signingKey = p.env.RELEASE_SIGNING_KEY || join(homedir(), ".ssh", "focus_board_release");
  const signingPub = p.exists(repoPath(p, "scripts/release-signing.pub"));
  const signingAllowed = p.exists(repoPath(p, "scripts/release-signing.allowed"));
  const tagGpgSign = git(p, ["config", "--get", "tag.gpgSign"]).stdout.trim() === "true";
  const keyPresent = p.exists(signingKey);
  const signingMissing = [
    signingPub ? null : "scripts/release-signing.pub is missing",
    signingAllowed ? null : "scripts/release-signing.allowed is missing",
    tagGpgSign ? null : "git config tag.gpgSign is not true",
    keyPresent ? null : `${signingKey} is missing`,
  ].filter(Boolean);
  report("signing-config-present", signingMissing.length === 0, signingMissing.join("; "));

  const ghVersion = p.exec("gh", ["--version"], { cwd: p.root });
  report("gh-present", ghVersion.status === 0, ghVersion.status === 0 ? "" : "gh is not on PATH; publish and verify need it");

  p.log(failures.length === 0 ? "  preflight: ready to release" : `  preflight: ${failures.length} blocker(s)`);
  return { failures };
}

// ---------------------------------------------------------------------------
// finalize
// ---------------------------------------------------------------------------

/** The heading integrity a finalize must leave behind (release.md section 1). */
function assertFinalizedHeadings(markdown, version) {
  const lines = markdown.split("\n");
  const groupStart = lines.indexOf("## [Unreleased]");
  const fresh = lines.slice(groupStart, groupStart + 9).join("\n");
  const expected = "## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n";
  if (groupStart === -1 || !fresh.startsWith(expected)) {
    throw new PipelineFailure(
      "finalize:heading-integrity",
      "the fresh [Unreleased] group does not carry its H2 plus the three empty subsections",
    );
  }
  const section = plan.extractReleaseSection(markdown, version);
  if (section === null) {
    throw new PipelineFailure("finalize:heading-integrity", `the renamed [${version}] section is missing`);
  }
  const subsections = section.body.split("\n").filter((line) => line.startsWith("### "));
  const missing = plan.SUBSECTION_ORDER.filter((name) => !subsections.includes(`### ${name}`));
  if (missing.length > 0) {
    throw new PipelineFailure(
      "finalize:heading-integrity",
      `the [${version}] section is missing ${missing.map((name) => `### ${name}`).join(", ")}`,
    );
  }
}

/**
 * The finalize commit. Everything it carries is a transform of text already
 * in the tree; the only composed string is the subject, and that is the
 * group's first bullet lead verbatim (release.md section 3).
 */
export async function finalize(p) {
  requireCleanTree(p, "finalize");
  const current = readPackageVersion(p);
  const parsed = plan.parseReleaseVersion(current);
  if (!parsed.dev) {
    throw new PipelineFailure(
      "finalize:already-finalized",
      `package.json reads ${current}; a dev tree wears the next candidate as X.Y.Z-dev`,
      "the re-arm step is what re-establishes the -dev stamp after a release",
    );
  }
  const date = formatDate(p.now());
  const markdown = readRepoFile(p, "CHANGELOG.md");

  let changed;
  let next;
  try {
    changed = plan.finalizeChangelog({ markdown, version: parsed.version, date });
    next = {
      "CHANGELOG.md": changed.markdown,
      "package.json": plan.setPackageVersion({ text: readRepoFile(p, "package.json"), from: current, to: parsed.version }),
      "package-lock.json": plan.setLockVersion({
        text: readRepoFile(p, "package-lock.json"),
        from: current,
        to: parsed.version,
      }),
      "lib/whats-new.ts": plan.setAppVersion({
        text: readRepoFile(p, "lib/whats-new.ts"),
        from: current,
        to: parsed.version,
      }),
      "tests/whats-new.test.ts": plan.addExpectedVersion({
        text: readRepoFile(p, "tests/whats-new.test.ts"),
        version: parsed.version,
      }),
    };
  } catch (error) {
    throw asFailure("finalize", error);
  }
  assertFinalizedHeadings(changed.markdown, parsed.version);

  const subject = `Release ${parsed.version}: ${changed.summary}`;
  p.state.version = parsed.version;
  p.state.date = date;
  p.state.summary = changed.summary;
  p.state.changelog = changed.markdown;
  p.state.finalizePlanned = p.dryRun;

  if (p.dryRun) {
    p.log(`  plan: release ${parsed.version} on ${date}, commit subject "${subject}"`);
    for (const [file, text] of Object.entries(next)) {
      p.log(`  plan: rewrite ${file} (${text.length} bytes)`);
    }
    p.log("  plan: regenerate lib/unreleased-changelog.generated.ts and lib/whats-new.generated.ts");
    p.log(`  plan: git add ${FINALIZE_PATHS.join(" ")}`);
    p.log(`  plan: git commit -m "${subject}"`);
    p.log("  plan: the finalize commit rides its own PR; run pauses at the merge gate until it is on origin/dev");
    return { planned: true, version: parsed.version, subject };
  }

  for (const [file, text] of Object.entries(next)) writeRepoFile(p, file, text);
  for (const script of ["scripts/generate-unreleased.mjs", "scripts/generate-whats-new.mjs"]) {
    const regenerated = p.exec(process.execPath, [script], { cwd: p.root });
    if (regenerated.status !== 0) {
      throw new PipelineFailure(
        "finalize:regenerate",
        `${script} exited ${regenerated.status}: ${(regenerated.stderr || regenerated.stdout).trim().slice(0, 400)}`,
      );
    }
  }
  gitOrFail(p, "finalize", ["add", ...FINALIZE_PATHS]);
  gitOrFail(p, "finalize", ["commit", "-m", subject]);
  const head = git(p, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  p.log(`  done: ${subject} (${head})`);
  p.log("  next: open the PR for this commit, merge it, then resume with `run --from tag`");
  return { version: parsed.version, subject, commit: head };
}

// ---------------------------------------------------------------------------
// tag
// ---------------------------------------------------------------------------

async function planTag(p) {
  const version = p.state.version ?? readPackageVersion(p);
  const parsed = plan.parseReleaseVersion(version);
  if (parsed.prerelease !== null) {
    throw new PipelineFailure(
      "tag:not-release",
      `the tree still reads ${version}; the finalize commit is what makes the number real`,
    );
  }
  const tagName = plan.releaseTag(parsed.version);

  const local = git(p, ["rev-parse", "-q", "--verify", `refs/tags/${tagName}`]);
  if (local.status === 0) {
    throw new PipelineFailure(
      "tag:tag-exists",
      `${tagName} already exists in this checkout`,
      "a tag is never moved, so a fix after tagging is a new version",
    );
  }
  const remote = git(p, ["ls-remote", "--tags", "origin", `refs/tags/${tagName}`]);
  if (remote.status === 0 && remote.stdout.trim() !== "") {
    throw new PipelineFailure(
      "tag:tag-exists",
      `${tagName} is already on origin`,
      "a tag is never moved, so a fix after tagging is a new version",
    );
  }

  git(p, ["fetch", "origin", "--quiet"]);
  const prefix = `Release ${parsed.version}: `;
  const head = git(p, ["rev-parse", "HEAD"]).stdout.trim();
  const headSubject = git(p, ["log", "-1", "--format=%s"]).stdout.trim();
  const plannedFinalize = p.state.finalizePlanned === true;

  // The tag lands on the finalize commit, which is HEAD on the release branch
  // and origin/dev's tip once its PR merges. Both are the same commit; the
  // second is what a resume after the merge sees.
  let target = head;
  let summary = p.state.summary ?? "";
  if (headSubject.startsWith(prefix)) {
    summary = headSubject.slice(prefix.length);
  } else if (!plannedFinalize) {
    const devTip = git(p, ["rev-parse", "origin/dev"]).stdout.trim();
    const devSubject = git(p, ["log", "-1", "--format=%s", devTip]).stdout.trim();
    if (!devSubject.startsWith(prefix)) {
      throw new PipelineFailure(
        "tag:not-finalize-commit",
        `neither HEAD ("${headSubject}") nor origin/dev's tip ("${devSubject}") is the finalize commit's "${prefix}…"`,
      );
    }
    target = devTip;
    summary = devSubject.slice(prefix.length);
  }

  if (!plannedFinalize) {
    const merged = git(p, ["merge-base", "--is-ancestor", target, "origin/dev"]);
    if (merged.status !== 0) {
      throw new PipelineFailure(
        "tag:finalize-not-merged",
        `the finalize commit ${target.slice(0, 12)} is not on origin/dev, so main cannot fast-forward to it`,
        "open the finalize commit's PR, merge it, and resume with `run --from tag`",
      );
    }
    const fastForward = git(p, ["merge-base", "--is-ancestor", "origin/main", target]);
    if (fastForward.status !== 0) {
      throw new PipelineFailure(
        "tag:main-diverged",
        "origin/main carries a commit the finalize commit does not, so the fast-forward would refuse",
        "land that work on dev first, then re-run: main only ever moves by fast-forward",
      );
    }
  }

  return {
    version: parsed.version,
    tagName,
    commit: target,
    summary,
    message: `Release ${parsed.version}: ${summary}`,
  };
}

/**
 * Promotes main by fast-forward in a throwaway worktree, signs the tag and
 * pushes. The tag push is the distribution surface and cannot be undone, so
 * it needs an explicit `--yes` after the plan is printed.
 */
export async function tag(p) {
  const tagged = await planTag(p);
  // A dry run that planned its own finalize has no commit to name yet, and
  // printing the current HEAD would read as the tag target.
  const plannedTarget = p.state.finalizePlanned === true;
  const where = plannedTarget ? "the finalize commit it would create" : tagged.commit.slice(0, 12);
  p.log(`  ${p.dryRun ? "plan" : "ready"}: ${tagged.tagName} on ${where} — "${tagged.message}"`);
  p.log(
    `  ${p.dryRun ? "plan" : "ready"}: push ${tagged.tagName}, then ${plannedTarget ? "<finalize commit>" : tagged.commit.slice(0, 12)}:refs/heads/main`,
  );

  if (p.dryRun) {
    const worktree = join(tmpdir(), `focus-board-release-${tagged.version}`);
    const target = plannedTarget ? "<finalize commit>" : tagged.commit.slice(0, 12);
    p.log(`  plan: git worktree add --detach ${worktree} origin/main`);
    p.log(`  plan: git -C ${worktree} merge --ff-only ${target}`);
    p.log(`  plan: git -C ${worktree} tag -a ${tagged.tagName} -m "${tagged.message}"`);
    p.log(`  plan: git push origin ${tagged.tagName}`);
    p.log(`  plan: git push origin ${plannedTarget ? "<finalize commit>" : tagged.commit}:refs/heads/main`);
    p.log(`  plan: git worktree remove --force ${worktree}`);
    return { planned: true, tag: tagged.tagName };
  }

  if (!p.yes) {
    throw new PipelineFailure(
      "tag:needs-yes",
      `pushing ${tagged.tagName} is irreversible: every install pinned to v${tagged.version} resolves through it`,
      "re-run with --yes once the plan above is what you mean to ship",
    );
  }

  const worktree = join(tmpdir(), `focus-board-release-${tagged.version}-${process.pid}`);
  p.remove(worktree);
  gitOrFail(p, "tag", ["worktree", "add", "--detach", worktree, "origin/main"]);
  try {
    gitOrFail(p, "tag", ["-C", worktree, "merge", "--ff-only", tagged.commit]);
    gitOrFail(p, "tag", ["-C", worktree, "tag", "-a", tagged.tagName, "-m", tagged.message]);
    gitOrFail(p, "tag", ["push", "origin", tagged.tagName]);
    gitOrFail(p, "tag", ["push", "origin", `${tagged.commit}:refs/heads/main`]);
  } finally {
    git(p, ["worktree", "remove", "--force", worktree]);
  }
  p.log(`  done: ${tagged.tagName} pushed, main fast-forwarded to ${tagged.commit.slice(0, 12)}`);
  return { tag: tagged.tagName, version: tagged.version, commit: tagged.commit };
}

// ---------------------------------------------------------------------------
// publish
// ---------------------------------------------------------------------------

async function planPublish(p) {
  const version = plan.parseReleaseVersion(p.state.version ?? readPackageVersion(p)).version;
  const tagName = plan.releaseTag(version);

  const changelog = changelogFor(p, "publish", tagName);
  const previousTag = previousReleaseTag(p, "publish", tagName);
  const repoUrl = repoUrlFor(p, "publish");

  let notes;
  try {
    notes = plan.renderReleaseNotes({ markdown: changelog, version, previousTag, repoUrl });
  } catch (error) {
    throw asFailure("publish", error);
  }

  if (!p.dryRun) {
    const remote = git(p, ["ls-remote", "--tags", "origin", `refs/tags/${tagName}`]).stdout.trim();
    if (remote === "") {
      throw new PipelineFailure(
        "publish:tag-not-pushed",
        `${tagName} is not on origin, so the release page would point at nothing`,
        "run the tag step first",
      );
    }
    const existing = p.exec("gh", ["release", "view", tagName, "--json", "tagName"], { cwd: p.root });
    if (existing.status === 0) {
      throw new PipelineFailure(
        "publish:release-exists",
        `${tagName} already has a release page`,
        "editing its body and assets is upload-demos; a release is never created twice",
      );
    }
  }

  return { version, tagName, notes, previousTag, repoUrl };
}

/** Creates the GitHub Release: title, the section verbatim, the compare link. */
export async function publish(p) {
  const release = await planPublish(p);
  p.log(`  notes: ${release.notes.split("\n")[0]}`);
  p.log(`  compare: ${release.previousTag}...${release.tagName}`);

  if (p.dryRun) {
    p.log("  plan: notes body —");
    for (const line of release.notes.trimEnd().split("\n")) p.log(`    ${line}`);
    p.log(
      `  plan: gh release create ${release.tagName} --title "Focus Board ${release.version}" --notes-file <notes> --verify-tag`,
    );
    p.log("  plan: no binary assets at create; demo gifs ride upload-demos");
    return { planned: true, tag: release.tagName };
  }

  const notesPath = join(tmpdir(), `focus-board-${release.tagName}-notes.md`);
  p.writeFile(notesPath, release.notes);
  const created = gh(p, "publish", [
    "release",
    "create",
    release.tagName,
    "--title",
    `Focus Board ${release.version}`,
    "--notes-file",
    notesPath,
    "--verify-tag",
  ]);
  const url = created.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  p.log(`  done: ${url}`);
  return { tag: release.tagName, version: release.version, url };
}

// ---------------------------------------------------------------------------
// upload-demos
// ---------------------------------------------------------------------------

function releaseAssets(p, tagName) {
  const view = gh(p, "upload-demos", ["release", "view", tagName, "--json", "assets"]);
  let parsed;
  try {
    parsed = JSON.parse(view.stdout);
  } catch (error) {
    throw new PipelineFailure("upload-demos:gh-json", `gh release view returned unparseable JSON: ${error.message}`);
  }
  const assets = Array.isArray(parsed.assets) ? parsed.assets : [];
  return new Map(assets.map((asset) => [asset.name, asset.url]));
}

const GIF_WARN_BYTES = 5 * 1024 * 1024;
const GIF_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Uploads the manifest's gifs and embeds each one under its bullet.
 *
 * The manifest is the agent's half of the pipeline: which demonstrable
 * bullets get a gif, that demo's capture step outline, and a named reason for
 * every skip. This step only refuses when the manifest is silent about a
 * bullet, when an entry matches no bullet or two, when a gif is missing or
 * past the convention's budget, or when the uploaded asset is not what the
 * notes point at.
 *
 * Dry-run relaxation: a gif the storyboard has not captured yet is a printed
 * warning rather than a failure, because a plan run may precede capture. The
 * live run refuses with `upload-demos:gif-missing`.
 */
export async function uploadDemos(p) {
  const version = plan.parseReleaseVersion(p.state.version ?? readPackageVersion(p)).version;
  const tagName = plan.releaseTag(version);
  const manifestPath = `docs/releases/${version}/storyboard.yaml`;

  const manifest = git(p, ["show", `HEAD:${manifestPath}`]);
  if (manifest.status !== 0) {
    throw new PipelineFailure(
      "upload-demos:manifest-missing",
      `${manifestPath} is not in HEAD`,
      "author the storyboard manifest and commit it on the release branch before the demos go up",
    );
  }
  let storyboard;
  try {
    storyboard = plan.parseStoryboard(manifest.stdout, { source: manifestPath });
  } catch (error) {
    throw asFailure("upload-demos", error);
  }

  const changelog = changelogFor(p, "upload-demos", tagName);
  const section = plan.extractReleaseSection(changelog, version);
  if (section === null) {
    throw new PipelineFailure("upload-demos:section-missing", `CHANGELOG.md carries no [${version}] section`);
  }

  const validated = plan.validateStoryboard({ storyboard, bullets: section.bullets, version });
  if (validated.problems.length > 0) {
    for (const problem of validated.problems) p.warn(`  ${problem.reason}: ${problem.detail}`);
    throw new PipelineFailure(
      `upload-demos:${validated.problems[0].reason}`,
      `${validated.problems.length} manifest problem(s); every one is listed above`,
    );
  }

  p.log(`  manifest: ${manifestPath} — ${validated.demos.length} demo(s), ${validated.skips.length} named skip(s)`);
  for (const skip of validated.skips) {
    p.log(`  skip: "${skip.bulletText.slice(0, 70)}" — ${skip.reason}`);
  }

  const staged = [];
  for (const demo of validated.demos) {
    const path = repoPath(p, demo.gif);
    if (!p.exists(path)) {
      if (p.dryRun) {
        p.log(`  plan: gif not captured yet: ${demo.gif}`);
        continue;
      }
      throw new PipelineFailure(
        "upload-demos:gif-missing",
        `${demo.gif} does not exist`,
        "capture the storyboard's demo against the tag's own build, then re-run upload-demos",
      );
    }
    const bytes = statSync(path).size;
    if (bytes > GIF_MAX_BYTES) {
      throw new PipelineFailure(
        "upload-demos:gif-too-large",
        `${demo.gif} is ${(bytes / 1048576).toFixed(1)} MB, past the ${GIF_MAX_BYTES / 1048576} MB ceiling`,
        "the convention's budget is a few MB per gif; split the demo by feature",
      );
    }
    if (bytes > GIF_WARN_BYTES) {
      p.warn(`  ${demo.gif} is ${(bytes / 1048576).toFixed(1)} MB, past the convention's few-MB target`);
    }
    staged.push({ ...demo, path });
  }

  if (p.dryRun) {
    for (const demo of validated.demos) p.log(`  plan: gh release upload ${tagName} ${demo.gif} --clobber`);
    p.log(`  plan: gh release edit ${tagName} --notes-file <section + ${validated.demos.length} caption(s)>`);
    return { planned: true, demos: validated.demos.length, skips: validated.skips.length };
  }

  if (staged.length > 0) {
    gh(p, "upload-demos", ["release", "upload", tagName, ...staged.map((demo) => demo.path), "--clobber"]);
  }
  const assets = releaseAssets(p, tagName);
  const withUrls = staged.map((demo) => {
    const name = demo.gif.split("/").pop();
    const url = assets.get(name);
    if (url === undefined) {
      throw new PipelineFailure(
        "upload-demos:asset-missing",
        `${tagName} has no asset named ${name} after the upload`,
        "confirm the upload landed with `gh release view <tag> --json assets`",
      );
    }
    return { bullet: demo.bulletText, caption: demo.caption, url };
  });

  const pristine = plan.renderReleaseNotes({
    markdown: changelog,
    version,
    previousTag: previousReleaseTag(p, "upload-demos", tagName),
    repoUrl: repoUrlFor(p, "upload-demos"),
  });
  let notes;
  try {
    notes = plan.embedDemoCaptions({ notes: pristine, demos: withUrls });
  } catch (error) {
    throw asFailure("upload-demos", error);
  }
  const notesPath = join(tmpdir(), `focus-board-${tagName}-notes-captioned.md`);
  p.writeFile(notesPath, notes);
  gh(p, "upload-demos", ["release", "edit", tagName, "--notes-file", notesPath]);
  p.log(`  done: ${withUrls.length} caption(s) embedded and ${staged.length} asset(s) uploaded`);
  return { demos: staged.length, skips: validated.skips.length };
}

// ---------------------------------------------------------------------------
// re-arm
// ---------------------------------------------------------------------------

/** The dev-only prep commit: `next + -dev` in the three version stamps. */
export async function rearm(p) {
  requireCleanTree(p, "re-arm");
  const treeVersion = readPackageVersion(p);
  const current = p.state.version ?? treeVersion;
  if (plan.parseReleaseVersion(treeVersion).prerelease !== null && p.state.version === null) {
    throw new PipelineFailure(
      "re-arm:already-armed",
      `package.json reads ${treeVersion}; the re-arm follows a finalize commit, not another re-arm`,
    );
  }
  const tagName = plan.releaseTag(current);
  const remote = git(p, ["ls-remote", "--tags", "origin", `refs/tags/${tagName}`]).stdout.trim();
  if (!p.dryRun && remote === "") {
    throw new PipelineFailure(
      "re-arm:release-not-published",
      `${tagName} is not on origin, so the cycle this commit primes has not shipped`,
      "re-arm only after tag and publish have landed",
    );
  }

  const next = `${plan.bumpVersion(current, p.bump)}-dev`;
  let nextFiles;
  try {
    nextFiles = {
      "package.json": plan.setPackageVersion({ text: readRepoFile(p, "package.json"), from: treeVersion, to: next }),
      "package-lock.json": plan.setLockVersion({
        text: readRepoFile(p, "package-lock.json"),
        from: treeVersion,
        to: next,
      }),
      "lib/whats-new.ts": plan.setAppVersion({
        text: readRepoFile(p, "lib/whats-new.ts"),
        from: treeVersion,
        to: next,
      }),
    };
  } catch (error) {
    throw asFailure("re-arm", error);
  }
  const subject = `Re-arm dev at ${next} after the ${current} release`;

  if (p.dryRun) {
    for (const [file, text] of Object.entries(nextFiles)) p.log(`  plan: rewrite ${file} (${text.length} bytes)`);
    p.log(`  plan: git commit -m "${subject}"`);
    p.log("  plan: the re-arm commit rides its own PR; run reports a gate until origin/dev reads a -dev version");
    return { planned: true, version: next };
  }

  for (const [file, text] of Object.entries(nextFiles)) writeRepoFile(p, file, text);
  gitOrFail(p, "re-arm", ["add", ...Object.keys(nextFiles)]);
  gitOrFail(p, "re-arm", ["commit", "-m", subject]);
  p.log(`  done: ${subject}`);
  return { version: next, subject };
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

/** The release the tree is describing: the running state's, else the last tag. */
function releaseUnderVerify(p) {
  if (p.state.version !== null) return plan.parseReleaseVersion(p.state.version).version;
  const described = git(p, ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
  if (described.status !== 0) {
    throw new PipelineFailure(
      "verify:no-release",
      "no release state was carried in and no release tag is reachable from HEAD",
    );
  }
  return plan.parseReleaseVersion(described.stdout.trim().replace(/^v/, "")).version;
}

/**
 * Post-release checks: the page exists with the right title and body shape,
 * every asset answers, main is the tag's commit, and dev is re-armed. A
 * re-arm commit that is authored but not merged yet is a gate, not a
 * failure, because it is the one outstanding human step at that point.
 */
export async function verify(p) {
  const version = releaseUnderVerify(p);
  const tagName = plan.releaseTag(version);
  const problems = [];
  const gates = [];
  const fail = (reason, detail) => problems.push({ reason, detail });

  if (p.dryRun) {
    p.log(`  plan: gh release view ${tagName} --json name,tagName,body,assets`);
    p.log(`  plan: gh release view ${tagName} --json body — title "Focus Board ${version}", compare link last`);
    p.log(`  plan: every bullet of the [${version}] section is present in the body`);
    p.log("  plan: HEAD each asset URL and require 200");
    p.log(`  plan: git ls-remote origin refs/heads/main == ${tagName}^{commit}`);
    p.log("  plan: git show origin/dev:package.json carries a -dev version (else a re-arm gate)");
    return { problems, gates };
  }

  const view = p.exec("gh", ["release", "view", tagName, "--json", "name,tagName,body,assets"], { cwd: p.root });
  if (view.status !== 0) {
    throw new PipelineFailure(
      "verify:release-missing",
      `${tagName} has no release page: ${(view.stderr || view.stdout).trim().slice(0, 200)}`,
      "a pushed tag without its release page is a half-finished release",
    );
  }
  let release;
  try {
    release = JSON.parse(view.stdout);
  } catch (error) {
    throw new PipelineFailure("verify:gh-json", `gh release view returned unparseable JSON: ${error.message}`);
  }
  if (release.name !== `Focus Board ${version}`) {
    fail("verify:title", `the release title reads "${release.name}", not "Focus Board ${version}"`);
  }
  if (release.tagName !== tagName) {
    fail("verify:tag", `the release answers for ${release.tagName}, not ${tagName}`);
  }

  const changelog = git(p, ["show", `${tagName}:CHANGELOG.md`]);
  if (changelog.status !== 0) {
    fail("verify:tag-tree", `${tagName}^{tree} carries no CHANGELOG.md to compare the notes against`);
  } else {
    const shape = plan.checkReleaseNotes({
      notes: release.body ?? "",
      markdown: changelog.stdout,
      version,
      previousTag: previousReleaseTag(p, "verify", tagName),
      repoUrl: repoUrlFor(p, "verify"),
    });
    problems.push(...shape);
  }

  for (const asset of release.assets ?? []) {
    const response = await p.fetchUrl(asset.url, { method: "HEAD" });
    if (response?.ok !== true) {
      fail("verify:asset-unreachable", `${asset.name} answered ${response?.status ?? "no response"}`);
    }
  }

  const tagCommit = git(p, ["rev-parse", `${tagName}^{commit}`]).stdout.trim();
  const remoteMain = git(p, ["ls-remote", "origin", "refs/heads/main"]).stdout.trim().split(/\s+/)[0] ?? "";
  if (remoteMain !== tagCommit) {
    fail("verify:main-not-tag", `origin/main is ${remoteMain.slice(0, 12) || "(absent)"}, the tag is ${tagCommit.slice(0, 12)}`);
  }

  git(p, ["fetch", "origin", "--quiet"]);
  const devPackage = git(p, ["show", "origin/dev:package.json"]);
  if (devPackage.status !== 0) {
    fail("verify:dev-unreadable", "origin/dev:package.json could not be read");
  } else {
    let devVersion = null;
    try {
      devVersion = JSON.parse(devPackage.stdout).version;
    } catch (error) {
      fail("verify:dev-unreadable", `origin/dev:package.json does not parse: ${error.message}`);
    }
    if (devVersion !== null && plan.parseReleaseVersion(devVersion).prerelease === null) {
      const headVersion = readPackageVersion(p);
      if (plan.parseReleaseVersion(headVersion).prerelease !== null) {
        gates.push({
          name: "verify:re-arm-pending",
          detail: `origin/dev still reads ${devVersion}; the re-arm commit (${headVersion}) is on this branch awaiting its PR`,
        });
      } else {
        fail("verify:dev-not-rearmed", `origin/dev reads ${devVersion} and this tree reads ${headVersion}; dev must carry the next -dev`);
      }
    }
  }

  p.log(problems.length === 0 ? `  verified: ${tagName}` : `  ${problems.length} problem(s) with ${tagName}`);
  for (const problem of problems) p.warn(`  ${problem.reason}: ${problem.detail}`);
  for (const gate of gates) p.log(`  gate: ${gate.name} — ${gate.detail}`);
  return { problems, gates };
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

const STEPS = {
  preflight,
  finalize,
  tag,
  publish,
  "upload-demos": uploadDemos,
  "re-arm": rearm,
  verify,
};

/**
 * The whole chain, stopping at the first failure with the step named. The
 * finalize commit and the re-arm commit each land through a pull request, so
 * `run` pauses at those seams instead of failing: it prints the gate and the
 * resume command, and exits 0. Resuming starts at `--from tag`.
 */
export async function run(p, { from = null, to = null } = {}) {
  const start = from === null ? 0 : STEP_NAMES.indexOf(from);
  if (start === -1) {
    throw new PipelineFailure("run:unknown-step", `--from ${from} is not one of ${STEP_NAMES.join(", ")}`);
  }
  const end = to === null ? STEP_NAMES.length - 1 : STEP_NAMES.indexOf(to);
  if (end === -1) {
    throw new PipelineFailure("run:unknown-step", `--to ${to} is not one of ${STEP_NAMES.join(", ")}`);
  }
  if (end < start) {
    throw new PipelineFailure("run:step-order", `--to ${to} comes before --from ${from}`);
  }

  const failures = [];
  const gates = [];

  for (const name of STEP_NAMES.slice(start, end + 1)) {
    p.log(`\n==> release-pipeline: ${name}`);
    try {
      const result = await STEPS[name](p);
      if (Array.isArray(result?.gates)) gates.push(...result.gates);
      if (Array.isArray(result?.problems) && result.problems.length > 0) {
        failures.push({
          step: name,
          failure: new PipelineFailure(`${name}:problems`, `${result.problems.length} check(s) failed`),
        });
        return { failures, gates };
      }
    } catch (error) {
      const failure = asFailure(name, error);
      if (name === "tag" && failure.reason === "tag:finalize-not-merged" && !p.dryRun) {
        gates.push({ name: "run:await-finalize-merge", detail: failure.detail });
        p.log(`  paused: ${failure.detail}`);
        p.log("  resume: node scripts/release-pipeline.mjs run --from tag");
        return { paused: "run:await-finalize-merge", failures, gates };
      }
      failures.push({ step: name, failure });
      p.warn(`  failed: release-pipeline:${qualify(name, failure)}: ${failure.detail}`);
      if (failure.hint) p.warn(`  hint: ${failure.hint}`);
      return { failures, gates };
    }

    // The finalize commit lands through a PR: pause until it is on dev rather
    // than tagging a commit nobody else can see.
    if (name === "finalize" && !p.dryRun) {
      git(p, ["fetch", "origin", "--quiet"]);
      const head = git(p, ["rev-parse", "HEAD"]).stdout.trim();
      if (git(p, ["merge-base", "--is-ancestor", head, "origin/dev"]).status !== 0) {
        const gate = {
          name: "run:await-finalize-merge",
          detail: `the finalize commit ${head.slice(0, 12)} is on this branch, not on origin/dev`,
        };
        gates.push(gate);
        p.log(`  paused: ${gate.detail}`);
        p.log("  resume: node scripts/release-pipeline.mjs run --from tag");
        return { paused: gate.name, failures, gates };
      }
    }
  }

  return { failures, gates };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `release-pipeline — the deterministic half of a Focus Board release

  node scripts/release-pipeline.mjs <command> [options]

Commands
  preflight      refuse to start unless the tree, version, changelog and signing config can carry a release
  finalize       the finalize commit on the dev lineage (strip -dev, rename [Unreleased], regenerate, commit)
  tag            fast-forward main in a temporary worktree, sign and push the tag (needs --yes)
  publish        create the GitHub Release: title, the section verbatim, the compare link
  upload-demos   upload the storyboard manifest's gifs and embed each caption under its bullet
  re-arm         the dev-only prep commit bumping to the next -dev
  verify         check the page, its assets, main's tip and dev's re-arm
  run            preflight → finalize → (merge gate) → tag → publish → upload-demos → re-arm → verify

Options
  --dry-run      print the planned actions and validate inputs; write, tag, push and publish nothing
  --yes          confirm the irreversible tag push (tag step only)
  --bump <kind>  next candidate bump: patch (default) or minor
  --from <step>  start run at a step (resume with "tag" after the finalize PR merges)
  --to <step>    stop run after a step
  --root <path>  operate on another checkout (defaults to this repo)
  --version <v>  the release being verified (verify only; defaults to the running state or the last tag)
`;

export function parseArgs(argv) {
  const options = {
    command: null,
    dryRun: false,
    yes: false,
    bump: "patch",
    from: null,
    to: null,
    root: null,
    version: null,
    help: false,
  };
  const withValue = new Set(["--bump", "--from", "--to", "--root", "--version"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [flag, inline] = argument.split("=");
    if (withValue.has(flag)) {
      const value = inline ?? argv[(index += 1)];
      if (value === undefined) throw new PipelineFailure("cli:missing-value", `${flag} needs a value`);
      const key = flag.slice(2);
      options[key] = value;
      continue;
    }
    if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--yes") options.yes = true;
    else if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag.startsWith("-")) throw new PipelineFailure("cli:unknown-option", `${flag} is not an option this driver knows`);
    else if (options.command === null) options.command = flag;
    else throw new PipelineFailure("cli:unexpected-argument", `"${flag}" follows the command ${options.command}`);
  }
  return options;
}

/** Runs one command and returns the process exit code (0 also for a gate). */
export async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const failure = error instanceof PipelineFailure ? error : new PipelineFailure("cli:unexpected", error.message);
    console.error(`release-pipeline:${failure.reason}: ${failure.detail}`);
    return 2;
  }
  if (options.help || options.command === null) {
    console.log(USAGE);
    return options.help ? 0 : 2;
  }

  const p = createPipeline({
    root: options.root === null ? REPO_ROOT : resolve(options.root),
    dryRun: options.dryRun,
    yes: options.yes,
    bump: options.bump,
  });
  if (options.version !== null) p.state.version = options.version;
  p.log(`release-pipeline: ${options.command}${p.dryRun ? " (dry run — nothing is written, tagged, pushed or published)" : ""}`);

  try {
    if (options.command === "run") {
      const outcome = await run(p, { from: options.from, to: options.to });
      if (outcome.failures.length > 0) {
        for (const entry of outcome.failures) {
          console.error(`release-pipeline:${qualify(entry.step, entry.failure)}: ${entry.failure.detail}`);
        }
        return 1;
      }
      for (const gate of outcome.gates) p.log(`gate: ${gate.name} — ${gate.detail}`);
      if (outcome.paused) p.log(`release-pipeline: paused at ${outcome.paused}`);
      else p.log(`\nrelease-pipeline: ${options.command} complete${options.dryRun ? " (dry run)" : ""}`);
      return 0;
    }

    if (!STEP_NAMES.includes(options.command)) {
      throw new PipelineFailure("cli:unknown-command", `"${options.command}" is not a command; try --help`);
    }
    const outcome = await STEPS[options.command](p);

    if (options.command === "preflight" && outcome.failures.length > 0) {
      for (const condition of outcome.failures) {
        console.error(`release-pipeline:preflight:${condition.name}: ${condition.detail}`);
      }
      return 1;
    }
    if (Array.isArray(outcome?.problems) && outcome.problems.length > 0) {
      for (const problem of outcome.problems) {
        console.error(`release-pipeline:${options.command}:${problem.reason}: ${problem.detail}`);
      }
      return 1;
    }
    for (const gate of outcome?.gates ?? []) p.log(`gate: ${gate.name} — ${gate.detail}`);
    p.log(`release-pipeline: ${options.command} ${options.dryRun ? "planned" : "done"}`);
    return 0;
  } catch (error) {
    const failure = error instanceof PipelineFailure ? error : asFailure(options.command, error);
    console.error(`release-pipeline:${qualify(options.command, failure)}: ${failure.detail}`);
    if (failure.hint) console.error(`  hint: ${failure.hint}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}

/**
 * The release driver end to end against a fixture repo (`tests/fixtures/
 * release-pipeline`): the whole `run` in dry-run against a real git tree, and
 * the refusals that matter at 3am — a dirty tree, a version the changelog
 * already published, a tag whose push nobody confirmed, a manifest that is
 * silent about a bullet, a gif that is not there or too large.
 *
 * The fixture repo's `origin` is a local bare repo behind git's `insteadOf`
 * rewrite of a GitHub URL, so `git fetch`/`git push` are real and the release
 * pages still build their GitHub compare and asset links. `gh` is stubbed at
 * the exec seam: the dry-run never calls it, and no test reaches a live gh.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPipeline,
  defaultExec,
  finalize,
  preflight,
  rearm,
  run,
  tag,
  uploadDemos,
} from "../scripts/release-pipeline.mjs";

const REPO = resolve(__dirname, "..");
const FIXTURE = join(REPO, "tests", "fixtures", "release-pipeline");
const GITHUB_URL = "https://github.com/fixture/repo.git";
const DATE = new Date(2026, 10, 11);
const SUMMARY = "A group's frame follows its cards into Done";

/** The real generators and their parsers, copied so the fixture tree's
 *  `npm test`-style regeneration runs the shipped code, not a stand-in. */
const BORROWED = [
  "scripts/generate-unreleased.mjs",
  "scripts/generate-whats-new.mjs",
  "lib/unreleased-changelog.ts",
  "lib/changelog-markdown.ts",
];

const created = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop(), { recursive: true, force: true });
});

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${result.status}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function makeTemp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** A checkout on `dev` at `1.3.0-dev` with one published release and a remote. */
function fixtureRepo() {
  const root = makeTemp("release-pipeline-repo-");
  cpSync(FIXTURE, root, { recursive: true });
  for (const file of BORROWED) cpSync(join(REPO, file), join(root, file));

  const origin = join(makeTemp("release-pipeline-origin-"), "origin.git");
  mkdirSync(origin, { recursive: true });
  git(origin, ["init", "-q", "--bare", "."]);

  git(root, ["init", "-q", "-b", "dev"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "user.email", "fixture@example.test"]);
  git(root, ["config", "tag.gpgSign", "true"]);
  git(root, ["config", `url.${origin}.insteadOf`, GITHUB_URL]);
  git(root, ["remote", "add", "origin", GITHUB_URL]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "Fixture tree at 1.3.0-dev"]);
  git(root, ["-c", "tag.gpgSign=false", "tag", "-a", "v1.2.2", "-m", "Release 1.2.2: an older release"]);
  git(root, ["branch", "main"]);
  git(root, ["push", "-q", "origin", "dev", "main", "--tags"]);

  const signingKey = join(makeTemp("release-pipeline-key-"), "signing_key");
  writeFileSync(signingKey, "fixture signing key\n");
  return { root, origin, signingKey };
}

function pipeline({ root, signingKey }, overrides = {}) {
  const exec = (command, args, options) =>
    command === "gh" ? { status: 0, stdout: "gh version 2.0.0\n", stderr: "" } : defaultExec(command, args, options);
  return createPipeline({
    root,
    now: () => DATE,
    log: () => {},
    warn: () => {},
    exec,
    env: { ...process.env, RELEASE_SIGNING_KEY: signingKey },
    ...overrides,
  });
}

function readFixture(root, file) {
  return readFileSync(join(root, file), "utf8");
}

describe("run --dry-run against a fixture repo", () => {
  it("plans every step and changes nothing", async () => {
    const fixture = fixtureRepo();
    const transcript = [];
    const p = pipeline(fixture, { dryRun: true, log: (line) => transcript.push(line) });

    const outcome = await run(p);
    const text = transcript.join("\n");

    expect(outcome.failures).toEqual([]);
    expect(outcome.paused).toBeUndefined();
    expect(p.state.version).toBe("1.3.0");

    expect(text).toContain(`plan: release 1.3.0 on 2026-11-11, commit subject "Release 1.3.0: ${SUMMARY}"`);
    expect(text).toContain(`plan: git commit -m "Release 1.3.0: ${SUMMARY}"`);
    expect(text).toContain("plan: regenerate lib/unreleased-changelog.generated.ts");
    expect(text).toContain("plan: git -C ");
    expect(text).toContain("plan: git push origin v1.3.0");
    expect(text).toContain("plan: git push origin ");
    expect(text).toContain('plan: gh release create v1.3.0 --title "Focus Board 1.3.0"');
    expect(text).toContain("compare: v1.2.2...v1.3.0");
    expect(text).toContain("plan: gif not captured yet: docs/screenshots/release-demos/v1.3.0-group-frame.gif");
    expect(text).toContain('plan: git commit -m "Re-arm dev at 1.3.1-dev after the 1.3.0 release"');
    expect(text).toContain("plan: gh release view v1.3.0 --json name,tagName,body,assets");

    expect(git(fixture.root, ["status", "--porcelain"])).toBe("");
    expect(git(fixture.root, ["tag", "--list"])).toBe("v1.2.2");
    expect(git(fixture.root, ["log", "-1", "--format=%s"])).toBe("Fixture tree at 1.3.0-dev");
    expect(JSON.parse(readFixture(fixture.root, "package.json")).version).toBe("1.3.0-dev");
    expect(readFixture(fixture.root, "CHANGELOG.md")).toContain("## [Unreleased]");
    expect(existsSync(join(fixture.root, "lib", "whats-new.generated.ts"))).toBe(false);
  });

  it("plans the notes body from the section the finalize would write", async () => {
    const fixture = fixtureRepo();
    const transcript = [];
    const p = pipeline(fixture, { dryRun: true, log: (line) => transcript.push(line) });

    await run(p, { from: "finalize", to: "publish" });

    const text = transcript.join("\n");
    expect(text).toContain("## Focus Board 1.3.0 (2026-11-11)");
    expect(text).toContain("**Full changelog**: https://github.com/fixture/repo/compare/v1.2.2...v1.3.0");
  });
});

describe("preflight", () => {
  it("passes on a clean dev checkout with a dev candidate", async () => {
    const fixture = fixtureRepo();
    const outcome = await preflight(pipeline(fixture));
    expect(outcome.failures).toEqual([]);
  });

  it("names a dirty tree and refuses to finalize on it", async () => {
    const fixture = fixtureRepo();
    writeFileSync(join(fixture.root, "stray.txt"), "uncommitted\n");

    const outcome = await preflight(pipeline(fixture));
    expect(outcome.failures.map((failure: { name: string }) => failure.name)).toContain("clean-tree");

    await expect(finalize(pipeline(fixture))).rejects.toThrow(/finalize:dirty-tree/);
  });

  it("names a version that is not a dev candidate, an empty group, and a missing signing key", async () => {
    const fixture = fixtureRepo();
    writeFileSync(
      join(fixture.root, "package.json"),
      `${JSON.stringify({ name: "release-pipeline-fixture", version: "1.3.0", type: "module" }, null, 2)}\n`,
    );
    writeFileSync(join(fixture.root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n");
    git(fixture.root, ["commit", "-q", "-am", "Fixture without a candidate"]);

    const outcome = await preflight(
      pipeline({ ...fixture, signingKey: join(fixture.root, "absent-key") }),
    );
    const names = outcome.failures.map((failure: { name: string }) => failure.name);
    expect(names).toContain("version-is-dev-candidate");
    expect(names).toContain("unreleased-non-empty");
    expect(names).toContain("signing-config-present");
  });
});

describe("finalize", () => {
  it("commits the rename, the stripped stamps, the regenerated modules and the pinned expectations", async () => {
    const fixture = fixtureRepo();
    const p = pipeline(fixture);
    const outcome = await finalize(p);

    expect(outcome.subject).toBe(`Release 1.3.0: ${SUMMARY}`);
    expect(git(fixture.root, ["log", "-1", "--format=%s"])).toBe(`Release 1.3.0: ${SUMMARY}`);

    const changelog = readFixture(fixture.root, "CHANGELOG.md");
    expect(changelog).toContain("## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n## [1.3.0] - 2026-11-11");
    expect(changelog).toContain("- **A group's frame follows its cards into Done.**");
    expect(JSON.parse(readFixture(fixture.root, "package.json")).version).toBe("1.3.0");
    expect(readFixture(fixture.root, "package-lock.json")).toContain('"version": "1.3.0"');
    expect(readFixture(fixture.root, "lib/whats-new.ts")).toContain('export const APP_VERSION = "1.3.0";');
    expect(readFixture(fixture.root, "tests/whats-new.test.ts")).toContain('"1.3.0",');
    expect(existsSync(join(fixture.root, "lib", "whats-new.generated.ts"))).toBe(true);
    expect(readFixture(fixture.root, "lib/unreleased-changelog.generated.ts")).toContain("UNRELEASED_ITEMS");
    expect(git(fixture.root, ["status", "--porcelain"])).toBe("");
  });

  it("refuses a version the changelog already published", async () => {
    const fixture = fixtureRepo();
    writeFileSync(
      join(fixture.root, "package.json"),
      `${JSON.stringify({ name: "release-pipeline-fixture", version: "1.2.2-dev", type: "module" }, null, 2)}\n`,
    );
    writeFileSync(join(fixture.root, "package-lock.json"), readFixture(fixture.root, "package-lock.json").replaceAll("1.3.0-dev", "1.2.2-dev"));
    git(fixture.root, ["commit", "-q", "-am", "Candidate on the published version"]);

    await expect(finalize(pipeline(fixture))).rejects.toThrow(/changelog:published-version/);
    expect(git(fixture.root, ["log", "-1", "--format=%s"])).toBe("Candidate on the published version");
  });

  it("refuses a tree that is already finalized", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    await expect(finalize(pipeline(fixture))).rejects.toThrow(/finalize:already-finalized/);
  });
});

describe("tag", () => {
  it("refuses before the finalize commit is merged, naming the gate", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    await expect(tag(pipeline(fixture, { yes: true }))).rejects.toThrow(/tag:finalize-not-merged/);
    expect(git(fixture.root, ["tag", "--list"])).toBe("v1.2.2");
  });

  it("refuses the irreversible push without --yes, and plans it with --yes in a dry run", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    git(fixture.root, ["push", "-q", "origin", "HEAD:dev"]);

    await expect(tag(pipeline(fixture))).rejects.toThrow(/tag:needs-yes/);
    expect(git(fixture.root, ["tag", "--list"])).toBe("v1.2.2");

    const planned = await tag(pipeline(fixture, { dryRun: true, yes: true }));
    expect(planned.planned).toBe(true);
    expect(git(fixture.root, ["tag", "--list"])).toBe("v1.2.2");
    expect(git(fixture.root, ["ls-remote", "--tags", "origin", "v1.3.0"])).toBe("");
  });

  it("refuses a tag that already exists instead of moving it", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    git(fixture.root, ["-c", "tag.gpgSign=false", "tag", "-a", "v1.3.0", "-m", "Release 1.3.0: taken"]);
    await expect(tag(pipeline(fixture, { yes: true }))).rejects.toThrow(/tag:tag-exists/);
    expect(git(fixture.root, ["-c", "tag.gpgSign=false", "tag", "-l", "-n1", "v1.3.0"])).toContain("Release 1.3.0: taken");
  });
});

describe("upload-demos", () => {
  function staged(fixture) {
    const p = pipeline(fixture);
    p.state.version = "1.3.0";
    p.state.changelog = readFixture(fixture.root, "CHANGELOG.md");
    return p;
  }

  it("refuses a gif the storyboard has not captured", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    await expect(uploadDemos(staged(fixture))).rejects.toThrow(/upload-demos:gif-missing/);
  });

  it("refuses a gif past the convention's ceiling", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    const gif = join(fixture.root, "docs", "screenshots", "release-demos", "v1.3.0-group-frame.gif");
    mkdirSync(join(gif, ".."), { recursive: true });
    writeFileSync(gif, Buffer.alloc(11 * 1024 * 1024));
    await expect(uploadDemos(staged(fixture))).rejects.toThrow(/upload-demos:gif-too-large/);
  });

  it("refuses a manifest that is silent about a bullet", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    const manifestPath = join(fixture.root, "docs", "releases", "1.3.0", "storyboard.yaml");
    const manifest = readFixture(fixture.root, "docs/releases/1.3.0/storyboard.yaml");
    writeFileSync(manifestPath, manifest.slice(0, manifest.indexOf("  - bullet: \"**A Group-filtered")));
    git(fixture.root, ["commit", "-q", "-am", "Manifest that forgets the fixed bullet"]);

    await expect(uploadDemos(staged(fixture))).rejects.toThrow(/manifest:bullets-unaccounted/);
  });

  it("refuses a manifest with a typo'd key", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    const manifestPath = join(fixture.root, "docs", "releases", "1.3.0", "storyboard.yaml");
    writeFileSync(manifestPath, readFixture(fixture.root, "docs/releases/1.3.0/storyboard.yaml").replace("caption:", "capton:"));
    git(fixture.root, ["commit", "-q", "-am", "Manifest with a typo"]);

    await expect(uploadDemos(staged(fixture))).rejects.toThrow(/manifest:unknown-key/);
  });

  it("refuses when the release branch carries no manifest", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    git(fixture.root, ["rm", "-q", "-r", "docs/releases/1.3.0"]);
    git(fixture.root, ["commit", "-q", "-m", "Drop the manifest"]);
    await expect(uploadDemos(staged(fixture))).rejects.toThrow(/upload-demos:manifest-missing/);
  });
});

describe("re-arm", () => {
  it("bumps to the next candidate once the release tag is pushed", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    git(fixture.root, ["push", "-q", "origin", "HEAD:dev"]);
    git(fixture.root, ["-c", "tag.gpgSign=false", "tag", "-a", "v1.3.0", "-m", "Release 1.3.0: fixture"]);
    git(fixture.root, ["push", "-q", "origin", "v1.3.0"]);

    const p = pipeline(fixture);
    p.state.version = "1.3.0";
    const outcome = await rearm(p);

    expect(outcome.version).toBe("1.3.1-dev");
    expect(JSON.parse(readFixture(fixture.root, "package.json")).version).toBe("1.3.1-dev");
    expect(readFixture(fixture.root, "lib/whats-new.ts")).toContain('export const APP_VERSION = "1.3.1-dev";');
    expect(git(fixture.root, ["log", "-1", "--format=%s"])).toBe("Re-arm dev at 1.3.1-dev after the 1.3.0 release");
    expect(git(fixture.root, ["status", "--porcelain"])).toBe("");
  });

  it("honors a minor bump", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    git(fixture.root, ["push", "-q", "origin", "HEAD:dev"]);
    git(fixture.root, ["-c", "tag.gpgSign=false", "tag", "-a", "v1.3.0", "-m", "Release 1.3.0: fixture"]);
    git(fixture.root, ["push", "-q", "origin", "v1.3.0"]);

    const p = pipeline(fixture, { bump: "minor" });
    p.state.version = "1.3.0";
    expect((await rearm(p)).version).toBe("1.4.0-dev");
  });

  it("refuses a second re-arm on a tree that already carries a candidate", async () => {
    const fixture = fixtureRepo();
    await expect(rearm(pipeline(fixture))).rejects.toThrow(/re-arm:already-armed/);
  });

  it("refuses while the release is not published", async () => {
    const fixture = fixtureRepo();
    await finalize(pipeline(fixture));
    const p = pipeline(fixture);
    p.state.version = "1.3.0";
    await expect(rearm(p)).rejects.toThrow(/re-arm:release-not-published/);
  });
});

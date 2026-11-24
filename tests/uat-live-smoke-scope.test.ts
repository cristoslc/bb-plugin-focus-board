/**
 * The live smoke gate's release scope (scripts/uat/live-smoke-scope.ts).
 *
 * The scope is the only condition under which the release path runs the gate,
 * so the failure that matters is a cut that touches the pane or the click path
 * and is skipped anyway — the gate would then never run and nobody would
 * notice. These tests pin the patterns in both directions: the surfaces the
 * six checks drive match, and the board's other work (lanes, grouping, views,
 * settings) does not, so the skip stays a real decision.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PANE_CLICK_PATTERNS,
  formatScopeDecision,
  paneClickScope,
} from "../scripts/uat/live-smoke-scope.ts";

/** A changelog with one `[Unreleased]` group holding the given bullet lines. */
function changelog(...lines: string[]): string {
  return [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    ...lines,
    "",
    "## [1.8.2] - 2026-11-20",
    "",
    "### Fixed",
    "",
    "- **An old published bullet about the pane.** Never read.",
    "",
  ].join("\n");
}

describe("paneClickScope", () => {
  it("puts a cut that changes the pane in scope", () => {
    const decision = paneClickScope(
      changelog(
        "### Changed",
        "",
        "- **The card click replaces the pane's thread in place.** A stale record no longer costs a third pane.",
      ),
    );
    expect(decision.inScope).toBe(true);
    expect(decision.bulletCount).toBe(1);
    expect(decision.matches[0].labels).toContain("pane");
    expect(decision.matches[0].labels).toContain("card click");
  });

  it("puts a cut that changes the board's pane header in scope", () => {
    const decision = paneClickScope(
      changelog("- **The pane header carries the Focus Board mark.** Done moved into the menu."),
    );
    expect(decision.inScope).toBe(true);
    expect(decision.matches[0].labels).toContain("pane header");
    expect(decision.matches[0].labels).toContain("pane");
  });

  it("puts a shortcut or thread-page cut in scope", () => {
    expect(
      paneClickScope(changelog("- **Slash and the New Thread key are shortcuts again.**")).inScope,
    ).toBe(true);
    expect(
      paneClickScope(changelog("- **The Focus Board menu opens from a thread page.**")).inScope,
    ).toBe(true);
  });

  it("reads a bullet's sub-bullets with the bullet", () => {
    const decision = paneClickScope(
      changelog(
        "- **The board remembers where a drag started.**",
        "  - The click path still lands on the card after a reorder.",
      ),
    );
    expect(decision.inScope).toBe(true);
    expect(decision.matches[0].labels).toContain("click path");
  });

  it("stays out of scope for a cut that never names the pane or the click path", () => {
    const decision = paneClickScope(
      changelog(
        "### Added",
        "",
        "- **The board's toolbar filter remembers its pick.** The value lives in this browser.",
        "- **A done card folds its family rows.** The fold survives a reload.",
      ),
    );
    expect(decision.inScope).toBe(false);
    expect(decision.bulletCount).toBe(2);
    expect(decision.matches).toEqual([]);
  });

  it("matches case-insensitively and by whole word", () => {
    expect(paneClickScope(changelog("- **PANE resize now sticks.**")).inScope).toBe(true);
    // "panel" is not "pane": the board's own toolbar is the UAT suites' work.
    expect(paneClickScope(changelog("- **The toolbar panel is denser.**")).inScope).toBe(false);
    expect(paneClickScope(changelog("- **A splitter drag no longer fights.**")).inScope).toBe(false);
  });

  it("never reads a published section's bullets", () => {
    // The fixture's [1.8.2] section carries a pane bullet; the [Unreleased]
    // group is empty, so the answer is out of scope.
    const decision = paneClickScope(changelog());
    expect(decision.inScope).toBe(false);
    expect(decision.bulletCount).toBe(0);
  });

  it("prints one line per matching bullet, with the labels that matched", () => {
    const decision = paneClickScope(
      changelog("- **The pane header matches the native row.** Same 48px row."),
    );
    const text = formatScopeDecision(decision).join("\n");
    expect(text).toContain('in scope: "The pane header matches the native row.');
    expect(text).toContain("(pane, pane header)");
    expect(text).toContain("RUN");
    expect(text).not.toContain("SKIP");
  });

  it("prints the skip reason when nothing matched, and never a silent stand-down", () => {
    const lines = formatScopeDecision(
      paneClickScope(changelog("- **The done checkbox is bigger.**")),
    );
    const text = lines.join("\n");
    expect(text).toContain("SKIP");
    expect(text).toContain("no [Unreleased] bullet names the pane");
    expect(text).toContain("`npm run live-smoke` runs it any time");
  });

  it("names an empty group rather than reading it as a clean skip", () => {
    const text = formatScopeDecision(paneClickScope(changelog())).join("\n");
    expect(text).toContain("holds no bullets");
    expect(text).not.toContain("no [Unreleased] bullet names the pane");
  });

  it("reads this repository's changelog without throwing", () => {
    // The scope reads the real file at release time. A format change that
    // broke the parser would silently read zero bullets, so the real file is
    // parsed here as the canary: a throw or a non-number fails loudly.
    const markdown = readFileSync(
      fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)),
      "utf8",
    );
    const decision = paneClickScope(markdown);
    expect(typeof decision.bulletCount).toBe("number");
    expect(decision.bulletCount).toBeGreaterThanOrEqual(0);
  });

  it("keeps every pattern reachable by a label readers can act on", () => {
    for (const pattern of PANE_CLICK_PATTERNS) {
      expect(pattern.label.length).toBeGreaterThan(0);
      expect(pattern.pattern.flags).toContain("i");
    }
  });
});

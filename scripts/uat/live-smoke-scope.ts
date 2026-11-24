/**
 * The live smoke gate's release scope: does this cut touch the pane or the
 * click path?
 *
 * A `.ts` module on purpose: `scripts/uat/live-smoke.mjs` runs under plain
 * node (which strips the types on import, the way
 * `scripts/generate-unreleased.mjs` already imports
 * `lib/unreleased-changelog.ts`), while `tests/uat-live-smoke-scope.test.ts`
 * gets the types. The rule is logic, so it is tested like logic.
 *
 * The operator's ruling (2026-11-24, decision `dec_b4wiwx3of87q`, option "add
 * a live smoke gate"; corpus entry `dl-20261124T051010-a016`) scopes
 * `scripts/uat/live-smoke.mjs` to cuts "whose changelog touches the pane or
 * the click path". That scope is this file: one keyword list over the
 * `[Unreleased]` bullets, and no other condition. A run inside
 * `npm run release-safety` reads the decision out loud, so "the gate did not
 * run" is always a printed sentence naming the bullets it read, never a
 * missing stage.
 *
 * Why the keyword list rather than a storyboard flag: the changelog is what
 * the cut is made of, it is already the release contract's source of truth,
 * and a bullet cannot be written without naming what it changed. A flag would
 * be one more thing to forget on release day.
 *
 * The list is deliberately about the six checks' surfaces (the pane, the
 * click's placement, the pane's header, the thread page's Focus Board control
 * and the two keyboard shortcuts). It does not match `panel`, so a bullet
 * about the board's own toolbar stays out; `\bpane\b` does not match `panel`
 * either, which is why both spellings are tested.
 */
import { parseUnreleasedChangelog } from "../../lib/unreleased-changelog.ts";

/** One word or phrase that names a surface the live smoke drives. */
export interface ScopePattern {
  /** The word the decision prints when this pattern matched. */
  readonly label: string;
  readonly pattern: RegExp;
}

/**
 * The patterns, each one naming a surface the gate's six checks touch:
 *
 * - `pane` / `split` / `opener` — the native split pane and the host call
 *   that puts a thread in it (checks 1-3).
 * - `card click` and `click ... card` — the click path itself (checks 1-3).
 * - `pane header` / `thread page` — the two headers check 4 reads, and the
 *   page check 6 drives.
 * - `thread menu` / `focus board menu` — the Control check 6 opens.
 * - `shortcut` / `keyboard` — the keys check 5 presses.
 *
 * Nothing here matches a bullet that only names the board's lanes, grouping,
 * views, or settings: those are covered by the UAT suites, not this gate.
 */
export const PANE_CLICK_PATTERNS: readonly ScopePattern[] = [
  { label: "pane", pattern: /\bpanes?\b/i },
  { label: "split", pattern: /\bsplits?\b/i },
  { label: "opener", pattern: /\bopeners?\b/i },
  { label: "card click", pattern: /\bcard\s+clicks?\b/i },
  { label: "click a card", pattern: /\bclick(?:ing|s|ed)?\s+(?:on\s+)?(?:a|the|another)\s+cards?\b/i },
  { label: "click path", pattern: /\bclick\s+path\b/i },
  { label: "pane header", pattern: /\bpane\s+headers?\b/i },
  { label: "thread page", pattern: /\bthread\s+pages?\b/i },
  { label: "thread menu", pattern: /\bthread\s+menus?\b/i },
  { label: "focus board menu", pattern: /\bfocus\s+board\s+menu\b/i },
  { label: "shortcut", pattern: /\bshortcuts?\b/i },
  { label: "keyboard", pattern: /\bkeyboards?\b/i },
];

/** The first words of a bullet, for the printed decision. */
function leadOf(text: string): string {
  const plain = text
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= 90 ? plain : `${plain.slice(0, 87)}…`;
}

export interface ScopeMatch {
  /** The bullet's opening words. */
  readonly bullet: string;
  /** The labels of every pattern the bullet matched. */
  readonly labels: readonly string[];
}

export interface ScopeDecision {
  /** How many bullets the `[Unreleased]` group held. */
  readonly bulletCount: number;
  readonly matches: readonly ScopeMatch[];
  /** True when at least one bullet names a surface the gate drives. */
  readonly inScope: boolean;
}

/**
 * Read the `[Unreleased]` group out of the changelog and decide whether this
 * cut touches the pane or the click path.
 *
 * A group with no bullets is out of scope: with nothing to ship there is no
 * pane change to check. The group's sub-bullets are read with their bullet,
 * because a facet sub-bullet is the same change.
 */
export function paneClickScope(markdown: string): ScopeDecision {
  const items = parseUnreleasedChangelog(markdown).items;
  const matches: ScopeMatch[] = [];
  for (const item of items) {
    const haystack = [item.text, ...item.children].join("\n");
    const labels = PANE_CLICK_PATTERNS.filter(({ pattern }) => pattern.test(haystack)).map(
      ({ label }) => label,
    );
    if (labels.length > 0) matches.push({ bullet: leadOf(item.text), labels });
  }
  return { bulletCount: items.length, matches, inScope: matches.length > 0 };
}

/** The lines the release path prints before it decides to run or skip. */
export function formatScopeDecision(decision: ScopeDecision): string[] {
  const lines = [`live-smoke scope: ${decision.bulletCount} [Unreleased] bullet(s) read`];
  if (decision.bulletCount === 0) {
    lines.push(
      "live-smoke scope: SKIP — the [Unreleased] group holds no bullets, so this cut has nothing",
    );
    lines.push("for the gate to check. If a cut should have bullets here, the changelog is the bug.");
    return lines;
  }
  for (const match of decision.matches) {
    lines.push(`  in scope: "${match.bullet}" (${match.labels.join(", ")})`);
  }
  if (decision.inScope) {
    lines.push(
      `live-smoke scope: RUN — ${decision.matches.length} bullet(s) touch the pane or the click path,`,
    );
    lines.push(
      "so the gate drives the installed host. A red gate stops the release; there is no override.",
    );
    return lines;
  }
  lines.push(
    "live-smoke scope: SKIP — no [Unreleased] bullet names the pane, the click path, the pane",
  );
  lines.push(
    "header, a thread page, the Focus Board thread menu, or a keyboard shortcut.",
  );
  lines.push(
    "This is the only reason the gate stands down. `npm run live-smoke` runs it any time.",
  );
  return lines;
}

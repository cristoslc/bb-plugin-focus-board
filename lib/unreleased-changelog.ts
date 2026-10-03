/**
 * The changelog's "[Unreleased]" group, parsed for the What's-new surface.
 *
 * On dev the running version IS unreleased, so the published-entry What's-new
 * feed cannot describe it — the unreleased bullets ARE the news, and their
 * content (not the version) is what "seen" means. CHANGELOG.md stays the
 * single source of truth: this parser reads the group straight out of it, and
 * scripts/generate-unreleased.mjs embeds the current group into
 * `lib/unreleased-changelog.generated.ts` before tests and builds, so no
 * bullet is ever written twice.
 *
 * Format contract: bullets open with "- " at column zero and wrap with
 * two-space-indent continuation lines; related sub-bullets are
 * two-space-indent "- " lines under their bullet and may wrap the same way
 * (four-space continuation). A bullet ends at the next bullet, a "###"
 * subsection heading, or a blank line. Bullets keep their raw markdown —
 * the modal distills via `leadFromBullet` (lead sentence for the bullet,
 * each sub-bullet condensed the same way as a child item). The italic
 * status note under the group heading is not a bullet and never reaches
 * the modal.
 */

export interface ParsedUnreleasedBullet {
  /** The full bullet text, continuations joined, markdown intact. */
  text: string;
  /** Sub-bullet texts (indented `- ` lines), joined the same way. */
  children: string[];
}

export interface ParsedUnreleased {
  items: ParsedUnreleasedBullet[];
}

export function parseUnreleasedChangelog(markdown: string): ParsedUnreleased {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## [Unreleased]"));
  if (start === -1) return { items: [] };

  const items: ParsedUnreleasedBullet[] = [];
  let current: { text: string; children: string[]; child: string | null } | null = null;

  // Soft wraps that split a slash-joined token ("scroll/wheel/\n  touch")
  // carry no separator — join such lines directly, prose gets a space.
  const joined = (target: string, line: string): string => {
    const continuation = line.trim();
    return target + ((continuation.startsWith("/") || target.endsWith("/")) ? "" : " ") + continuation;
  };

  const flush = () => {
    if (current !== null) {
      items.push({ text: current.text.trim(), children: current.children });
    }
    current = null;
  };

  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break; // the next release section
    if (line.startsWith("- ")) {
      flush();
      current = { text: line.slice(2), children: [], child: null };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("###")) {
      flush();
      continue;
    }
    const sub = /^ +\S/.test(line) && line.trim().startsWith("- ")
      ? line.trim().slice(2)
      : null;
    if (sub !== null) {
      current.child = sub;
      current.children.push(sub);
      continue;
    }
    const continuation = line.trim();
    if (continuation === "") {
      flush();
      continue;
    }
    if (current.child !== null) {
      const text = joined(current.child, line);
      current.child = text;
      current.children[current.children.length - 1] = text;
    } else {
      current.text = joined(current.text, line);
    }
  }
  flush();
  return { items };
}
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
 * two-space-indent continuation lines; a bullet ends at the next bullet, a
 * "###" subsection heading, or a blank line. The italic status note under the
 * group heading is not a bullet and never reaches the modal.
 */

export interface ParsedUnreleased {
  items: string[];
}

export function parseUnreleasedChangelog(markdown: string): ParsedUnreleased {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## [Unreleased]"));
  if (start === -1) return { items: [] };

  const items: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current !== null) items.push(cleanBullet(current));
    current = null;
  };
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break; // the next release section
    if (line.startsWith("- ")) {
      flush();
      current = line.slice(2);
      continue;
    }
    if (current !== null) {
      if (line.startsWith("###")) {
        flush();
        continue;
      }
      const continuation = line.trim();
      if (continuation === "") flush();
      // Soft wraps that split a slash-joined token ("scroll/wheel/\n  touch")
      // carry no separator — join such lines directly, prose gets a space.
      else current += ((continuation.startsWith("/") || current.endsWith("/")) ? "" : " ") + continuation;
    }
  }
  flush();
  return { items };
}

function cleanBullet(text: string): string {
  // Unwrap continuations, drop the bold markers — the modal renders plain
  // text, not markdown.
  return text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}
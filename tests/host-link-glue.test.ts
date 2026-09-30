// @vitest-environment jsdom
// Content-script glue for host-rendered link icons inside the focus
// board's panel. The host thread view appends an ExternalLink svg inside
// the trailing anchor of linkified text; that icon is an atomic inline, a
// legal break position, so at wrap widths the icon drops to its own line.
// The panel's content script fuses each icon with the anchor's final
// visible character in one white-space-nowrap unit — the same structure
// the pane's own decoration uses — so the glyph can only move with text.
// Skips: anchors carrying another plugin's markers (a `<button>`, e.g.
// file-tree's reveal button), code spans this plugin's pane decoration
// already glued, and anything glued before (idempotency).
import { afterEach, describe, expect, it } from "vitest";
import {
  HOST_PANEL_ATTR,
  glueHostLinkIcon,
  glueSweep,
  installHostLinkGlue,
} from "../components/host-link-glue";

function hostAnchor(html: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener");
  anchor.setAttribute("href", "file:///workspace/docs/notes.md");
  anchor.innerHTML = html;
  document.body.appendChild(anchor);
  return anchor;
}

function hostIcon(): string {
  return `<svg data-icon="ExternalLink" data-icon-root="" class="ml-1 inline size-3 align-[-0.125em] text-subtle-foreground" aria-hidden><path d="m0 0"/></svg>`;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("glueHostLinkIcon", () => {
  it("fuses the icon with the anchor's final character in a nowrap unit", () => {
    const anchor = hostAnchor(`docs/notes.md${hostIcon()}`);
    const icon = anchor.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(glueHostLinkIcon(document, icon!)).toBe(true);
    const glue = anchor.querySelector("[data-focus-board-host-glue]");
    expect(glue).not.toBeNull();
    expect(glue!.style.whiteSpace).toBe("nowrap");
    expect(glue!.firstChild!.nodeType).toBe(3);
    expect((glue!.firstChild as Text).data).toBe("d");
    expect(glue!.contains(icon!)).toBe(true);
    // Path stays exactly the same visible text.
    expect(anchor.textContent).toBe("docs/notes.md");
  });

  it("glues inside a styled terminal element and keeps trailing content in place", () => {
    // Text inside a `<code>` box, icon at anchor level, trailing space
    // after the icon: the glue lives in the code box (styling context),
    // the visible text never changes, and the stray space stays last.
    const anchor = hostAnchor(
      `<span>read </span><code>docs/notes.md</code>${hostIcon()} `,
    );
    const icon = anchor.querySelector("svg")!;
    expect(glueHostLinkIcon(document, icon)).toBe(true);
    const code = anchor.querySelector("code")!;
    const glue = code.querySelector("[data-focus-board-host-glue]")!;
    expect(glue.parentElement).toBe(code);
    expect(glue.firstChild!.nodeType).toBe(3);
    expect((glue.firstChild as Text).data).toBe("d");
    expect(glue.contains(icon)).toBe(true);
    expect(code.textContent).toBe("docs/notes.md");
    expect(anchor.textContent).toBe("read docs/notes.md ");
  });

  it("glues the last visible letter plus a trailing space; visible text unchanged", () => {
    // Trailing whitespace: the glue moves "d " (last letter + trailing
    // space) with the icon, so a wrap strands "d ↗", never "↗" alone.
    const anchor = hostAnchor(`docs/notes.md ${hostIcon()}`);
    const icon = anchor.querySelector("svg")!;
    expect(glueHostLinkIcon(document, icon)).toBe(true);
    expect((anchor.firstChild as Text).data).toBe("docs/notes.m");
    const glue = anchor.querySelector("[data-focus-board-host-glue]")!;
    expect((glue.firstChild as Text).data).toBe("d ");
    // Visible text: glue char dedupes the split char, so the anchor shows
    // the original characters exactly once each.
    expect(anchor.textContent).toBe("docs/notes.md ");
  });

  it("moves a single-character text node whole instead of splitting it", () => {
    const anchor = hostAnchor(`<b>x</b>${hostIcon()}`);
    const icon = anchor.querySelector("svg")!;
    expect(glueHostLinkIcon(document, icon)).toBe(true);
    const glue = anchor.querySelector("[data-focus-board-host-glue]")!;
    expect((glue.firstChild as Text).data).toBe("x");
    expect(anchor.textContent).toBe("x");
  });

  it("refuses an anchor with a button (another plugin's anchor)", () => {
    const anchor = hostAnchor(`docs/notes.md<button data-file-tree-reveal>go</button>${hostIcon()}`);
    const icon = anchor.querySelector("svg")!;
    expect(glueHostLinkIcon(document, icon)).toBe(false);
    expect(anchor.querySelector("[data-focus-board-host-glue]")).toBeNull();
  });

  it("refuses our own pane-decorated code spans", () => {
    const anchor = hostAnchor(
      `<code data-focus-board-path-link="">docs/notes.me</code>${hostIcon()}`,
    );
    const icon = anchor.querySelector("svg")!;
    expect(glueHostLinkIcon(document, icon)).toBe(false);
    expect(anchor.querySelector("[data-focus-board-host-glue]")).toBeNull();
  });

  it("is idempotent on a second pass", () => {
    const anchor = hostAnchor(`docs/notes.md${hostIcon()}`);
    const icon = anchor.querySelector("svg")!;
    expect(glueHostLinkIcon(document, icon)).toBe(true);
    const glue = anchor.querySelector("[data-focus-board-host-glue]")!;
    expect(glueHostLinkIcon(document, icon)).toBe(false);
    // Still exactly one glue unit, one icon inside it.
    expect(anchor.querySelectorAll("[data-focus-board-host-glue]").length).toBe(1);
    expect(anchor.querySelectorAll("svg").length).toBe(1);
  });
});

describe("glueSweep", () => {
  it("glues only icons inside the panel container", () => {
    const panel = document.createElement("div");
    panel.setAttribute(HOST_PANEL_ATTR, "");
    const inside = hostAnchor(`docs/notes.md${hostIcon()}`);
    panel.appendChild(inside);
    const outside = document.createElement("a");
    outside.setAttribute("href", "https://example.com/x.md");
    outside.innerHTML = `other/x.md${hostIcon()}`;
    document.body.appendChild(outside);
    document.body.appendChild(panel);
    glueSweep(document);
    expect(inside.querySelector("[data-focus-board-host-glue]")).not.toBeNull();
    expect(outside.querySelector("[data-focus-board-host-glue]")).toBeNull();
  });
});

describe("installHostLinkGlue", () => {
  it("sweeps immediately, observes later mutations, and disconnects on dispose", () => {
    const panel = document.createElement("div");
    panel.setAttribute(HOST_PANEL_ATTR, "");
    document.body.appendChild(panel);
    const anchor = hostAnchor(`docs/notes.md${hostIcon()}`);
    panel.appendChild(anchor);
    const signal = new AbortController().signal;
    const dispose = installHostLinkGlue({ signal });
    expect(anchor.querySelector("[data-focus-board-host-glue]")).not.toBeNull();

    // A mutation (a second host-rendered anchor appearing) is glued.
    const anchor2 = document.createElement("a");
    anchor2.setAttribute("href", "file:///workspace/docs/other.md");
    anchor2.innerHTML = `other/later.md${hostIcon()}`;
    panel.appendChild(anchor2);
    // MutationObserver callbacks fire on a microtask checkpoint; flush it.
    return new Promise<void>((resolve) => setTimeout(resolve, 50)).then(() => {
      expect(anchor2.querySelector("[data-focus-board-host-glue]")).not.toBeNull();
      dispose();
    });
  });
});
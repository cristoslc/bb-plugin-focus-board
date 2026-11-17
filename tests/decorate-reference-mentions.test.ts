// @vitest-environment jsdom
// The reference-token decorator the pane paints over the host's ThreadChat
// markdown (issue #161 "Agent-written reference tokens in pane messages stay
// dead text"): the agent writes `@project:proj_…` / `@thread:thr_…` as plain
// markdown, the host's shared renderer autolinks only raw `@thread:` tokens
// and paints chips only when the message carries composer mention metadata,
// so an agent-written project reference stays dead text — and a raw thread
// token renders as an empty custom element, vanishing from view. This module
// converts those tokens into labeled, navigable chips. These tests pin the
// DOM behavior: which tokens convert, which stay inert, how labels resolve
// and refresh, and the attributes the pane's click-capture handler routes.
import { describe, expect, it } from "vitest";
import {
  decorateReferenceMentions,
  decoratedReferencePaneTarget,
  mentionReferenceInText,
  mentionShaped,
} from "../components/decorate-reference-mentions";
import type { ReferenceLabeler } from "../components/decorate-reference-mentions";

function message(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

const labels: ReferenceLabeler = {
  threadLabel: (threadId) =>
    threadId === "thr_glyph_glue"
      ? "Wrap check: long path with the open glyph"
      : null,
  projectLabel: (projectId) =>
    projectId === "proj_api" ? "API Gateway" : null,
};

describe("decorateReferenceMentions", () => {
  it("paints an agent-written project token into a labeled chip carrying its target", () => {
    const root = message(
      "<p>load-bearing for @project:proj_api (its calls ship image inputs)</p>",
    );
    decorateReferenceMentions(root, labels);
    const chip = root.querySelector<HTMLElement>("[data-focus-board-ref-kind]");
    expect(chip).not.toBeNull();
    expect(decoratedReferencePaneTarget(chip)).toEqual({
      kind: "project",
      id: "proj_api",
      messageSeq: null,
    });
    // The resolved label replaces the raw token; the surrounding prose stays.
    expect(root.querySelector("p")!.childNodes[0]!.textContent).toBe(
      "load-bearing for ",
    );
    expect(root.querySelector("p")!.textContent).not.toContain("@project:");
    expect(chip!.textContent).toContain("API Gateway");
  });

  it("paints a thread token and swallows an attached #msg fragment", () => {
    const root = message(
      "<p>packaging thread: @thread:thr_glyph_glue#msg=12 is now active</p>",
    );
    decorateReferenceMentions(root, labels);
    const chip = root.querySelector<HTMLElement>("[data-focus-board-ref-kind]");
    expect(decoratedReferencePaneTarget(chip)).toEqual({
      kind: "thread",
      id: "thr_glyph_glue",
      messageSeq: 12,
    });
    expect(root.querySelector("p")!.textContent).not.toContain("#msg=12");
    expect(chip!.textContent).toContain(
      "Wrap check: long path with the open glyph",
    );
  });

  it("converts every token in one text run, keeping the prose between them", () => {
    const root = message(
      "<p>see @project:proj_api then @thread:thr_glyph_glue — both alive</p>",
    );
    decorateReferenceMentions(root, labels);
    const chips = root.querySelectorAll<HTMLElement>("[data-focus-board-ref-kind]");
    expect(chips).toHaveLength(2);
    expect(decoratedReferencePaneTarget(chips[0]!)).toMatchObject({
      kind: "project",
    });
    expect(decoratedReferencePaneTarget(chips[1]!)).toMatchObject({
      kind: "thread",
    });
    expect(root.querySelector("p")!.textContent).toBe(
      "see API Gateway then Wrap check: long path with the open glyph — both alive",
    );
  });

  it("falls back to the raw id as the label when the target is unknown", () => {
    const root = message("<p>forked from @thread:thr_missing_1 yesterday</p>");
    decorateReferenceMentions(root, labels);
    const chip = root.querySelector<HTMLElement>("[data-focus-board-ref-kind]");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("thr_missing_1");
    // Still navigable: the click handler routes whatever the label shows.
    expect(decoratedReferencePaneTarget(chip)).toEqual({
      kind: "thread",
      id: "thr_missing_1",
      messageSeq: null,
    });
  });

  it("fills a fallback label in on a later scan with resolved labels", () => {
    const root = message("<p>forked from @thread:thr_glyph_glue yesterday</p>");
    decorateReferenceMentions(root, {
      threadLabel: () => null,
      projectLabel: () => null,
    });
    expect(root.querySelector("[data-focus-board-ref-kind]")!.textContent).toBe(
      "thr_glyph_glue",
    );
    decorateReferenceMentions(root, labels);
    expect(root.querySelector("[data-focus-board-ref-kind]")!.textContent).toBe(
      "Wrap check: long path with the open glyph",
    );
  });

  it("paints a bare project id token the agent abbreviates to", () => {
    // Verbatim shape from thread thr_646fydrhzt: agents frequently drop the
    // `project:` prefix and write the bare id (`@proj_…`), so the chip must
    // dispatch on the id prefix itself.
    const root = message(
      "<p>(vision stays on it for @proj_api); the pruned chat is ready</p>",
    );
    decorateReferenceMentions(root, labels);
    const chip = root.querySelector<HTMLElement>("[data-focus-board-ref-kind]");
    expect(decoratedReferencePaneTarget(chip)).toEqual({
      kind: "project",
      id: "proj_api",
      messageSeq: null,
    });
    expect(chip!.textContent).toContain("API Gateway");
    expect(root.querySelector("p")!.textContent).toBe(
      "(vision stays on it for API Gateway); the pruned chat is ready",
    );
  });

  it("paints a bare thread id token and swallows an attached #msg fragment", () => {
    const root = message("<p>twin of @thr_glyph_glue#msg=5 is catching up</p>");
    decorateReferenceMentions(root, labels);
    const chip = root.querySelector<HTMLElement>("[data-focus-board-ref-kind]");
    expect(decoratedReferencePaneTarget(chip)).toEqual({
      kind: "thread",
      id: "thr_glyph_glue",
      messageSeq: 5,
    });
    expect(chip!.textContent).toContain("Wrap check: long path with the open glyph");
    expect(root.querySelector("p")!.textContent).not.toContain("#msg=5");
  });

  it("leaves the host's numeric mention form and arbitrary @word@ text inert", () => {
    // A numeric form like `@291@` is not a bb reference the pane can route:
    // it never carries a target id, so converting it would invent
    // navigation. Arbitrary `@handle@` prose stays raw for the same reason.
    const root = message("<p>message 291 marker @291@ stays raw</p>");
    decorateReferenceMentions(root, labels);
    expect(root.querySelector("p")!.textContent).toBe(
      "message 291 marker @291@ stays raw",
    );
    expect(root.querySelectorAll("[data-focus-board-ref-kind]")).toHaveLength(0);
  });

  it("decorates inside inline code but leaves links, code blocks, and host chips alone", () => {
    const root = message(
      '<a href="x">@project:proj_api</a>' +
        "<pre><code>@project:proj_api in a block</code></pre>" +
        "<p><code>@project:proj_api</code>" +
        '<bb-thread-mention data-thread-id="thr_glyph_glue">host chip</bb-thread-mention>' +
        "</p>",
    );
    decorateReferenceMentions(root, labels);
    const chips = root.querySelectorAll<HTMLElement>("[data-focus-board-ref-kind]");
    expect(chips).toHaveLength(1); // the inline-code span only
    expect(chips[0]!.closest("code")).not.toBeNull();
    // Unclaimed surfaces keep their raw token verbatim.
    expect(root.querySelector("a")!.textContent).toBe("@project:proj_api");
    expect(root.querySelector("pre")!.textContent).toBe(
      "@project:proj_api in a block",
    );
    // The host painted its own chip there — untouched by the repaint scan.
    const host = root.querySelector("bb-thread-mention")!;
    expect(host.textContent).toBe("host chip");
    expect(host.closest("[data-focus-board-ref-kind]")).toBeNull();
  });

  it("repaints the host's EMPTY mention elements, which render as nothing", () => {
    // When the message carries no mention metadata the host's autolink still
    // emits a `bb-thread-mention` element — but with no chip renderer wired
    // it stays an empty inline custom element: the token vanishes from view.
    // Both attribute spellings the host ships must resolve.
    const root = message(
      "<p>Homelab thread <bb-thread-mention data-thread-id=\"thr_glyph_glue\"></bb-thread-mention> done; then <bb-thread-mention dataThreadId=\"thr_missing_1\" dataMessageSeq=\"3\"></bb-thread-mention>.</p>",
    );
    decorateReferenceMentions(root, labels);
    const repainted = root.querySelectorAll<HTMLElement>(
      "bb-thread-mention[data-focus-board-ref-kind]",
    );
    expect(repainted).toHaveLength(2);
    expect(repainted[0]!.textContent).toBe(
      "Wrap check: long path with the open glyph",
    );
    expect(decoratedReferencePaneTarget(repainted[0])).toEqual({
      kind: "thread",
      id: "thr_glyph_glue",
      messageSeq: null,
    });
    expect(decoratedReferencePaneTarget(repainted[1])).toEqual({
      kind: "thread",
      id: "thr_missing_1",
      messageSeq: 3,
    });
  });

  it("does not repaint a host mention element the host already filled", () => {
    // A repaint pass must not rebuild or restyle a chip the host itself
    // rendered: only EMPTY mentions (the renderer-less shape) are claimed.
    const root = message(
      '<bb-thread-mention data-thread-id="thr_glyph_glue"><span class="host-chip">Wrap check</span></bb-thread-mention>',
    );
    decorateReferenceMentions(root, labels);
    const host = root.querySelector("bb-thread-mention")!;
    expect(host.textContent).toBe("Wrap check");
    expect(host.className).toBe("");
    expect(decoratedReferencePaneTarget(host)).toBeNull();
  });

  it("leaves malformed tokens plain and is idempotent across re-scans", () => {
    const root = message(
      "<p>keep @thread:proj_api and @project:notprefixed and mail@project:proj_api raw</p>",
    );
    decorateReferenceMentions(root, labels);
    expect(root.querySelector("p")!.textContent).toContain("@thread:proj_api");
    expect(root.querySelector("p")!.textContent).toContain(
      "@project:notprefixed",
    );
    // The prefix-consistent `@project:proj_api` still converts.
    expect(root.querySelectorAll("[data-focus-board-ref-kind]")).toHaveLength(1);
  });

  it("repainting never duplicates chips or rewrites settled labels", () => {
    const root = message("<p>see @thread:thr_glyph_glue again</p>");
    decorateReferenceMentions(root, labels);
    decorateReferenceMentions(root, labels);
    expect(root.querySelectorAll("[data-focus-board-ref-kind]")).toHaveLength(1);
    expect(root.querySelector("p")!.textContent).toBe(
      "see Wrap check: long path with the open glyph again",
    );
  });

  it("labels are text nodes, never parsed markup", () => {
    // Security: a thread title arrives from any thread (agent- or
    // operator-named); the chip's label must land as text only.
    const hostile = '<img src=x onerror="alert(1)">';
    const root = message("<p>twin of @thread:thr_hostile here</p>");
    decorateReferenceMentions(root, {
      threadLabel: () => hostile,
      projectLabel: () => null,
    });
    expect(root.querySelectorAll("img, script, iframe, object, embed")).toHaveLength(0);
    for (const element of Array.from(root.querySelectorAll("*"))) {
      for (const attribute of Array.from(element.attributes)) {
        expect(/^on/i.test(attribute.name) ? attribute.name : "").toBe("");
      }
    }
    expect(root.querySelector("[data-focus-board-ref-kind]")!.textContent).toBe(hostile);
  });

  it("returns null from the accessor for non-chip elements", () => {
    const root = message("<p><span>plain</span></p>");
    decorateReferenceMentions(root, labels);
    expect(decoratedReferencePaneTarget(null)).toBeNull();
    expect(decoratedReferencePaneTarget(root.querySelector("span"))).toBeNull();
  });
});

describe("mention tokens read from a destination", () => {
  // bb renders an agent-written mention as a percent-encoded token resolved
  // into a file:// href under the workspace root; the pane's click capture
  // parses that decoded destination (the "File not found." regression).
  it("parses the host's file:// destination and the raw serialized forms", () => {
    expect(
      mentionReferenceInText(
        decodeURIComponent(
          "file:///Users/cristos/Documents/projects/bv-brain2/%40thread%3Athr_cvvvkw6rjz",
        ),
      ),
    ).toEqual({ kind: "thread", id: "thr_cvvvkw6rjz", messageSeq: null });
    expect(mentionReferenceInText("@project:proj_api")).toEqual({
      kind: "project",
      id: "proj_api",
      messageSeq: null,
    });
    expect(mentionReferenceInText("@thr_glyph_glue#msg=12")).toEqual({
      kind: "thread",
      id: "thr_glyph_glue",
      messageSeq: 12,
    });
  });

  it("refuses a malformed token but still reports the mention shape", () => {
    expect(mentionReferenceInText("@thread:proj_nope")).toBeNull();
    expect(mentionShaped("@thread:proj_nope")).toBe(true);
    expect(mentionReferenceInText("docs/erd.md")).toBeNull();
    expect(mentionShaped("docs/erd.md")).toBe(false);
    // A route-style thread href is not a token: the pane leaves it to the
    // host's own routing.
    expect(mentionShaped("/projects/web/threads/thr_review_pr")).toBe(false);
  });
});
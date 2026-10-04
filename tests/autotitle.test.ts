// Pure helpers behind the thread pane's ✨ auto-rename button: the title
// prompt built from the thread's first user prompt, and the cleanup that
// turns a model's raw reply into a usable one-line title. The SDK call
// wiring lives in server.ts; these stay pure so both can be tested without
// a host.
import { describe, expect, it } from "vitest";
import {
  AUTOTITLE_PROMPT_MAX_CHARS,
  buildAutotitlePrompt,
  clampPromptText,
  cleanGeneratedTitle,
  promptTextFromHistory,
  resolveTitleSelection,
} from "../lib/autotitle";

describe("promptTextFromHistory", () => {
  it("joins the first prompt entry's text parts, per-part trimmed", () => {
    expect(
      promptTextFromHistory([
        {
          input: [
            { type: "text", text: "Fix the  " },
            { type: "text", text: "login redirect loop" },
          ],
        },
      ]),
    ).toBe("Fix the login redirect loop");
  });

  it("skips non-text parts and agent-only parts", () => {
    expect(
      promptTextFromHistory([
        {
          input: [
            { type: "localFile", path: "a/b.png" },
            {
              type: "text",
              text: "hidden scaffold",
              visibility: "agent-only",
            },
            { type: "text", text: "Add CSV export" },
          ],
        },
      ]),
    ).toBe("Add CSV export");
  });

  it("ignores entries after the first", () => {
    // bb titles a thread from its originating prompt; later follow-ups
    // carry refinements the original task should not be drowned by.
    expect(
      promptTextFromHistory([
        { input: [{ type: "text", text: "First task" }] },
        { input: [{ type: "text", text: "Second follow-up" }] },
      ]),
    ).toBe("First task");
  });

  it("returns null when the first prompt carries no visible text", () => {
    expect(promptTextFromHistory([])).toBeNull();
    expect(
      promptTextFromHistory([{ input: [{ type: "localImage", path: "x.png" }] }]),
    ).toBeNull();
    expect(
      promptTextFromHistory([
        {
          input: [
            { type: "text", text: "   " },
            { type: "text", text: "", visibility: "agent-only" },
          ],
        },
      ]),
    ).toBeNull();
  });
});

describe("clampPromptText", () => {
  it("passes short text through unchanged", () => {
    expect(clampPromptText("hello", 100)).toBe("hello");
  });

  it("truncates overlong text to the cap", () => {
    const long = "x".repeat(AUTOTITLE_PROMPT_MAX_CHARS + 10);
    expect(clampPromptText(long).length).toBeLessThanOrEqual(
      AUTOTITLE_PROMPT_MAX_CHARS,
    );
    // The cap lands inside the marker tail, not inside user content.
    expect(clampPromptText(long).endsWith("…")).toBe(false);
    expect(clampPromptText(long).length).toBe(AUTOTITLE_PROMPT_MAX_CHARS);
  });
});

describe("buildAutotitlePrompt", () => {
  it("embeds the thread prompt under the title instructions", () => {
    const prompt = buildAutotitlePrompt("Fix the login redirect loop");
    expect(prompt).toContain("Fix the login redirect loop");
    expect(prompt).toContain("Reply with only the title");
    // The instruction is the prefix; the thread text stays last so models
    // weight it as the payload, not as instructions to follow.
    expect(prompt.indexOf("Reply with only the title")).toBeLessThan(
      prompt.indexOf("Fix the login redirect loop"),
    );
  });
});

describe("cleanGeneratedTitle", () => {
  it("trims and collapses whitespace and newlines", () => {
    expect(cleanGeneratedTitle("  Fix\nthe   login  loop \n")).toBe(
      "Fix the login loop",
    );
  });

  it("strips one layer of straight or curly wrapping quotes", () => {
    expect(cleanGeneratedTitle('"Fix the login loop"')).toBe(
      "Fix the login loop",
    );
    expect(cleanGeneratedTitle("“Fix the login loop”")).toBe(
      "Fix the login loop",
    );
    // Only one layer: a title legitimately containing quotes keeps them.
    expect(cleanGeneratedTitle('"The "X" button"')).toBe('The "X" button');
  });

  it("caps the title at 120 characters without splitting a word", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const title = cleanGeneratedTitle(words)!;
    expect(title.length).toBeLessThanOrEqual(120);
    // The backtrack keeps whole words: the cut lands at a space boundary,
    // so the title never ends inside a word the model wrote.
    expect(title.endsWith("word")).toBe(false);
    expect(cleanGeneratedTitle("x".repeat(300))).toHaveLength(120);
  });

  it("drops reasoning-style preambles and returns null when nothing usable remains", () => {
    expect(cleanGeneratedTitle("")).toBeNull();
    expect(cleanGeneratedTitle('  \n"  "\n')).toBeNull();
  });
});

describe("resolveTitleSelection", () => {
  const selection = (s: unknown) => resolveTitleSelection({
    selections: { "thread-title": s },
  } as Parameters<typeof resolveTitleSelection>[0]);

  it("accepts a plugin service selection", () => {
    expect(
      selection({
        mode: "service",
        pluginId: "openrouter-inference",
        serviceId: "default",
      }),
    ).toEqual({ ok: true, pluginId: "openrouter-inference", serviceId: "default" });
  });

  it("rejects automatic: bb resolves it internally and plugins cannot invoke it", () => {
    const outcome = selection({ mode: "automatic" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // The message must tell the operator what to do, not fail silently.
      expect(outcome.reason).toMatch(/ai services/i);
    }
  });

  it("rejects off", () => {
    expect(selection({ mode: "off" }).ok).toBe(false);
  });

  it("rejects a service selection missing its plugin id", () => {
    expect(selection({ mode: "service", serviceId: "default" }).ok).toBe(false);
  });
});
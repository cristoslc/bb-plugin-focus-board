// Pure helpers behind the ✨ auto-rename thread-model probe (see
// server.ts's thread_autotitle useThreadModel path): the probe prompt (the
// shared bb-style title instructions plus the no-tools guardrail), the
// timeline reader that extracts the probe's assistant reply, and the
// settle check for the status poll. Pure so both can be tested without a
// host.
import { describe, expect, it } from "vitest";
import {
  assistantTextFromTimeline,
  buildAutotitleProbePrompt,
  probeSettled,
  type AutotitleTimelineRow,
} from "../lib/autotitle-thread-model";

const conversation = (
  role: string,
  text: string,
  kind: string = "conversation",
): AutotitleTimelineRow =>
  ({ kind, role, text, id: `row_${text}` }) as unknown as AutotitleTimelineRow;

describe("buildAutotitleProbePrompt", () => {
  it("keeps the shared bb-style title instructions and appends the no-tools guardrail", () => {
    const prompt = buildAutotitleProbePrompt("Fix the login redirect loop");
    // The head is the shared prompt: the same instructions the service
    // bridge serves, so both paths produce the same title style.
    expect(prompt).toMatch(/concise titles/i);
    expect(prompt).toContain("Fix the login redirect loop");
    // The probe is a real agent turn: it must never touch the workspace.
    expect(prompt).toMatch(/no tools/i);
    expect(prompt).toMatch(/title/i);
  });
});

describe("assistantTextFromTimeline", () => {
  it("reads the last assistant conversation row's text", () => {
    const rows = [
      conversation("user", "title probe prompt"),
      conversation("assistant", "first attempt"),
      conversation("assistant", "Login redirect loop fix"),
      { kind: "system", text: "noise", id: "s1" },
    ] as unknown as readonly AutotitleTimelineRow[];
    expect(assistantTextFromTimeline(rows)).toBe("Login redirect loop fix");
  });

  it("skips user and system rows when hunting for assistant text", () => {
    const rows = [
      conversation("user", "only a user turn"),
      conversation("user", "still none", "work"),
    ] as unknown as readonly AutotitleTimelineRow[];
    expect(assistantTextFromTimeline(rows)).toBeNull();
  });

  it("returns null for an empty timeline", () => {
    expect(assistantTextFromTimeline([])).toBeNull();
  });

  it("strips think blocks the model wrapped its title in", () => {
    // bb's own reply cleanup matches <think>/<thinking> blocks (an
    // unclosed one tolerates to end-of-text); the probe reader strips them
    // the same way before handing the text to the title cleaner.
    expect(
      assistantTextFromTimeline([
        conversation("assistant", "<think>some musing about tooling</think>Login redirect loop fix"),
      ]),
    ).toBe("Login redirect loop fix");
    expect(
      assistantTextFromTimeline([
        conversation("assistant", "<thinking>another musing</thinking>Fallback probe title"),
      ]),
    ).toBe("Fallback probe title");
    // bb's exact semantics: an unclosed block consumes to end-of-text, so a
    // leaked tag that never closes yields nothing usable — the caller fails
    // loud instead of shipping a truncated title.
    expect(
      assistantTextFromTimeline([
        conversation("assistant", "<think>never closedLogin probe title"),
      ]),
    ).toBeNull();
  });
});

describe("probeSettled", () => {
  it("settles on idle (success) and error (failure)", () => {
    expect(probeSettled("idle")).toBe(true);
    expect(probeSettled("error")).toBe(true);
  });

  it("keeps polling through the transient statuses and unknown kinds", () => {
    expect(probeSettled("pending")).toBe(false);
    expect(probeSettled("starting")).toBe(false);
    expect(probeSettled("active")).toBe(false);
    expect(probeSettled("stopping")).toBe(false);
    expect(probeSettled("mystery")).toBe(false);
  });
});
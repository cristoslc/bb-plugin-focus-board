// @vitest-environment jsdom
// The What's-new feed's contributor surface: a bullet whose body ends with
// the ruled bracket note (`[Fix and tests by @handle]`) renders the parsed
// note as a muted attribution line under its lead; a bullet without one
// renders exactly the lead (and children) it always did.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WhatsNewFeed } from "../components/whats-new-feed";
import type { WhatsNewEntry, WhatsNewItem } from "../lib/whats-new";

afterEach(cleanup);

const entry = (items: readonly WhatsNewItem[]): WhatsNewEntry => ({
  version: "0.6.0-dev",
  unreleased: true,
  items,
});

describe("WhatsNewFeed contributor notes", () => {
  it("a bullet with a bracket note surfaces the contributor under its lead", () => {
    render(
      <WhatsNewFeed
        entries={[
          entry([
            {
              lead: "Threads running background work stay in Working.",
              contributor: "Fix and tests by @lukehowlett97",
            },
          ]),
        ]}
      />,
    );
    expect(screen.getByText("Threads running background work stay in Working.")).toBeTruthy();
    expect(screen.getByText("Fix and tests by @lukehowlett97")).toBeTruthy();
  });

  it("a bullet without a note renders exactly as before, with no attribution line", () => {
    render(
      <WhatsNewFeed
        entries={[
          entry([
            {
              lead: "The load-time dissolve no longer plays.",
              children: ["A sub-bullet reads the same."],
            },
          ]),
        ]}
      />,
    );
    expect(screen.getByText("The load-time dissolve no longer plays.")).toBeTruthy();
    expect(screen.getByText("A sub-bullet reads the same.")).toBeTruthy();
    expect(screen.queryByText(/Fix and tests by/)).toBeNull();
  });
});

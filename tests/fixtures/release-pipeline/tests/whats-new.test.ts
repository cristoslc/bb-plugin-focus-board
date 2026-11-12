import { describe, expect, it } from "vitest";

/** The fixture's entries-since expectation. The finalize commit prepends the
 *  version it publishes; the driver refuses to edit a file it cannot anchor. */
describe("entriesSince", () => {
  it("returns entries strictly newer than the stored version", () => {
    const entries = entriesSince("0.4.2");
    expect(entries.map((entry) => entry.version)).toEqual([
      "1.2.2",
      "1.2.1",
    ]);
  });
});

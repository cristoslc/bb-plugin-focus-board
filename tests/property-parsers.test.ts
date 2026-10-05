// Property tests over the board's fail-loud state parsers (fast-check).
//
// The unit suites pin enumerated bad shapes; these properties pin the
// STRONGER law: for ANY JSON value, a parser either returns the documented
// shape or throws the documented error class — never a wrong shape that
// would silently coerce persisted state. Round-trip laws ride alongside.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import {
  parseDoneRecord,
  doneAtToEpochMs,
  stampDone,
  type DoneRecord,
} from "../lib/done-metadata";
import { parsePinParkRecord } from "../lib/pin-park";
import {
  parseRankStore,
  rankRowFromStore,
  columnRankKey,
  type RankStore,
} from "../lib/rank";
import {
  parseSnoozeRecord,
  stampSnooze,
  type SnoozeRecord,
} from "../lib/snooze";
import {
  parseNestStored,
  parseGroupStored,
  parseParentLaneOrderStored,
  parseCollapsedFamiliesStored,
  collapsedFamiliesStoredValue,
  nestStoredValue,
} from "../components/preferences";

const isoString = fc.date({ noInvalidDate: true }).map((d) => d.toISOString());

/** The stored-value garbage every preference parser must survive. */
const preferenceGarbage = fc.oneof(
  fc.constant(null),
  fc.string({ maxLength: 80 }),
  fc.integer(),
  fc.jsonValue().filter((v) => typeof v !== "string"),
);

describe("parseSnoozeRecord properties", () => {
  it("returns null, a well-formed record, or throws — never a wrong shape", () => {
    fc.assert(
      fc.property(fc.option(fc.jsonValue(), { nil: undefined }), (value) => {
        let result: unknown;
        try {
          result = parseSnoozeRecord(value as JsonValue);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          return;
        }
        if (result === null) return;
        const record = result as { wakeAt: unknown; setAt: unknown };
        expect(typeof record.wakeAt).toBe("string");
        expect(Number.isNaN(Date.parse(record.wakeAt as string))).toBe(false);
        expect(typeof record.setAt).toBe("string");
        expect(Number.isNaN(Date.parse(record.setAt as string))).toBe(false);
      }),
    );
  });

  it("stamped records round-trip exactly", () => {
    fc.assert(
      fc.property(
        fc.date({ noInvalidDate: true }),
        fc.date({ noInvalidDate: true }),
        (setAt, wakeAt) => {
          const stamped = stampSnooze(setAt, wakeAt);
          expect(parseSnoozeRecord(stamped as JsonValue)).toEqual(stamped);
        },
      ),
    );
  });
});

describe("parseDoneRecord properties", () => {
  it("returns null, a well-formed record, or throws — never a wrong shape", () => {
    fc.assert(
      fc.property(fc.option(fc.jsonValue(), { nil: undefined }), (value) => {
        let result: unknown;
        try {
          result = parseDoneRecord(value as JsonValue);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          return;
        }
        if (result === null) return;
        const record = result as { doneAt: unknown; keep?: unknown };
        expect(typeof record.doneAt).toBe("string");
        expect(Number.isNaN(Date.parse(record.doneAt as string))).toBe(false);
        if (record.keep !== undefined) {
          expect(typeof record.keep).toBe("boolean");
        }
      }),
    );
  });

  it("re-stamping preserves keep and refreshes doneAt", () => {
    fc.assert(
      fc.property(
        fc.date({ noInvalidDate: true }),
        fc.date({ noInvalidDate: true }),
        fc.option(fc.boolean(), { nil: undefined }),
        (existingAt, now, keep) => {
          const existing: DoneRecord | null =
            existingAt === undefined
              ? null
              : { doneAt: existingAt.toISOString(), ...(keep !== undefined ? { keep } : {}) };
          const stamped = stampDone(existing, now);
          expect(stamped.doneAt).toBe(now.toISOString());
          if (keep !== undefined) expect(stamped.keep).toBe(keep);
          expect(parseDoneRecord(stamped as JsonValue)).toEqual(stamped);
        },
      ),
    );
  });

  it("doneAtToEpochMs: number for a parseable ISO, null otherwise", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (iso) => {
        const ms = doneAtToEpochMs(iso);
        if (ms === null) {
          expect(Number.isNaN(Date.parse(iso)) || !Number.isFinite(ms as never)).toBe(true);
        } else {
          expect(ms).toBe(Date.parse(iso));
        }
      }),
    );
  });
});

describe("parsePinParkRecord properties", () => {
  it("returns null, a well-formed record, or throws — never a wrong shape", () => {
    fc.assert(
      fc.property(fc.option(fc.jsonValue(), { nil: undefined }), (value) => {
        let result: unknown;
        try {
          result = parsePinParkRecord(value as JsonValue);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          return;
        }
        if (result === null) return;
        const record = result as { parkedAt: unknown };
        expect(typeof record.parkedAt).toBe("string");
        expect(Number.isNaN(Date.parse(record.parkedAt as string))).toBe(false);
      }),
    );
  });
});

describe("parseRankStore properties", () => {
  const validStore: fc.Arbitrary<RankStore> = fc
    .uniqueArray(fc.string({ minLength: 1 }), { maxLength: 6 })
    .chain((keys) =>
      fc.record(
        Object.fromEntries(
          keys.map((key) => [
            key,
            fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 8 }),
          ]),
        ) as never,
      ) as fc.Arbitrary<RankStore>,
    );

  it("returns {}, a well-formed store, or throws — never a wrong shape", () => {
    fc.assert(
      fc.property(fc.option(fc.jsonValue(), { nil: undefined }), (raw) => {
        let result: unknown;
        try {
          result = parseRankStore(raw);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          return;
        }
        if (typeof result !== "object" || result === null) {
          throw new Error("parseRankStore returned a non-object");
        }
        for (const [, order] of Object.entries(result as RankStore)) {
          expect(Array.isArray(order)).toBe(true);
          for (const id of order) {
            expect(typeof id).toBe("string");
            expect(id).not.toBe("");
          }
        }
      }),
    );
  });

  it("row round-trip: rankRowFromStore → parseRankStore is the identity", () => {
    fc.assert(
      fc.property(validStore, (store) => {
        expect(parseRankStore(rankRowFromStore(store))).toEqual(store);
      }),
    );
  });
});

describe("preference parser properties (corrupt anything, degrade to documented defaults)", () => {
  it("parseNestStored: only the exact 'off' string is false, everything else true", () => {
    fc.assert(
      fc.property(preferenceGarbage, (raw) => {
        expect(parseNestStored(raw as string | null)).toBe(
          (raw as string | null) === "off" ? false : true,
        );
      }),
    );
  });

  it("parseGroupStored: only the exact allow-list members pass, everything else falls back to 'status'", () => {
    const allowed = ["none", "status", "recency", "project", "provider", "machine", "parent"];
    fc.assert(
      fc.property(preferenceGarbage, (raw) => {
        const parsed = parseGroupStored(raw as string | null);
        if (typeof raw === "string" && allowed.includes(raw)) {
          expect(parsed).toBe(raw);
        } else {
          expect(parsed).toBe("status");
        }
      }),
    );
  });

  it("parseParentLaneOrderStored: allow-list or the 'recency' fallback", () => {
    fc.assert(
      fc.property(preferenceGarbage, (raw) => {
        const parsed = parseParentLaneOrderStored(raw as string | null);
        if (raw === "recency" || raw === "project") {
          expect(parsed).toBe(raw);
        } else {
          expect(parsed).toBe("recency");
        }
      }),
    );
  });

  it("parseCollapsedFamiliesStored: always a Set of strings, never throws", () => {
    fc.assert(
      fc.property(preferenceGarbage, (raw) => {
        const parsed = parseCollapsedFamiliesStored(raw as string | null);
        expect(parsed).toBeInstanceOf(Set);
        for (const id of parsed) expect(typeof id).toBe("string");
      }),
    );
  });

  it("collapsed families round-trip through the stored form", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 10 }),
        (ids) => {
          const stored = collapsedFamiliesStoredValue(new Set(ids));
          expect([...parseCollapsedFamiliesStored(stored)].sort()).toEqual(
            [...ids].sort(),
          );
        },
      ),
    );
  });

  it("nest toggle round-trips through its stored form", () => {
    fc.assert(
      fc.property(fc.boolean(), (enabled) => {
        expect(parseNestStored(nestStoredValue(enabled))).toBe(enabled);
      }),
    );
  });
});

describe("columnRankKey properties", () => {
  it("the Pinned and Done lanes are never namespaced, every other column always is", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("none", "status", "recency", "project", "provider", "machine", "parent"),
        fc.string({ minLength: 1 }),
        (groupBy, columnId) => {
          const key = columnRankKey(groupBy, columnId);
          if (columnId === "pinned" || columnId === "done") {
            expect(key).toBe(columnId);
          } else {
            expect(key).toBe(`${groupBy}:${columnId}`);
            expect(key).not.toBe("pinned");
            expect(key).not.toBe("done");
          }
        },
      ),
    );
  });
});

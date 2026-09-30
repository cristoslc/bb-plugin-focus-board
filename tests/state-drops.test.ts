// @vitest-environment jsdom
// The Unread column's drop writes: dropping a Pinned card there must BOTH
// unpin it and mark it unread — the column a card sits in derives from its
// pin state, so an unaccompanied "mark unread" would bounce the card straight
// back into Pinned and the drop would look like a no-op.
import { describe, expect, it } from "vitest";
import { unreadDropWrites } from "../lib/state-drops";
import { thread } from "./thread-fixture";

describe("unreadDropWrites", () => {
  it("a Pinned read card gets both writes: unpin AND mark unread", () => {
    const writes = unreadDropWrites(thread({ isPinned: true, isUnread: false }));
    expect(writes).toEqual({ markUnread: true, unpin: true });
  });

  it("a Pinned already-unread card still unpins — the gesture moved it out of Pinned", () => {
    const writes = unreadDropWrites(thread({ isPinned: true, isUnread: true }));
    expect(writes).toEqual({ markUnread: false, unpin: true });
  });

  it("an unpinned read card is only marked unread", () => {
    const writes = unreadDropWrites(thread({ isPinned: false, isUnread: false }));
    expect(writes).toEqual({ markUnread: true, unpin: false });
  });

  it("an unpinned already-unread card writes nothing (idempotent drop)", () => {
    const writes = unreadDropWrites(thread({ isPinned: false, isUnread: true }));
    expect(writes).toEqual({ markUnread: false, unpin: false });
  });
});
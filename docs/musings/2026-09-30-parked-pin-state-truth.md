# Spike: the cross-surface pin/read feed, and state-truth for parked cards

*2026-09-30 · spike into "who did the action?" — can the board observe and
act on state writes from every bb surface, or only from its own gestures?*
Started from the parked-pin model's one documented gap: a pin toggled off on
a foreign surface (bb's own thread menu) could not be intercepted, so a
parked pin could in principle resurrect against it. Turns out the answer was
already in bb, plus one fact in bb's own write map that makes a pure
state-driven rule safe.

## The feed: `thread:changed` exists natively, per surface, per kind

`useSdk()` (the bound public API client) carries `realtime.subscribe` with
native event names — the relevant one is `thread:changed`. Payload shape
(the discriminated `changedMessageSchema`): `{ type: "changed", entity:
"thread", id?, changes: [...] }` where `changes` lists granular kinds:
`pin-state-changed`, `read-state-changed`, `archived-changed`,
`interactions-changed`, `status-changed`, … Every mutation publishes through
the ONE server notifier, from every surface: bb's own menus, the sidebar
actions plugins call, CLI, other plugins — one write, one event, all clients.

What it does NOT carry: actor/session metadata. "Who" is not in the payload.
Two writes with identical resulting state are indistinguishable at the event
level. Also note: `id` is optional in the schema, and ambient writes may
publish through a NOOP notifier.

## The deciding fact: `lastReadAt = null` has exactly one author

bb's server (`server/dist`, the bundled `applyThreadLifecycleEvent` /
`updateThread` / read routes plus Drizzle schema) writes `lastReadAt` from:

| Writer | Value | Publishes? |
| --- | --- | --- |
| Thread create | `now` | (creation, not read-state) |
| `applyUserTurnReadForEvent` — a user-initiated turn (`client/turn/requested`, initiator `user`) | `Date.now()` | **NO — noop notifier** |
| `POST /threads/:id/read` — deliberate mark-read (native menu, plugins) | `Date.now()` | YES (`read-state-changed`) |
| `POST /threads/:id/unread` — deliberate mark-unread (native menu,plugins) | `null` | YES (`read-state-changed`) |

So `read-state-changed` events exist ONLY for deliberate, surfaced
read/unread writes; and among those, `lastReadAt = null` identifies
mark-unread — nothing else nulls the column, ever (the plain "unread
predicate" — attention after last read — is ambient and cannot be safely
triggered on). That is the state-truth seam: the card's state decides, the
actor never matters, because the state itself encodes the intent that
matters (`lastReadAt === null` ⇔ someone deliberately pulled this thread
back to unread).

Likewise for pins: `pinnedAt` is the single truth; any surface's pin write
publishes `pin-state-changed`, and pinned-or-not is one fresh row read away
(`threads.get`).

## The state-truth model this lands (operator directive)

**The card's state is the source of truth, not the gesture.** A thread
becoming unread — from ANY surface — is the operator calling it back up the
attention ladder, and the card's contradictory or superseded state yields:

- **A parked pin returns.** The pin the lane exit took rides the unread back:
  the card lands back in the Pinned lane wearing the mark, the park is
  consumed by the restore. (Previously this fired only for the board's own
  menu/pane marks; the un-done half below is new.)
- **Done is undone.** Unread and done contradict on one card (the same
  ladder rule that already lets attention outrank placement), so a Done card
  marked unread — native menu or board menu — comes back un-done: the done
  record is removed exactly as "Mark Not Done" removes it.

Every check is on CURRENT state, so the reaction is idempotent and
loop-free: our gestures compose the effect directly (immediate), their feed
echoes re-run it as a no-op (the checks already passed), and the
`done-changed` publish rides the existing refetch. No feedback loops exist
because every triggered write (pin, done) publishes a different kind than
the trigger.

**The one non-idempotent case**: the drag onto the Unread column from a
PINNED card — the exit un-pins AND parks in the same gesture, so the
gesture's own read echo would re-assert the park it just wrote (the card
would bounce straight back to Pinned and the exit gesture dies). Guarded by
a per-thread suppression token, set synchronously at gesture time and
consumed by the feed's first `read-state-changed` event for that thread —
not a timer, a one-shot handoff.

## Residual races (accepted, documented)

- A foreign surfaced write landing between our gesture's write and our own
  echo can consume the suppression token (miscredited as ours) — subsequent
  foreign writes on the same thread decide normally; the window is one echo
  latency.
- A foreign pin+unpin cycle compressing entirely into one reconcile's
  fresh-read latency (~ms, same connection) can still hide; there is no
  persistent trace of a pin cycle to inspect, and no actor metadata —
  unknowable in principle until bb enriches `thread:changed` with actor
  data, at which point the reconciler could key on the actor exactly.
- Embedded contexts (the screenshot harness) have no `subscribe`; there the
  gestures carry the effects alone and foreign-surface reactions are inert.

## Deliberately not done

- No restore on mark-**read** from any surface: the park survives reading,
  so a read-now-unread-later card still finds its pin (operator decision,
  earlier turn).
- Foreign mark-unread on a Done card not parked: still un-dones (the
  contradiction rule applies to the card's state, not its provenance).
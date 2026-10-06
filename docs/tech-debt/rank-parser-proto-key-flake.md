# Rank parser drops `__proto__` keys across the persist/parse round-trip

Status: open (fix planned — test-first, see Part 2 of the #14 follow-up)

## Observed failure

`tests/property-parsers.test.ts` — the fast-check property `row round-trip:
rankRowFromStore → parseRankStore is the identity` — failed once during the #14
release session on a random fast-check seed. The generated rank store contained
a column key `"__proto__"` with an order array. After
`parseRankStore(rankRowFromStore(store))`, the `__proto__` entry was not the
identity: the reparsed store lost the key, and the returned object's prototype
had been re-pointed at the order array.

## Root cause

`parseRankStore` (`lib/rank.ts`) builds its output as a plain `{}` and copies
each column with a plain assignment, `out[columnKey] = order`. For a
`columnKey` of `"__proto__"` that assignment invokes `Object.prototype`'s
`__proto__` accessor instead of creating an own data property. Two effects:

- the `__proto__` column silently vanishes from the parsed store;
- the store's own prototype is set to the order value (an array), so the
  "parsed" object is no longer a plain object.

This is a prototype-pollution-shaped parser bug, not a persistence bug. The
writer side, `rankRowFromStore`, is already safe: `Object.fromEntries` uses
`CreateDataProperty`, and `JSON.parse` (what the KV read effectively is) also
creates `__proto__` as an own property — so a real persisted row can carry the
key in, and only the parser's assignment drops it.

## Evidence

- Seed-dependent: the property failed once on one random seed and then passed
  on repeated isolated reruns of the full suite and of
  `tests/property-parsers.test.ts` alone. fast-check shrinks the minimal
  counterexample to exactly a `__proto__`-keyed store row.
- Reproducible deterministically by parsing
  `JSON.parse('{"__proto__":["thr_x"],"pinned":["thr_a"]}')` and asserting the
  round-trip identity — see the new pinned test in `tests/rank.test.ts`
  (added failing before the fix, per the mandatory test-first order).
- Not a release regression: passes at HEAD for all normal keys; the bug only
  fires for a column key equal to `"__proto__"`. The RPC contract already
  rejects a `__proto__` `columnKey` at the boundary
  (`COLUMN_KEY_SCHEMA`, `server.ts`), so no live write path can create such a
  column today — the parser must still be safe because the KV row is
  untrusted at the parse boundary regardless of the write guard.

## Chosen fix

Prototype-safe property creation in `parseRankStore`: create every column as
an explicit own data property (via `Object.defineProperty`) instead of a plain
object-literal assignment, so `"__proto__"` is carried like any other string
key and the returned store keeps `Object.prototype`. Fail-loud is preserved:
the documented throw laws are unchanged, no coercion or try/catch is added.
Pinned by the deterministic test in `tests/rank.test.ts`.
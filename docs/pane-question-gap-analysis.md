# Gap analysis: pane question card vs. host main-view question form

Sources of truth for the host behavior (read from the shipped app bundle):

- Main-view banner + form: `app/dist/assets/workspace-checkout-display-BEd72bXo.js`
  (`B0` shell, `s2` form, `o2` question, `a2` tab strip, `I0` shortcut host)
- Builtin plugin renderer (plugin-kind questions): `builtin-plugins/ask-user-question/dist/app.js`
  (`Em` → `ka`, functionally identical to `s2`)
- Our pane card: `components/pending-interaction-card.tsx`

The host renders **one** interaction UX for both payload shapes; the pane card
should match it. Gaps below are ordered by user impact.

## P0 — Layout: the card starves the chat (the "can't read other text" bug)

| Host | Pane card |
|---|---|
| Banner lives **inside the composer stack**, directly above the input. The chat transcript above stays fully visible and scrollable at all times. | Card sits between the pane header and `ThreadChat` as `shrink-0` with **no height cap**. A tall form squeezes the `flex-1` chat area toward zero — on a phone (full-screen sheet, plus the on-screen keyboard) the transcript is effectively gone. |
| Form body scrolls internally: `max-h-[calc(100dvh-6rem)] min-h-0 flex-col` with `overflow-y-auto overscroll-contain touch-pan-y` on the questions area. | No internal scroll container; `overflow-hidden` on the card root can **clip** the submit row entirely. |
| Banner **collapses** to a one-line label ("Hide details" / "Show details", `initiallyExpanded`, Escape collapses) so you can read/scroll the thread while deferring the answer. | No collapse affordance. The form is always fully expanded. |

Fixes: cap + internal scrolling on the form, place the card so the chat keeps a
usable minimum, add the collapse/expand toggle with Escape-to-collapse.

## P0 — Sequential questions: tabbed one-at-a-time, not stacked

| Host | Pane card |
|---|---|
| Multi-question interactions render a **tab strip** (`a2`): one question visible at a time; each tab shows the question's `shortLabel` (default "Question N"), struck through once answered; "N of M" counter; tabs are horizontally scrollable, clickable, `title` = prompt. | All questions render **stacked in one long form** — exactly what the user reported. |
| Navigation: **Back** (disabled on first) / **Next** (last question → "Submit answer"). Submit stays disabled until *every* question is answered, not just the visible one. | No Back/Next; single Submit at the bottom. |

## P1 — Free-text-only questions show the textarea immediately

- Host: `otherSelected` initializes to `!W0(question)` — i.e. **true when the
  question has no options** (`G0`/`K0`), so a free-text-only question opens
  with the textarea visible, no "Other" tap needed.
- Pane: `initialAnswerState()` always starts `{ other: false }`, so a
  free-text-only question shows a pointless "Other" checkbox row the user must
  toggle before typing. Real provider questions use `options: []` +
  `allowFreeText: true`, so this bites on exactly the payloads that motivated
  the card.

Also: the host's Other row only renders when `options.length > 0` (the
textarea takes over otherwise); ours renders an "Other" row even with zero
options.

## P1 — Keyboard handling

Host (`s2` + `I0` shortcut context):

- **Number keys 1–5** select option N / Other for the visible question,
  handled via a `registerChoiceHandler` + global listener; rows show shortcut
  hints.
- **Enter** on the form container advances (Next) or submits; guard rails for
  IME composition and modifier keys.
- **Cmd/Ctrl+Enter** inside the Other textarea submits.
- Escape **collapses the banner** (pane currently: document-level Escape
  closes the whole pane — acceptable, but collapse should win while the
  banner is focused/expanded).

Pane: none of these. Only per-field Escape stopPropagation.

## P1 — Resolve-in-flight feedback and state

- Host disables the form from the interaction's own `status === "resolving"`
  (server state, survives refetch races) and shows a **spinner in the submit
  button** plus disabled Cancel.
- Pane tracks only local `submitting`; a refetch that lands mid-submit
  re-enables the form, and there's no spinner.

## P2 — Selection hygiene

- Host filters stale selections against the current option values before
  validation and submission (`q0`), so a payload change can't submit orphaned
  values. Pane trusts `selected` as-is.
- Host's "answered" check (`J0`) is "some selected value is a known option OR
  other text non-blank"; ours checks `selected.length > 0` only.

## P2 — Accessibility / polish deltas

- Radio vs. checkbox control shapes: host uses `rounded-full` for
  single-select and square for multi-select; pane uses squares everywhere.
- Error region: host `aria-live="polite"` inside the banner; pane prints a
  plain `<p>`.
- Submit button: host shows a spinner icon; pane swaps text to "Submitting…".
- Option rows: host shows keyboard shortcut hints; pane has none (ties to P1).
- `wbr` word-break hints in long labels (`H0`); pane truncates the header via
  CSS only.
- "From <thread>" source link exists on host banners for cross-thread
  display; not applicable in the pane (the pane header already names the
  thread).

## Correct behaviors already in parity

- Both payload shapes (`user_question`, `plugin`) and their submit paths
  (`interactions.resolve` vs `interactions.respond`), stop-turn vs cancel.
- Answer-value semantics: single-select Other drops picks; multi-select keeps
  them; blank free text omitted; free-text cap 4096; option cap 4.
- Preview `<pre>` for selected single-select options (pane: no max-height —
  host caps at 220px; minor).
- Live refresh via `interactions-changed`; fallback row for unrenderable
  plugin forms.

## Suggested fix plan (smallest change that closes P0/P1)

1. Restructure the card: collapsible shell (default expanded), capped body
   (`max-h` + `overflow-y-auto overscroll-contain`), keep `ThreadChat`
   `min-h-*` floor so the transcript always scrolls.
2. One question at a time: tab strip of `shortLabel`s (struck-through when
   answered), Back/Next, global answered-gate on Submit.
3. `initialAnswerState(question)`: `other = question.options.length === 0`;
   hide the Other row when there are no options.
4. Number-key shortcuts + Enter-advance + Cmd/Ctrl+Enter submit; skip
   `autoFocus` on the textarea for coarse pointers (host does this — stops
   the phone keyboard from hijacking the sheet).
5. Disable from `interaction.status === "resolving"` too; spinner in the
   Submit button; filter selections to known option values on submit.

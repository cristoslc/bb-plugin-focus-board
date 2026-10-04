# Behavior details

Fine-grained notes that don't belong in the README's feature list.

## Grouping

- In Parent-thread mode lanes sort by family recency (most recently touched family at left) and can optionally group by project.

## Drag and drop

- Reorder a column by dragging cards into your own order instead of the board's recency order. The order belongs to the column, not the thread, so a card that leaves a column and comes back returns to the slot it left.
- Dropping a card on a card in a new column (Pinned, Done, Unread) places it at that spot in the same drop — state change and position in one drag.
- Alt+ArrowUp / Alt+ArrowDown does the same from the keyboard, and a lane with a hand-set order says so in its header.
- Leaving Pinned unpins: dropping a pinned card on Unread or Done — or marking it done from its menu — takes the pin with it, so the card stays where you put it instead of snapping back into Pinned.

## Nesting

- A family can live in two spaces at once: the active card keeps the live children nested, and the done children render in a second card — the family's projection — in the Done column, dimmed, with the done children nested beneath it. A done parent keeps its single Done card. Each card's child-count chip counts its own space.
- Archived children are hidden outright: they render nowhere on either board view, child chips count only visible children, and the children of an archived parent render standalone instead of vanishing.
- A family card that nests more than five child rows caps the list and scrolls inside the card; the collapse toggle still hides the whole list.
- Collapsed rows fold into a strip of status-colored dots directly below the card's count chip (one dot per nested child; hovering a dot names it); the fold toggle sits directly above the rows it acts on, and folds persist across sessions (localStorage).
- A child that needs you never hides behind a fold: it un-nests and renders as its own card in Needs you while the rest of the rows stay folded, and returns to the nest once its question is answered.
- A column drained to zero by nesting hides until a card returns to it.
- A family card's nested rows can be collapsed: the chevron folds the rows into a "N child threads" pill that re-opens them, and the collapsed families persist across sessions (localStorage).
- A collapsed card opens by itself when one of its nested children turns unread or needs you; a family collapsed while a child was already unread stays folded.

## Snooze

- Snoozing a thread reads it now and makes it unread again at the target time: the set gesture marks the thread read, so it leaves the Unread column; the wake stamps mark-unread at the target time, so the card returns to Unread like fresh mail. The board's existing wake handling (pin restore, un-done) applies with no snooze-specific wiring.
- A snoozed card stays in its column, dimmed, with a "Snoozed · wakes …" chip (the open thread pane's header carries the same chip). One "Snooze…" menu entry (cards and the thread pane's actions menu) opens a single picker with the presets (1 hour, 4 hours, tomorrow 9am, 1 week) and a date-time field; a snoozed thread's menu shows "Edit snooze…", whose picker confirms a changed wake time or removes the wake-up call.
- The snooze beats the sweep: snoozed cards are not sweep candidates on the board and are skipped by the server-side sweep while their sleep lasts. A snoozed card also refuses drag, so it cannot be dropped into a lane move its sleep is meant to skip.
- Any state-changing gesture lifts the snooze first — pin, read toggle, done toggle, archive, or removing the wake-up from the edit picker. If the thread is genuinely read by hand while snoozed, the wake consumes the snooze without re-alerting.
- Wake timers live server-side: they are re-armed on plugin load (a past-due snooze wakes immediately) and cleared on dispose. Full CLI parity: `bb focus-board snooze list|set|clear`.

## Escape

- While a pane's thread is running, Escape interrupts the turn instead of closing the pane; the pane closes with Escape once nothing is running (toggle in the plugin's settings).

## Thread pane and history

- The open pane is part of the panel's URL (`…/board/t/<threadId>`), so bb's back arrow returns you to the pane you left after following a link out to a full thread in main bb — and walks back through cards you lost track of, one pane per step. A deep link opens the board with that pane directly.
- Grouping, filters, and search are preferences, not history: they persist across sessions in localStorage and are deliberately not replayed by the back arrow (see [ADR 0001](adr/0001-pane-history-in-url-preferences-in-localstorage.md)).
- The board keeps the active card in view when its lane changes (pin, done, grouping) and when a pane is restored from history.
- The pane's more-actions menu (beside Mark Done) pins and unpins with the card menu's semantics: the gesture lifts a snooze and clears a parked pin, and the board reveals the card's lane move after the pin lands. An archived row's menu keeps just its Unarchive.

## Answering questions

- When an agent asks a question (the ask-user-question tool), the pane renders the form and submits the answer from the board — the host's embedded chat only shows these in the main thread view. Both payload shapes are handled: provider `user_question` interactions (answered through `interactions.resolve`) and plugin forms (answered through `interactions.respond`). Unsupported plugin forms get an "Open in main view" fallback.

## What's new

- The 🎁 button pulses until opened; it never disappears, so the changelog stays reachable.

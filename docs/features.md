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

- A column drained to zero by nesting hides until a card returns to it.

## Escape

- While a pane's thread is running, Escape interrupts the turn instead of closing the pane; the pane closes with Escape once nothing is running (toggle in the plugin's settings).
- The pane debounces Escape: after it acts on an Escape (stopping the thread or closing), further Escapes inside a short double-click-sized window (~500 ms) are swallowed, so a double-tap stop never cascades into closing the pane; held-key auto-repeat is ignored outright.

## Thread pane and history

- The open pane is part of the panel's URL (`…/board/t/<threadId>`), so bb's back arrow returns you to the pane you left after following a link out to a full thread in main bb — and walks back through cards you lost track of, one pane per step. A deep link opens the board with that pane directly.
- Grouping, filters, and search are preferences, not history: they persist across sessions in localStorage and are deliberately not replayed by the back arrow (see [ADR 0001](adr/0001-pane-history-in-url-preferences-in-localstorage.md)).
- The board keeps the active card in view when its lane changes (pin, done, grouping) and when a pane is restored from history.

## Answering questions

- When an agent asks a question (the ask-user-question tool), the pane renders the form and submits the answer from the board — the host's embedded chat only shows these in the main thread view. Both payload shapes are handled: provider `user_question` interactions (answered through `interactions.resolve`) and plugin forms (answered through `interactions.respond`). Unsupported plugin forms get an "Open in main view" fallback.

## What's new

- The 🎁 button pulses until opened; it never disappears, so the changelog stays reachable.

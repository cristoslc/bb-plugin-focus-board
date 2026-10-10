// Maximize transfer: the board's New thread composer expands into bb's main
// new-thread view (the root compose surface). The stored prompt draft and the
// composer's seeds ride along, the modal closes, and the stored draft moves
// — it is not copied.
//
// The draft record is host-owned (apps/app `usePromptDraftStorage`): the
// localStorage key is
// `bb.promptbox.contents-plugin-draft-<encodeURIComponent(composerKey)>-<VERSION>`
// and the value is JSON `{ text, ... }`. This plugin never passes `draftKey`
// to `experimental_NewThreadComposer`, so the composer key is this plugin's
// id. Version bumps leave several keys behind; the highest version wins.
// Empty drafts are never written, so a found record implies text — guards
// still treat blank or malformed records as no transferable text.

/** This plugin's composer key: the plugin id, since no draftKey is passed. */
export const PLUGIN_COMPOSER_DRAFT_KEY = "focus-board";

const DRAFT_STORAGE_KEY_PREFIX = "bb.promptbox.contents-plugin-draft-";

export type DraftStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "removeItem"
>;

/** Every stored key for this composer's draft, oldest to newest version. */
export function newThreadDraftStorageKeys(
  storage: DraftStorage,
  composerKey: string,
): string[] {
  const prefix = DRAFT_STORAGE_KEY_PREFIX + encodeURIComponent(composerKey) + "-";
  const versioned: { suffix: number; key: string }[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null || !key.startsWith(prefix)) continue;
    const suffix = key.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    versioned.push({ suffix: Number(suffix), key });
  }
  versioned.sort((a, b) => a.suffix - b.suffix);
  return versioned.map((entry) => entry.key);
}

/** The stored prompt text for this composer, or null when nothing usable is
 *  stored. A malformed record reads as no draft — the board must not break
 *  on a host cache artifact it cannot parse, and the record is left in place. */
export function readNewThreadDraftText(
  storage: DraftStorage,
  composerKey: string,
): string | null {
  const keys = newThreadDraftStorageKeys(storage, composerKey);
  if (keys.length === 0) return null;
  const raw = storage.getItem(keys[keys.length - 1]);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("text" in parsed) ||
      typeof parsed.text !== "string"
    ) {
      return null;
    }
    const text = parsed.text;
    return text.trim() === "" ? null : text;
  } catch {
    return null;
  }
}

/**
 * Expand the board composer into bb's main new-thread view:
 * navigate with the composer's seeds and stored prompt text (the prompt
 * focuses, matching the expand intent), then remove the stored draft —
 * bb's main view seeds its own draft from the route state bb carries, so
 * leaving the record behind would resurrect the same text later.
 *
 * `toCompose` is synchronous and void, so the record must outlive the call
 * into whatever the host does while composing it: this removes only after
 * navigation returns, and only a record that actually transferred.
 *
 * Fidelity note: the host persists the composer draft on a ~250ms debounce,
 * so the trailing keystrokes of a burst of typing can miss the transfer —
 * the main view receives the last flushed record, not the exact character
 * the operator was mid-typing. This is best-effort by design; the transfer
 * never fabricates text that was not stored.
 */
export function maximizeComposerToMainView({
  navigate,
  storage,
  projectId,
  environmentId,
  composerKey = PLUGIN_COMPOSER_DRAFT_KEY,
}: {
  navigate: {
    toCompose: (options: {
      projectId?: string;
      environmentId?: string;
      initialPrompt?: string;
      focusPrompt?: boolean;
    }) => void;
  };
  storage: DraftStorage;
  projectId: string | undefined;
  environmentId: string | undefined;
  composerKey?: string;
}): void {
  const text = readNewThreadDraftText(storage, composerKey);
  navigate.toCompose({
    ...(projectId !== undefined ? { projectId } : {}),
    ...(environmentId !== undefined ? { environmentId } : {}),
    initialPrompt: text ?? "",
    focusPrompt: true,
  });
  if (text === null) return;
  const keys = newThreadDraftStorageKeys(storage, composerKey);
  if (keys.length > 0) storage.removeItem(keys[keys.length - 1]);
}
// Maximize transfer: the board composer rides up to bb's main new-thread
// view (BbNavigate.toCompose) carrying the plugin's stored prompt draft and
// the composer's seeds; the stored draft then moves, it is not copied.
// Draft storage is host-owned (apps/app usePromptDraftStorage): the key is
// `bb.promptbox.contents-plugin-draft-<encodeURIComponent(key)>-<VERSION>`,
// the value is JSON `{ text, ... }`, and empty drafts are never written.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLUGIN_COMPOSER_DRAFT_KEY,
  maximizeComposerToMainView,
  readNewThreadDraftText,
} from "../lib/compose-maximize";

const KEY_PREFIX = "bb.promptbox.contents-plugin-draft-";
const pluginKey = (composerKey: string, version: number): string =>
  `${KEY_PREFIX}${encodeURIComponent(composerKey)}-${version}`;

class FakeStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const draftRecord = (text: string): string => JSON.stringify({ text });

const toCompose = vi.fn();

beforeEach(() => {
  toCompose.mockReset();
});

describe("readNewThreadDraftText", () => {
  it("reads this plugin's stored draft text", () => {
    const storage = new FakeStorage();
    storage.setItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3), draftRecord("hello"));
    expect(readNewThreadDraftText(storage, PLUGIN_COMPOSER_DRAFT_KEY)).toBe("hello");
  });

  it("picks the newest versioned record when several survive an upgrade", () => {
    const storage = new FakeStorage();
    storage.setItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 2), draftRecord("old"));
    storage.setItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3), draftRecord("new"));
    expect(readNewThreadDraftText(storage, PLUGIN_COMPOSER_DRAFT_KEY)).toBe("new");
  });

  it("ignores foreign keys and other plugins' drafts", () => {
    const storage = new FakeStorage();
    storage.setItem("bb.promptbox.contents-draft-3", draftRecord("main view"));
    storage.setItem(pluginKey("other-plugin", 3), draftRecord("other"));
    storage.setItem("unrelated", "junk");
    expect(readNewThreadDraftText(storage, PLUGIN_COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it("treats a malformed record as no draft instead of throwing", () => {
    const storage = new FakeStorage();
    storage.setItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3), "{broken");
    expect(readNewThreadDraftText(storage, PLUGIN_COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it("reports absence for an empty-text record", () => {
    const storage = new FakeStorage();
    storage.setItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3), draftRecord("   "));
    expect(readNewThreadDraftText(storage, PLUGIN_COMPOSER_DRAFT_KEY)).toBeNull();
  });
});

describe("maximizeComposerToMainView", () => {
  it("navigates to the main compose view with the draft text and seeds", () => {
    const storage = new FakeStorage();
    storage.setItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3), draftRecord("ship it"));
    toCompose.mockClear();
    maximizeComposerToMainView({
      navigate: { toCompose },
      storage,
      projectId: "proj_1",
      environmentId: "env_1",
    });
    expect(toCompose).toHaveBeenCalledWith({
      projectId: "proj_1",
      environmentId: "env_1",
      initialPrompt: "ship it",
      focusPrompt: true,
    });
  });

  it("still expands, without a prompt, when no draft is stored", () => {
    const storage = new FakeStorage();
    toCompose.mockClear();
    maximizeComposerToMainView({
      navigate: { toCompose },
      storage,
      projectId: undefined,
      environmentId: undefined,
    });
    expect(toCompose).toHaveBeenCalledWith({ initialPrompt: "", focusPrompt: true });
  });

  it("the draft record still exists while the app reads the navigation state", () => {
    // Order guard: the main view seeds from the route state bb carries, but
    // a navigate implementation that resolved before the record vanished is
    // the contract the removal relies on. So the record must still be there
    // when toCompose fires.
    const storage = new FakeStorage();
    storage.setItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3), draftRecord("transfer me"));
    toCompose.mockImplementation(() => {
      expect(storage.getItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3))).not.toBeNull();
    });
    maximizeComposerToMainView({
      navigate: { toCompose },
      storage,
      projectId: undefined,
      environmentId: undefined,
    });
    expect(toCompose).toHaveBeenCalled();
  });

  it("keeps the transferred record after navigation, leaving others alone", () => {
    // A maximize is a close, not a spawn: the board modal's draft survives
    // it (the dialog promises "your draft is saved as you type, even if you
    // close and come back later"), and bb's main view seeds its own draft
    // from the transferred prompt. Only spending the prompt on a spawn may
    // clear it.
    const storage = new FakeStorage();
    storage.setItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3), draftRecord("moved"));
    storage.setItem(pluginKey("other-plugin", 3), draftRecord("stay"));
    toCompose.mockClear();
    maximizeComposerToMainView({
      navigate: { toCompose },
      storage,
      projectId: undefined,
      environmentId: undefined,
    });
    expect(storage.getItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3))).toBe(draftRecord("moved"));
    expect(storage.getItem(pluginKey("other-plugin", 3))).not.toBeNull();
  });

  it("keeps a record it could not parse rather than destroying host data", () => {
    const storage = new FakeStorage();
    storage.setItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3), "{broken");
    maximizeComposerToMainView({
      navigate: { toCompose },
      storage,
      projectId: undefined,
      environmentId: undefined,
    });
    expect(storage.getItem(pluginKey(PLUGIN_COMPOSER_DRAFT_KEY, 3))).not.toBeNull();
  });
});
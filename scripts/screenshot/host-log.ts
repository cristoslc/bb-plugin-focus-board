/**
 * Cross-window delivery for the harness's mocked host.
 *
 * bb's second window learns about a write because the host pushes a realtime
 * signal and the window refetches. The harness has no host process: each page
 * owns its own mock. `?sharedHost=1` turns on this log, which gives the two
 * pages the missing channel over the one store two same-origin documents
 * already share — localStorage — plus the `storage` event the browser fires
 * in every OTHER document when a key changes.
 *
 * One record per write, under its own key, is the point: two windows writing
 * at the same moment append two records instead of clobbering one array, which
 * is the same failure the real server's KV lock fixes. A page opened later
 * replays the log, so a window that loads after a write still sees the row the
 * other window wrote.
 */
import type { HostOp } from "./host-state";

export const HOST_LOG_PREFIX = "focus-board-harness-host:op:";

/**
 * The log prefix for one pair of windows. Each demo or suite gets its own
 * token, so records written by an earlier capture (or an earlier suite in the
 * same browser profile) can never replay into this one.
 */
export function hostLogPrefix(token: string): string {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(`a shared-host token must be a non-empty string; got ${JSON.stringify(token)}`);
  }
  return `${HOST_LOG_PREFIX}${token}:`;
}

/** The slice of Web Storage the log needs (localStorage, or a fake in tests). */
export interface HostLogStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HostLogRecord {
  key: string;
  op: HostOp;
}

export interface HostLogOptions {
  storage: HostLogStorage;
  prefix?: string;
  /** Wall clock, injectable so a test can pin record order. */
  clock?: () => number;
  /** Disambiguates two writes that land in the same millisecond. */
  nonce?: () => string;
}

export interface HostLog {
  /** True for a key this log owns (the `storage` listener filters with it). */
  isHostRecord(key: string): boolean;
  /** Append one write for the other windows; returns its record key. */
  publish(op: HostOp): string;
  /** Every recorded write after `afterKey`, in write order. */
  records(afterKey?: string | null): HostLogRecord[];
  /** The newest record key, or null when the log is empty. */
  lastKey(): string | null;
}

export function createHostLog({
  storage,
  prefix = HOST_LOG_PREFIX,
  clock = () => Date.now(),
  nonce = () => Math.random().toString(36).slice(2, 8),
}: HostLogOptions): HostLog {
  let sequence = 0;

  const isHostRecord = (key: string): boolean => key.startsWith(prefix);

  const keys = (): string[] => {
    const found: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && isHostRecord(key)) found.push(key);
    }
    // Timestamp first, per-window sequence and nonce after: lexicographic
    // order is write order even when both windows write in one millisecond.
    return found.sort();
  };

  return {
    isHostRecord,
    publish(op) {
      const key = `${prefix}${String(clock()).padStart(13, "0")}-${String(sequence).padStart(4, "0")}-${nonce()}`;
      sequence += 1;
      storage.setItem(key, JSON.stringify({ op }));
      return key;
    },
    records(afterKey = null) {
      return keys()
        .filter((key) => afterKey === null || key > afterKey)
        .map((key) => {
          const raw = storage.getItem(key);
          if (raw === null) {
            // The key was scanned and then gone: another actor cleared the
            // log mid-replay. A replayed row cannot be half-missing, so this
            // fails loudly instead of dropping a write the board should show.
            throw new Error(`host log record ${key} vanished between scan and read`);
          }
          const parsed = JSON.parse(raw) as { op?: unknown };
          if (parsed === null || typeof parsed !== "object" || parsed.op === undefined) {
            throw new Error(`host log record ${key} carries no op: ${raw}`);
          }
          return { key, op: parsed.op as HostOp };
        });
    },
    lastKey() {
      return keys().at(-1) ?? null;
    },
  };
}

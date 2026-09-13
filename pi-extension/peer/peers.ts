/**
 * peers.ts — per-session allowlist state.
 *
 * The allowlist is tied to the owning session (by session-id), NOT to the
 * global config.json. Persisted at `<peer-base>/peerlists/<ownId>.json`
 * (atomic write). Rationale over `.pi/<session-id>/peers.json` under the
 * project dir: the project cwd can differ per launch, which would scatter
 * or orphan the file — the peer base dir is a single deterministic root
 * every session can compute from its own id alone.
 *
 * Lifecycle:
 * - First start with no file → seed from config.json `peer.peers` (template
 *   for fresh sessions) and save immediately, so later config edits don't
 *   silently rewrite a live session's list.
 * - `session_shutdown` keeps the file (a resumed session inherits peers).
 * - Files with no live presence older than PEERLIST_MAX_AGE_MS are swept.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson, logPeerDrop } from "./transport.ts";
import { isValidSessionId } from "./paths.ts";

const PEERLISTS_DIR = "peerlists";
/** Stale peer lists (owner long gone) are swept after this age. */
export const PEERLIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const lists = new Map<string, Set<string>>();

export function peerListFileFor(base: string, ownId: string): string {
  return join(base, PEERLISTS_DIR, `${ownId}.json`);
}

export function seedPeers(ownId: string, peers: string[]): void {
  if (!lists.has(ownId)) lists.set(ownId, new Set(peers));
}

export function listPeers(ownId: string): string[] {
  return [...(lists.get(ownId) ?? new Set<string>())].sort();
}

export function hasPeer(ownId: string, id: string): boolean {
  return lists.get(ownId)?.has(id) ?? false;
}

/** Returns false when already present. */
export function addPeer(ownId: string, id: string): boolean {
  let set = lists.get(ownId);
  if (!set) {
    set = new Set();
    lists.set(ownId, set);
  }
  if (set.has(id)) return false;
  set.add(id);
  return true;
}

/** Returns false when absent. */
export function removePeer(ownId: string, id: string): boolean {
  const set = lists.get(ownId);
  if (!set || !set.has(id)) return false;
  set.delete(id);
  return true;
}

export function forgetPeers(ownId: string): void {
  lists.delete(ownId);
}

/**
 * Load a session's persisted list. Returns null when no file exists
 * (caller seeds from config template), otherwise the validated list
 * (possibly empty after block-all). Corrupt files are backed up as
 * `.corrupt-<ts>` evidence and treated as empty — never thrown.
 */
export function loadPeerList(base: string, ownId: string): string[] | null {
  const path = peerListFileFor(base, ownId);
  let raw: string;
  try {
    if (!existsSync(path)) return null;
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { peers?: unknown };
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).peers)) {
      throw new Error("missing peers array");
    }
    const peers: string[] = [];
    for (const entry of (parsed as any).peers) {
      if (!isValidSessionId(entry)) throw new Error(`invalid id ${JSON.stringify(entry)}`);
      if (!peers.includes(entry)) peers.push(entry);
    }
    return peers;
  } catch (err) {
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`);
    } catch {}
    try {
      logPeerDrop("peer-list", path, `corrupt-backed-up: ${(err as Error)?.message ?? err}`);
    } catch {}
    return [];
  }
}

/**
 * Persist the session's list (atomic). Returns an error string or null.
 */
export function savePeerList(base: string, ownId: string, peers: string[]): string | null {
  try {
    atomicWriteJson(peerListFileFor(base, ownId), { peers: [...peers].sort(), updatedAt: Date.now() });
    return null;
  } catch (err) {
    return `Could not save peer list: ${(err as Error)?.message ?? err}`;
  }
}

/**
 * Sweep peer lists whose owner has no live presence file and whose file is
 * older than maxAgeMs. Presence-live sessions are never touched.
 */
export function sweepStalePeerLists(
  base: string,
  presenceAlive: (id: string) => boolean,
  maxAgeMs = PEERLIST_MAX_AGE_MS,
): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(join(base, PEERLISTS_DIR));
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const f of entries) {
    if (!f.endsWith(".json") || f.includes(".corrupt-")) continue;
    const id = f.slice(0, -".json".length);
    if (!isValidSessionId(id)) continue;
    if (presenceAlive(id)) continue;
    const full = join(base, PEERLISTS_DIR, f);
    let age = 0;
    try {
      age = now - statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (age > maxAgeMs) {
      try {
        rmSync(full, { force: true });
        removed++;
      } catch {}
    }
  }
  return removed;
}

/** Test seam: clear all in-memory state. */
export function clearPeersForTest(): void {
  lists.clear();
}

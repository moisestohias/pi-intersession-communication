/**
 * peers.ts — per-session allowlist state.
 *
 * Each live session seeds its list from config.json `peer.peers`, then
 * `/peer allow|block` mutates the in-memory copy. Persist-back writes the
 * acting session's full list to config.json (last-writer-wins, documented;
 * single-user internal use).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteJson } from "./transport.ts";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CONFIG_PATH = join(PACKAGE_ROOT, "config.json");

const lists = new Map<string, Set<string>>();

export function seedPeers(ownId: string, configPeers: string[]): void {
  if (!lists.has(ownId)) lists.set(ownId, new Set(configPeers));
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
 * Persist the acting session's list back to config.json (atomic).
 * Preserves all other config keys. Returns an error string or null.
 */
export function persistPeers(peers: string[]): string | null {
  try {
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return `Could not read config.json: ${(err as Error).message}`;
    }
    const peer = (raw.peer != null && typeof raw.peer === "object" && !Array.isArray(raw.peer)
      ? raw.peer
      : {}) as Record<string, unknown>;
    atomicWriteJson(CONFIG_PATH, { ...raw, peer: { ...peer, peers: [...peers].sort() } });
    return null;
  } catch (err) {
    return `Could not write config.json: ${(err as Error)?.message ?? err}`;
  }
}

/** Test seam: clear all state. */
export function clearPeersForTest(): void {
  lists.clear();
}

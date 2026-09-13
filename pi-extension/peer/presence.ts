/**
 * presence.ts — liveness heartbeats. "Offline target = error immediately"
 * is implemented here: every live session rewrites its own heartbeat each
 * tick; the send path refuses when the target's heartbeat is missing/stale.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteJson } from "./transport.ts";
import { presenceFileFor } from "./paths.ts";

export interface Heartbeat {
  hb: number;
  pid?: number;
}

export function writeHeartbeat(base: string, sessionId: string): void {
  try {
    atomicWriteJson(presenceFileFor(base, sessionId), { hb: Date.now(), pid: process.pid } satisfies Heartbeat);
  } catch {}
}

export function removeHeartbeat(base: string, sessionId: string): void {
  try {
    rmSync(presenceFileFor(base, sessionId), { force: true });
  } catch {}
}

function readHeartbeat(path: string): Heartbeat | null {
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<Heartbeat>;
    if (typeof raw.hb !== "number" || !Number.isFinite(raw.hb)) return null;
    return raw as Heartbeat;
  } catch {
    return null;
  }
}

export type OnlineCheck = { online: true } | { online: false; reason: "missing" | "stale" };

/**
 * Freshness check for the send path. A stale file is unlinked best-effort
 * so the next sender sees a clean "missing" instead of stale.
 */
export function checkOnline(base: string, targetId: string, ttlMs: number): OnlineCheck {
  const path = presenceFileFor(base, targetId);
  const hb = readHeartbeat(path);
  if (!hb) return { online: false, reason: "missing" };
  if (Date.now() - hb.hb > ttlMs) {
    try {
      rmSync(path, { force: true });
    } catch {}
    return { online: false, reason: "stale" };
  }
  return { online: true };
}

/** Periodic GC for crash residue (killed sessions never ran shutdown). */
export function sweepStalePresence(base: string, ttlMs: number, graceMult = 4): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(join(base, "presence"));
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    const full = join(base, "presence", f);
    const hb = readHeartbeat(full);
    if (!hb && f !== ".gitkeep") {
      try {
        rmSync(full, { force: true });
        removed++;
      } catch {}
      continue;
    }
    if (hb && now - hb.hb > ttlMs * graceMult) {
      try {
        rmSync(full, { force: true });
        removed++;
      } catch {}
    }
  }
  return removed;
}

/** Ensure dirs exist for a session (inbox + presence parent). Best-effort. */
export function ensurePeerDirs(base: string, sessionId: string): void {
  try {
    mkdirSync(join(base, "inbox", sessionId), { recursive: true });
  } catch {}
  try {
    mkdirSync(dirname(presenceFileFor(base, sessionId)), { recursive: true });
  } catch {}
}

export function offlineErrorText(targetId: string, reason: "missing" | "stale"): string {
  return reason === "stale"
    ? `Session "${targetId}" looks offline (stale heartbeat — it may have exited). Message NOT sent. Ask the peer to start Pi and retry.`
    : `Session "${targetId}" is offline (no live heartbeat). Message NOT sent — this extension never queues for offline sessions.`;
}

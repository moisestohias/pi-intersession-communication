/**
 * transport.ts — atomic file handoff (dependency-free: node:fs/path only).
 *
 * Protocol: tmp+rename writes, rename-before-read claims. One file per
 * message so concurrent senders never interleave. Copied pattern from
 * pi-interactive-subagents `session/sidecars.ts` — not imported.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { inboxDirFor, messageFileFor } from "./paths.ts";

export interface PeerMessage {
  v: 1;
  id: string;
  from: string;
  to: string;
  ts: number;
  kind: "question" | "reply";
  text: string;
  in_reply_to: string | null;
}

export function randomMsgId(): string {
  return `m-${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 6)}`;
}

export function buildPeerMessage(args: {
  from: string;
  to: string;
  text: string;
  inReplyTo?: string | null;
}): PeerMessage {
  const inReplyTo = args.inReplyTo ?? null;
  return {
    v: 1,
    id: randomMsgId(),
    from: args.from,
    to: args.to,
    ts: Date.now(),
    kind: inReplyTo ? "reply" : "question",
    text: args.text,
    in_reply_to: inReplyTo,
  };
}

/** Atomic JSON write: tmp file + rename so readers never see a partial flush. */
export function atomicWriteJson(target: string, data: unknown): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  writeFileSync(tmp, JSON.stringify(data), "utf8");
  renameSync(tmp, target);
}

/**
 * Atomic claim (rename-before-read). Returns the claim path, or null when
 * absent / already claimed by a concurrent consumer (lost race → next tick).
 */
export function claimFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const claim = `${path}.consuming-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
    try {
      renameSync(path, claim);
    } catch {
      return null;
    }
    return claim;
  } catch {
    return null;
  }
}

function readJsonClaim<T>(claimPath: string): { ok: true; value: T } | { ok: false } {
  try {
    const value = JSON.parse(readFileSync(claimPath, "utf-8")) as T;
    try {
      rmSync(claimPath, { force: true });
    } catch {}
    return { ok: true, value };
  } catch {
    try {
      rmSync(claimPath, { force: true });
    } catch {}
    return { ok: false };
  }
}

// ── Corrupt-drop observability ──────────────────────────────────────────────

const dropCounts = new Map<string, number>();

export function logPeerDrop(kind: string, path: string, reason: string): void {
  try {
    dropCounts.set(kind, (dropCounts.get(kind) ?? 0) + 1);
  } catch {}
  try {
    console.error(`[peer corrupt-drop] kind=${kind} path=${path} reason=${reason}`);
  } catch {}
}

/** Test seam: snapshot of drop counters. */
export function peerDropCountsForTest(): Record<string, number> {
  return Object.fromEntries(dropCounts.entries());
}

// ── Inbox IO ────────────────────────────────────────────────────────────────

/** Persist one message to the target's inbox (atomic). Returns the file path. */
export function writePeerMessage(base: string, msg: PeerMessage): string {
  const target = messageFileFor(base, msg.to, msg.id);
  atomicWriteJson(target, msg);
  return target;
}

/** Sorted live message files (oldest first by name = creation order). */
export function listInboxFiles(base: string, ownId: string): string[] {
  const dir = inboxDirFor(base, ownId);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => /^msg-m-[A-Za-z0-9]+\.json$/.test(f))
    .sort()
    .map((f) => join(dir, f));
}

export type ClaimOutcome =
  | { status: "ok"; msg: PeerMessage; claim: null }
  | { status: "corrupt" }
  | { status: "lost-race" };

/**
 * Claim one inbox file and parse it. On success the file is consumed
 * (returns the message; nothing left on disk). Corrupt payloads are
 * consumed-and-dropped with a log (never retried — a torn file would
 * poison the poll loop forever).
 */
export function claimPeerMessageFile(path: string): ClaimOutcome {
  const claim = claimFile(path);
  if (!claim) return { status: "lost-race" };
  const read = readJsonClaim<PeerMessage>(claim);
  if (!read.ok) {
    logPeerDrop("peer-message", path, "torn-json-consumed");
    return { status: "corrupt" };
  }
  const msg = read.value;
  if (
    !msg ||
    typeof msg !== "object" ||
    typeof (msg as any).from !== "string" ||
    typeof (msg as any).text !== "string" ||
    typeof (msg as any).id !== "string"
  ) {
    logPeerDrop("peer-message", path, "missing-required-fields");
    return { status: "corrupt" };
  }
  return { status: "ok", msg: msg as PeerMessage, claim: null };
}

// ── No-clobber park (send-then-delete discipline) ───────────────────────────

/**
 * Park a payload that could not be delivered (steer threw) without
 * clobbering anything: writes it as `<inboxDir>/<orig>.pending-<pid>-<rand>`.
 * The next tick drains it. Never throws.
 */
export function parkPeerPayload(inboxDir: string, origBasename: string, msg: PeerMessage): void {
  try {
    mkdirSync(inboxDir, { recursive: true });
    const pending = join(inboxDir, `${origBasename}.pending-${process.pid}-${Math.random().toString(16).slice(2, 8)}`);
    atomicWriteJson(pending, msg);
  } catch {}
}

/**
 * Promote the oldest parked `.pending-*` payload back to a live message
 * file. Best-effort, never throws. Returns the restored path or null.
 */
export function promotePendingPeerFile(inboxDir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(inboxDir);
  } catch {
    return null;
  }
  const pending = entries.filter((f) => f.includes(".pending-")).sort();
  if (pending.length === 0) return null;
  const src = join(inboxDir, pending[0]);
  // Restore as a fresh live message file (same id, new sortable name is fine —
  // dedupe by id is not needed: claims are delete-on-read, each file fires once).
  const claimed = claimFile(src);
  if (!claimed) return null;
  const read = readJsonClaim<PeerMessage>(claimed);
  if (!read.ok) {
    logPeerDrop("peer-pending", src, "torn-json-consumed");
    return null;
  }
  const restored = join(inboxDir, `msg-${read.value.id}.json`);
  try {
    if (existsSync(restored)) {
      // A live copy already exists (shouldn't happen) — keep this one parked.
      parkPeerPayload(inboxDir, basename(src).split(".pending-")[0], read.value);
      return null;
    }
    atomicWriteJson(restored, read.value);
    return restored;
  } catch {
    return null;
  }
}

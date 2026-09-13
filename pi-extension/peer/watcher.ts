/**
 * watcher.ts — per-session inbox poll loop + presence heartbeat.
 *
 * One timer per live session (keyed by own session-id). session_shutdown
 * clears only its own timer and presence — never another session's.
 * Every tick is wrapped so a failure degrades to "next tick", never a
 * dead watcher and never a throw into the interval driver.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { inboxDirFor, shortId } from "./paths.ts";
import { getPeerBaseDir } from "./paths.ts";
import { getPeerConfig, getSafePeerConfig, invalidatePeerConfigCache } from "./config.ts";
import {
  claimPeerMessageFile,
  listInboxFiles,
  logPeerDrop,
  parkPeerPayload,
  promotePendingPeerFile,
  type PeerMessage,
} from "./transport.ts";
import { ensurePeerDirs, removeHeartbeat, sweepStalePresence, writeHeartbeat } from "./presence.ts";
import { seedPeers, listPeers, forgetPeers } from "./peers.ts";
import { shouldAcceptFrom } from "./validators.ts";
import { notifyPeerMessage } from "./notifications.ts";
import { renderPeerWidgetLines } from "./widget.ts";

export interface SessionPeerState {
  ownId: string;
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  timer: ReturnType<typeof setInterval> | null;
  ignoredUnknown: number;
  tickCount: number;
  lastWidgetSig: string;
}

/** Live per-session states, keyed by own session-id. */
export const peerSessions = new Map<string, SessionPeerState>();

// ── Wait table (wait mode: tick resolves instead of steering) ───────────────

interface Waiter {
  messageId: string;
  resolve: (msg: PeerMessage) => void;
}

const waiters = new Map<string, Map<string, Waiter>>(); // ownId -> messageId -> waiter

export function registerWaiter(ownId: string, messageId: string, resolve: (msg: PeerMessage) => void): void {
  let set = waiters.get(ownId);
  if (!set) {
    set = new Map();
    waiters.set(ownId, set);
  }
  set.set(messageId, { messageId, resolve });
}

export function unregisterWaiter(ownId: string, messageId: string): void {
  waiters.get(ownId)?.delete(messageId);
}

function takeWaiter(ownId: string, inReplyTo: string | null): Waiter | null {
  if (!inReplyTo) return null;
  const set = waiters.get(ownId);
  const w = set?.get(inReplyTo) ?? null;
  if (w) set!.delete(inReplyTo);
  return w;
}

/** Test seam. */
export function clearWaitersForTest(): void {
  waiters.clear();
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

function ownIdOf(ctx: ExtensionContext): string | null {
  try {
    const mgr = (ctx as any)?.sessionManager;
    const id = mgr?.getSessionId?.();
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

function refreshWidget(state: SessionPeerState): void {
  try {
    const cfg = getSafePeerConfig();
    const peers = listPeers(state.ownId);
    const sig = `${cfg.enabled}|${cfg.mode}|${peers.join(",")}|${state.ignoredUnknown}`;
    if (sig === state.lastWidgetSig) return;
    state.lastWidgetSig = sig;
    if (!(state.ctx as ExtensionContext)?.hasUI) return;
    if (!cfg.enabled) {
      state.ctx.ui.setWidget("peer-status", ["peer: disabled (peer.enabled=false)"], { placement: "aboveEditor" });
      return;
    }
    state.ctx.ui.setWidget(
      "peer-status",
      renderPeerWidgetLines({ ownId: state.ownId, peers, mode: cfg.mode, enabled: true, ignoredUnknown: state.ignoredUnknown }),
      { placement: "aboveEditor" },
    );
  } catch {}
}

/**
 * Start (or adopt) this session's watcher. Idempotent: a second
 * session_start for the same id refreshes ctx/pi and keeps one timer.
 */
export function startPeerSession(pi: ExtensionAPI, ctx: ExtensionContext): void {
  try {
    invalidatePeerConfigCache();
  } catch {}
  let ownId: string | null = null;
  try {
    ownId = ownIdOf(ctx);
  } catch {}
  if (!ownId) return;
  const id: string = ownId;

  let cfgPeers: string[] = [];
  try {
    cfgPeers = getPeerConfig().peers;
  } catch {
    cfgPeers = getSafePeerConfig().peers;
  }
  seedPeers(id, cfgPeers);

  const existing = peerSessions.get(id);
  if (existing) {
    existing.pi = pi;
    existing.ctx = ctx;
    refreshWidget(existing);
    return;
  }

  const base = getPeerBaseDir();
  try {
    ensurePeerDirs(base, id);
  } catch {}
  try {
    writeHeartbeat(base, id);
  } catch {}

  const state: SessionPeerState = { ownId: id, pi, ctx, timer: null, ignoredUnknown: 0, tickCount: 0, lastWidgetSig: "" };
  peerSessions.set(id, state);
  refreshWidget(state);

  let pollMs = 1500;
  try {
    pollMs = getSafePeerConfig().poll_ms;
  } catch {}
  state.timer = setInterval(() => {
    try {
      tick(state);
    } catch {}
  }, pollMs);
  try {
    (state.timer as any)?.unref?.();
  } catch {}
}

/** Stop one session's watcher: clear its timer, drop presence + widget + peers. */
export function stopPeerSession(ctxOrId: ExtensionContext | string): void {
  const id = typeof ctxOrId === "string" ? ctxOrId : ownIdOf(ctxOrId);
  if (!id) return;
  const state = peerSessions.get(id);
  if (state) {
    try {
      if (state.timer) clearInterval(state.timer);
    } catch {}
    try {
      state.ctx.ui.setWidget("peer-status", undefined);
    } catch {}
    peerSessions.delete(id);
  }
  try {
    removeHeartbeat(getPeerBaseDir(), id);
  } catch {}
  try {
    forgetPeers(id);
  } catch {}
  // Unresolved waiters belong to a dead session — drop them so senders time out cleanly.
  try {
    waiters.delete(id);
  } catch {}
}

/** Test seam: tick one session synchronously. */
export function tickForTest(ownId: string): void {
  const state = peerSessions.get(ownId);
  if (state) tick(state);
}

// ── Tick ────────────────────────────────────────────────────────────────────

function tick(state: SessionPeerState): void {
  const base = getPeerBaseDir();
  const cfg = getSafePeerConfig();
  if (!cfg.enabled) return;
  state.tickCount++;

  try {
    writeHeartbeat(base, state.ownId);
  } catch {}

  const inboxDir = inboxDirFor(base, state.ownId);
  try {
    promotePendingPeerFile(inboxDir);
  } catch {}

  let files: string[] = [];
  try {
    files = listInboxFiles(base, state.ownId);
  } catch {
    files = [];
  }

  for (const file of files) {
    let outcome: ReturnType<typeof claimPeerMessageFile>;
    try {
      outcome = claimPeerMessageFile(file);
    } catch {
      continue;
    }
    if (outcome.status !== "ok") continue; // corrupt (logged) or lost race
    const msg = outcome.msg;

    // Wait-mode intercept: a reply to an outstanding send resolves the
    // tool call instead of steering a duplicate notification.
    try {
      const waiter = takeWaiter(state.ownId, msg.in_reply_to);
      if (waiter) {
        try {
          waiter.resolve(msg);
        } catch {}
        continue;
      }
    } catch {}

    // Allowlist FIRST: strangers can write files but never steer this session.
    if (!shouldAcceptFrom(msg.from, listPeers(state.ownId))) {
      state.ignoredUnknown++;
      try {
        logPeerDrop("peer-unknown-sender", file, `from=${String((msg as any)?.from ?? "?")}`);
      } catch {}
      continue;
    }

    try {
      notifyPeerMessage(state.pi as any, {
        from: msg.from,
        messageId: msg.id,
        text: msg.text,
        inReplyTo: msg.in_reply_to,
        kind: msg.kind,
      });
    } catch {
      // Steer failed — park for retry (never silently drop a real message).
      try {
        const orig = file.split("/").pop() ?? `msg-${msg.id}.json`;
        parkPeerPayload(inboxDir, orig, msg);
      } catch {}
    }
  }

  if (state.tickCount % 10 === 0) {
    try {
      sweepStalePresence(base, cfg.presence_ttl_ms);
    } catch {}
  }

  refreshWidget(state);
}

/** Human hint for the model when a peer id is unknown. */
export function peerStatusLine(ownId: string): string {
  const peers = listPeers(ownId);
  return `own session-id: ${ownId} (${shortId(ownId)}); peers: ${peers.length > 0 ? peers.join(", ") : "(none)"}`;
}

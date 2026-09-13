/**
 * paths.ts — shared filesystem paths. No dependencies except node builtins.
 *
 * All peer addressing is derived deterministically from the session-id:
 * no global index or lookup table is needed (the subagents `index-cache`
 * is quarantined — we deliberately do not build on anything like it).
 *
 * Layout under the base dir:
 *   <base>/inbox/<session-id>/msg-<uuid>.json   — one file per message
 *   <base>/inbox/<session-id>/*.pending-*       — parked claims (no-clobber)
 *   <base>/inbox/<session-id>/*.consuming-*     — transient rename-claims
 *   <base>/inbox/<session-id>/*.tmp-*           — transient writer temps
 *   <base>/presence/<session-id>.json           — heartbeat {hb: epochMs}
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** Session-id charset. Rejects path traversal (../, /, whitespace) by construction. */
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}

/**
 * Single well-known root so sessions with different sessionDirs still meet.
 * Override with $PI_PEER_INBOX_DIR (useful for tests / custom state dirs).
 */
export function getPeerBaseDir(): string {
  const override = process.env.PI_PEER_INBOX_DIR?.trim();
  if (override) return override;
  return join(homedir(), ".pi", "agent", "peer-inbox");
}

/** Asserted path builder — throws on invalid ids so traversal is impossible. */
function requireId(id: string, what: string): string {
  if (!isValidSessionId(id)) {
    throw new Error(`Invalid session id for ${what}: ${JSON.stringify(id)}`);
  }
  return id;
}

export function inboxDirFor(base: string, sessionId: string): string {
  return join(base, "inbox", requireId(sessionId, "inbox"));
}

export function presenceFileFor(base: string, sessionId: string): string {
  return join(base, "presence", `${requireId(sessionId, "presence")}.json`);
}

export function messageFileFor(base: string, toId: string, messageId: string): string {
  if (!/^m-[A-Za-z0-9]{4,32}$/.test(messageId)) {
    throw new Error(`Invalid message id: ${JSON.stringify(messageId)}`);
  }
  return join(inboxDirFor(base, toId), `msg-${messageId}.json`);
}

/** Short display form for widgets/notifications (full id stays in details). */
export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/**
 * validators.ts — pure send/receive gates. No IO, directly unit-tested.
 */
import { isValidSessionId } from "./paths.ts";

export const MAX_TEXT_LEN = 4000;

export interface SendCtx {
  ownId: string;
  peers: string[];
  enabled: boolean;
}

export type SendGate = { ok: true } | { ok: false; text: string; details: { error: string } };

export function validateSendParams(
  params: { to_session_id?: unknown; text?: unknown; in_reply_to?: unknown },
  ctx: SendCtx,
): SendGate {
  if (!ctx.enabled) {
    return {
      ok: false,
      text: "Inter-session messaging is disabled (peer.enabled is false in config.json).",
      details: { error: "peer disabled" },
    };
  }
  const to = params.to_session_id;
  if (!isValidSessionId(to)) {
    return {
      ok: false,
      text: "`to_session_id` must be a valid Pi session-id (4-128 chars: letters, digits, _ or -).",
      details: { error: "invalid to_session_id" },
    };
  }
  if (to === ctx.ownId) {
    return {
      ok: false,
      text: "You cannot message your own session. `to_session_id` must be a different session.",
      details: { error: "self-send refused" },
    };
  }
  if (!ctx.peers.includes(to)) {
    const known = ctx.peers.length > 0 ? ctx.peers.join(", ") : "(none — use /peer allow <session-id>)";
    return {
      ok: false,
      text: `Session "${to}" is not in your peers allowlist. Allowed peers: ${known}.`,
      details: { error: "not in peers allowlist" },
    };
  }
  if (typeof params.text !== "string" || params.text.trim().length === 0) {
    return { ok: false, text: "`text` must be a non-empty message (1-4000 chars).", details: { error: "empty text" } };
  }
  if (params.text.length > MAX_TEXT_LEN) {
    return {
      ok: false,
      text: `Message is too long (${params.text.length} chars, max ${MAX_TEXT_LEN}). Put long content in a file and send the path instead.`,
      details: { error: "text too long" },
    };
  }
  if (params.in_reply_to !== undefined && typeof params.in_reply_to !== "string") {
    return { ok: false, text: "`in_reply_to` must be a message id string.", details: { error: "invalid in_reply_to" } };
  }
  return { ok: true };
}

/** Receive-side gate: only listed peers may steer this session. */
export function shouldAcceptFrom(from: unknown, peers: string[]): boolean {
  return typeof from === "string" && peers.includes(from);
}

/** Shared id-format gate for /peer allow (pure wording lives in commands.ts). */
export function validatePeerIdInput(raw: unknown): { ok: true; id: string } | { ok: false; text: string } {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!isValidSessionId(id)) {
    return {
      ok: false,
      text: `Invalid session-id ${JSON.stringify(raw ?? "")}. Expected 4-128 chars: letters, digits, _ or -.`,
    };
  }
  return { ok: true, id };
}

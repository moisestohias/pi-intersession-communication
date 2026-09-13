/**
 * send.ts — `session_ask` tool execute (thin; pure gates in validators.ts).
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getPeerBaseDir } from "./paths.ts";
import { getPeerConfig } from "./config.ts";
import { validateSendParams } from "./validators.ts";
import { buildPeerMessage, writePeerMessage } from "./transport.ts";
import { checkOnline, offlineErrorText } from "./presence.ts";
import { listPeers, loadPeerList, seedPeers } from "./peers.ts";
import { peerSessions, registerWaiter, unregisterWaiter, startPeerSession } from "./watcher.ts";
import type { PeerMessage } from "./transport.ts";

export const SessionAskParams = Type.Object({
  to_session_id: Type.String({ description: "Target Pi session-id to message (must be in your peers allowlist and online)." }),
  text: Type.String({ description: "Message text (1-4000 chars). The sender session-id is attached automatically." }),
  in_reply_to: Type.Optional(Type.String({ description: "Message id being replied to (threading)." })),
});

function toolError(text: string, error: string): { content: { type: "text"; text: string }[]; details: Record<string, unknown> } {
  return { content: [{ type: "text" as const, text }], details: { error } };
}

function ownIdOf(ctx: ExtensionContext): string | null {
  try {
    const id = (ctx as any)?.sessionManager?.getSessionId?.();
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

export async function executeSessionAsk(
  pi: any,
  params: { to_session_id?: unknown; text?: unknown; in_reply_to?: unknown },
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<{ content: { type: "text"; text: string }[]; details: Record<string, unknown> }> {
  let cfg: ReturnType<typeof getPeerConfig>;
  try {
    cfg = getPeerConfig();
  } catch (err) {
    return toolError(
      `Peer config error: ${(err as Error)?.message ?? err}. Fix config.json and /reload.`,
      "invalid config",
    );
  }

  const ownId = ownIdOf(ctx);
  if (!ownId) return toolError("Could not determine this session's id.", "no session id");

  // Session-scoped list (persisted file wins; config is only the template).
  // seedPeers is no-op when the watcher already seeded this session.
  let seed: string[] | null = null;
  try {
    seed = loadPeerList(getPeerBaseDir(), ownId);
  } catch {
    seed = null;
  }
  seedPeers(ownId, seed ?? cfg.peers);
  const gate = validateSendParams(params, { ownId, peers: listPeers(ownId), enabled: cfg.enabled });
  if (!gate.ok) return toolError(gate.text, (gate.details as any).error);

  const to = params.to_session_id as string;
  const text = params.text as string;
  const inReplyTo = typeof params.in_reply_to === "string" ? params.in_reply_to : null;

  const base = getPeerBaseDir();
  const online = checkOnline(base, to, cfg.presence_ttl_ms);
  if (!online.online) return toolError(offlineErrorText(to, online.reason), "peer offline");

  const msg = buildPeerMessage({ from: ownId, to, text, inReplyTo });
  try {
    writePeerMessage(base, msg);
  } catch (err) {
    return toolError(`Failed to deliver to session "${to}": ${(err as Error)?.message ?? err}`, "delivery failed");
  }

  if (cfg.mode !== "wait") {
    return {
      content: [
        {
          type: "text" as const,
          text: `Message sent to session "${to}" (message id ${msg.id}). Their reply will arrive as a new turn — do not poll.`,
        },
      ],
      details: { delivered: true, to, messageId: msg.id },
    };
  }

  // Wait mode: park until the matching reply lands (or timeout/abort).
  if (!peerSessions.has(ownId)) {
    try {
      startPeerSession(pi, ctx);
    } catch {}
  }
  try {
    const reply = await waitForReply(ownId, msg.id, cfg.wait_timeout_ms, signal);
    return {
      content: [{ type: "text" as const, text: `Peer ${to} replied:\n\n${reply.text}` }],
      details: { answered: true, to, messageId: msg.id, replyFrom: reply.from, replyText: reply.text },
    };
  } catch (err) {
    const secs = Math.round(cfg.wait_timeout_ms / 1000);
    return toolError(
      `Peer "${to}" did not reply within ${secs}s (message ${msg.id} was delivered; a late reply will still arrive as a new turn).`,
      (err as Error)?.message ?? "wait timeout",
    );
  }
}

function waitForReply(
  ownId: string,
  messageId: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PeerMessage> {
  return new Promise<PeerMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      unregisterWaiter(ownId, messageId);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("wait timeout"));
    }, timeoutMs);
    function onAbort() {
      clearTimeout(timer);
      unregisterWaiter(ownId, messageId);
      reject(new Error("aborted"));
    }
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    registerWaiter(ownId, messageId, (msg) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(msg);
    });
  });
}

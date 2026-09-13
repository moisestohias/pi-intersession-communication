/**
 * index.ts — thin extension wiring: one tool, one command, one message
 * renderer, session_start/shutdown delegation to watcher.ts.
 * All policy lives in its home module (see README).
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SessionCommunicateParams, executeSessionCommunicate } from "./send.ts";
import { handlePeerCommand } from "./commands.ts";
import { startPeerSession, stopPeerSession } from "./watcher.ts";
import { renderPeerMessage, renderSessionCommunicateCall, renderSessionCommunicateResult } from "./renderers.ts";

export default function peerExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    try {
      startPeerSession(pi, ctx);
    } catch {}
  });

  pi.on("session_shutdown", (_event, ctx) => {
    try {
      stopPeerSession(ctx as any);
    } catch {}
  });

  pi.registerTool({
    name: "session_communicate",
    label: "Message Peer Session",
    description:
      "Send a message to another Pi session by session-id. " +
      "The target must be in your peers allowlist (see /peer allow) and online — offline targets are an immediate error, never queued. " +
      "Your own session-id is attached automatically so the peer can reply with session_communicate. " +
      "In notify mode (default) the call returns once delivered and the reply arrives later as a new turn; in wait mode (peer.mode=wait in config.json) it blocks until the peer replies or the timeout hits. " +
      "Do not poll after sending — the reply wakes you automatically.",
    promptSnippet:
      "Send a message to a peer Pi session: session_communicate({ to_session_id, text, in_reply_to? }). Target must be allowed (/peer allow) and online.",
    parameters: SessionCommunicateParams,
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      void toolCallId;
      return executeSessionCommunicate(pi, params as any, signal as any, ctx as any) as any;
    },
    renderCall: renderSessionCommunicateCall as any,
    renderResult: renderSessionCommunicateResult as any,
  });

  pi.registerCommand("peer", {
    description: "Manage peer sessions: /peer whoami | list | allow [<id>] | drop <id>",
    handler: async (args, ctx) => {
      await handlePeerCommand(args, ctx as any);
    },
  });

  pi.registerMessageRenderer("peer_message", renderPeerMessage as any);
}

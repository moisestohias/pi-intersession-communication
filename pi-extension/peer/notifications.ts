/**
 * notifications.ts — sole owner of the peer steer envelope.
 * Callers pass data only; customType + delivery options live here.
 */

export interface MinimalPi {
  sendMessage(
    msg: { customType: string; content: string; display: boolean; details?: Record<string, unknown> },
    opts: { triggerTurn: boolean; deliverAs: string },
  ): void;
}

export interface PeerNotifyOpts {
  from: string;
  messageId: string;
  text: string;
  inReplyTo: string | null;
  kind: "question" | "reply";
}

export function peerReplyHint(from: string, messageId: string): string {
  return (
    `\n\nReply with session_communicate({ to_session_id: "${from}", text: "…", in_reply_to: "${messageId}" }) ` +
    `(or /peer allow first if that session is not in your allowlist).`
  );
}

export function notifyPeerMessage(pi: MinimalPi, opts: PeerNotifyOpts): void {
  const verb = opts.kind === "reply" ? "replies" : "asks";
  // Full sender id (not shortId): the reply hint that used to carry the full id
  // is disabled, so the content itself must show where to reply.
  const content = `Peer ${opts.from} ${verb}:\n\n${opts.text}`;
  // peerReplyHint disabled (user feedback: the appended "Reply with session_communicate(...)"
  // hint is noise — the model already knows the sender id from details.from).
  // To re-enable, append: + peerReplyHint(opts.from, opts.messageId)
  pi.sendMessage(
    {
      customType: "peer_message",
      content,
      display: true,
      details: {
        from: opts.from,
        messageId: opts.messageId,
        text: opts.text,
        inReplyTo: opts.inReplyTo,
        kind: opts.kind,
      },
    },
    { triggerTurn: true, deliverAs: "steer" },
  );
}

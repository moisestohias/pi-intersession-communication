/**
 * widget.ts — one small display-only widget (string[] form of setWidget).
 * Entry of ids happens via `/peer allow` (with `ctx.ui.input` dialog),
 * not inside the widget — Pi widgets are render-only.
 */
import { shortId } from "./paths.ts";

export interface PeerWidgetData {
  ownId: string;
  peers: string[];
  mode: "notify" | "wait";
  enabled: boolean;
  ignoredUnknown: number;
}

export function renderPeerWidgetLines(data: PeerWidgetData): string[] {
  if (!data.enabled) return ["peer: disabled (peer.enabled=false)"];
  const peers = data.peers.length > 0 ? data.peers.map(shortId).join(", ") : "(none — /peer allow <id>)";
  const ignored = data.ignoredUnknown > 0 ? ` · ignored ${data.ignoredUnknown} from unknown` : "";
  return [
    `peer ${shortId(data.ownId)} · ${data.peers.length} peer(s) · ${data.mode}${ignored}`,
    `peers: ${peers}`,
  ];
}

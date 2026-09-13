/**
 * commands.ts — `/peer` slash command: the simple UI for entering
 * session-ids (widgets are render-only, so entry lives here).
 *
 *   /peer whoami          — print this session's full id (copy to the other side)
 *   /peer list            — peers + online/offline per peer + mode
 *   /peer allow [<id>]    — no id → input dialog; validates, adds, persists
 *   /peer block <id>      — removes, persists
 */
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { getPeerBaseDir } from "./paths.ts";
import { getPeerConfig, getSafePeerConfig } from "./config.ts";
import { validatePeerIdInput } from "./validators.ts";
import { addPeer, listPeers, persistPeers, removePeer, seedPeers } from "./peers.ts";
import { checkOnline } from "./presence.ts";
import { peerSessions } from "./watcher.ts";

function ownIdOf(ctx: ExtensionCommandContext): string | null {
  try {
    const id = (ctx as any)?.sessionManager?.getSessionId?.();
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

function seedFromConfig(ownId: string): void {
  try {
    seedPeers(ownId, getPeerConfig().peers);
  } catch {
    seedPeers(ownId, getSafePeerConfig().peers);
  }
}

export async function handlePeerCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const notify = (msg: string, level: string) => {
    try {
      (ctx.ui as any).notify(msg, level);
    } catch {}
  };
  const ownId = ownIdOf(ctx);
  if (!ownId) {
    notify("Could not determine this session's id.", "error");
    return;
  }
  seedFromConfig(ownId);

  const parts = args.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] ?? "help").toLowerCase();
  const rest = parts.slice(1).join(" ").trim();

  if (sub === "whoami") {
    notify(`This session's id: ${ownId}`, "info");
    return;
  }

  if (sub === "list") {
    const peers = listPeers(ownId);
    const base = getPeerBaseDir();
    const ttl = getSafePeerConfig().presence_ttl_ms;
    const lines =
      peers.length === 0
        ? ["No peers allowed yet. Use /peer allow <session-id>."]
        : peers.map((p) => {
            let status = "offline";
            try {
              status = checkOnline(base, p, ttl).online ? "online" : "offline";
            } catch {}
            return `• ${p} (${status})`;
          });
    const mode = getSafePeerConfig().mode;
    notify(`Session ${ownId} · mode ${mode}\n${lines.join("\n")}`, "info");
    return;
  }

  if (sub === "allow") {
    let raw = rest;
    if (!raw) {
      // The simple entering-UI: prompt for the id when omitted.
      try {
        const answer = await (ctx.ui as any).input("Peer session-id to allow", "paste the other session's id");
        if (answer == null) return; // dialog dismissed
        raw = String(answer);
      } catch {
        notify("Usage: /peer allow <session-id>", "warning");
        return;
      }
    }
    const checked = validatePeerIdInput(raw);
    if (!checked.ok) {
      notify(checked.text, "error");
      return;
    }
    if (checked.id === ownId) {
      notify("That is your own session-id — you cannot peer with yourself.", "error");
      return;
    }
    const added = addPeer(ownId, checked.id);
    const peers = listPeers(ownId);
    const persistErr = persistPeers(peers);
    // Nudge the widget now (next tick refreshes anyway).
    try {
      peerSessions.get(ownId) && (peerSessions.get(ownId)!.lastWidgetSig = "");
    } catch {}
    notify(
      added
        ? `Allowed peer ${checked.id}.${persistErr ? ` (warning: ${persistErr})` : " Saved to config.json."}`
        : `Peer ${checked.id} was already allowed.${persistErr ? ` (warning: ${persistErr})` : ""}`,
      "info",
    );
    return;
  }

  if (sub === "block") {
    if (!rest) {
      notify("Usage: /peer block <session-id>", "warning");
      return;
    }
    const checked = validatePeerIdInput(rest);
    if (!checked.ok) {
      notify(checked.text, "error");
      return;
    }
    const removed = removePeer(ownId, checked.id);
    const persistErr = persistPeers(listPeers(ownId));
    try {
      peerSessions.get(ownId) && (peerSessions.get(ownId)!.lastWidgetSig = "");
    } catch {}
    notify(
      removed
        ? `Blocked peer ${checked.id}.${persistErr ? ` (warning: ${persistErr})` : " Saved to config.json."}`
        : `Peer ${checked.id} was not in the allowlist.`,
      "info",
    );
    return;
  }

  notify("Usage: /peer whoami | /peer list | /peer allow [<session-id>] | /peer block <session-id>", "warning");
}

/**
 * renderers.ts — presentation only. Wording for content lives in
 * notifications.ts / send paths; this file owns layout.
 */
import { Box, Text } from "@mariozechner/pi-tui";
import { shortId } from "./paths.ts";

export function renderSessionCommunicateCall(args: any, theme: any) {
  const to = typeof (args as any)?.to_session_id === "string" ? (args as any).to_session_id : "?";
  const text = typeof (args as any)?.text === "string" ? (args as any).text : "";
  const firstLine = text.split("\n").find((l: string) => l.trim()) ?? "";
  const preview = firstLine.length > 100 ? firstLine.slice(0, 100) + "…" : firstLine;
  let out = "○ " + theme.fg("toolTitle", theme.bold("session_communicate")) + theme.fg("dim", ` → ${shortId(to)}`);
  if (preview) out += "\n" + theme.fg("toolOutput", preview);
  return new Text(out, 0, 0);
}

export function renderSessionCommunicateResult(result: any, _opts: any, theme: any) {
  const details = (result as any)?.details as any;
  const text = typeof (result as any)?.content?.[0]?.text === "string" ? (result as any).content[0].text : "";
  if (details?.delivered) {
    return new Text(
      theme.fg("accent", "⟳") + " " + theme.fg("toolTitle", theme.bold("session_communicate")) + theme.fg("dim", ` — sent to ${shortId(details.to ?? "?")}`),
      0,
      0,
    );
  }
  if (details?.answered) {
    return new Text(theme.fg("toolTitle", theme.bold("peer reply")) + "\n" + theme.fg("toolOutput", text), 0, 0);
  }
  return new Text(theme.fg("dim", text || "(no output)"), 0, 0);
}

export function renderPeerMessage(message: any, options: any, theme: any) {
  const details = (message as any)?.details as any;
  // Full sender id: the reply hint is disabled, so the box itself must
  // show where to reply.
  const from = typeof details?.from === "string" ? details.from : "unknown peer";
  const text = typeof details?.text === "string" && details.text ? details.text : String((message as any)?.content ?? "");
  const kind = details?.kind === "reply" ? "replies" : "asks";
  const expanded = !!(options as any)?.expanded;
  return {
    render(width: number): string[] {
      const bgFn = (t: string) => theme.bg("toolSuccessBg", t);
      const icon = theme.fg("accent", "\u2709");
      const header = `${icon} ${theme.fg("toolTitle", theme.bold(`Peer ${from} ${kind}`))}`;
      const lines = [header, ""];
      if (expanded) {
        lines.push(text, "", theme.fg("dim", `Reply: session_communicate({ to_session_id: "${from}", text: "\u2026" })`));
      } else {
        const first = text.split("\n").find((l: string) => l.trim()) ?? "";
        const max = Math.max(20, width - 10);
        lines.push(first.length > max ? first.slice(0, max) + "\u2026" : first);
      }
      const box = new Box(1, 1, bgFn);
      box.addChild(new Text(lines.join("\n"), 0, 0));
      return ["", ...box.render(width)];
    },
  };
}

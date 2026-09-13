import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeSessionAsk } from "../pi-extension/peer/send.ts";
import { startPeerSession, stopPeerSession, tickForTest, peerSessions } from "../pi-extension/peer/watcher.ts";
import { clearPeersForTest, loadPeerList } from "../pi-extension/peer/peers.ts";
import { clearWaitersForTest } from "../pi-extension/peer/watcher.ts";
import { invalidatePeerConfigCache } from "../pi-extension/peer/config.ts";

const PKG = "/home/moises/Documents/Code/Agents/Pi-agent/pi-intersession-communication";

function ctx(id: string): any {
  return { hasUI: false, ui: { setWidget: () => {} }, sessionManager: { getSessionId: () => id } };
}
function pi(sent: any[]): any {
  return { sendMessage: (m: any, o: any) => sent.push({ m, o }) };
}

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "peer-send-"));
  process.env.PI_PEER_INBOX_DIR = base;
  clearPeersForTest();
  clearWaitersForTest();
  writeFileSync(
    join(PKG, "config.json"),
    JSON.stringify({ peer: { enabled: true, peers: ["sess-AAAA", "sess-BBBB"], mode: "notify", poll_ms: 200, wait_timeout_ms: 5000, presence_ttl_ms: 2000 } }),
  );
  invalidatePeerConfigCache();
});

afterEach(() => {
  for (const id of [...peerSessions.keys()]) {
    try {
      stopPeerSession(id);
    } catch {}
  }
  clearPeersForTest();
  clearWaitersForTest();
  delete process.env.PI_PEER_INBOX_DIR;
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {}
  try {
    rmSync(join(PKG, "config.json"), { force: true });
  } catch {}
  invalidatePeerConfigCache();
});

describe("session_ask send path", () => {
  it("first send persists the session list file; later config edits don't clobber it", async () => {
    const sentB: any[] = [];
    startPeerSession(pi([]), ctx("sess-AAAA"));
    startPeerSession(pi(sentB), ctx("sess-BBBB"));
    const r: any = await executeSessionAsk(null, { to_session_id: "sess-BBBB", text: "hi" }, undefined, ctx("sess-AAAA"));
    assert.equal(r.details.delivered, true);
    // Session file now exists (seeded from config template on first start)
    assert.deepEqual(loadPeerList(base, "sess-AAAA"), ["sess-AAAA", "sess-BBBB"]);
  });

  it("offline target is an immediate error", async () => {
    startPeerSession(pi([]), ctx("sess-AAAA"));
    const r: any = await executeSessionAsk(null, { to_session_id: "sess-BBBB", text: "hi" }, undefined, ctx("sess-AAAA"));
    assert.equal(r.details.error, "peer offline");
  });

  it("wait mode resolves via waiter without duplicate steer", async () => {
    writeFileSync(
      join(PKG, "config.json"),
      JSON.stringify({ peer: { enabled: true, peers: ["sess-AAAA", "sess-BBBB"], mode: "wait", poll_ms: 200, wait_timeout_ms: 8000, presence_ttl_ms: 5000 } }),
    );
    invalidatePeerConfigCache();
    const sentA: any[] = [];
    const sentB: any[] = [];
    startPeerSession(pi(sentA), ctx("sess-AAAA"));
    startPeerSession(pi(sentB), ctx("sess-BBBB"));
    const pending = executeSessionAsk(null, { to_session_id: "sess-BBBB", text: "ping?" }, undefined, ctx("sess-AAAA"));
    await new Promise((r) => setTimeout(r, 50));
    tickForTest("sess-BBBB");
    assert.equal(sentB.length, 1);
    await executeSessionAsk(null, { to_session_id: "sess-AAAA", text: "pong", in_reply_to: sentB[0].m.details.messageId }, undefined, ctx("sess-BBBB"));
    tickForTest("sess-AAAA");
    const r: any = await pending;
    assert.equal(r.details.answered, true);
    assert.equal(r.details.replyText, "pong");
    assert.equal(sentA.length, 0);
  });
});

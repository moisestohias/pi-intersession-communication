import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPeerMessage, writePeerMessage } from "../pi-extension/peer/transport.ts";
import { clearWaitersForTest, peerSessions, startPeerSession, stopPeerSession, tickForTest } from "../pi-extension/peer/watcher.ts";
import { clearPeersForTest, listPeers } from "../pi-extension/peer/peers.ts";

function fakeCtx(ownId: string) {
  return {
    hasUI: false,
    ui: { setWidget: () => {} },
    sessionManager: { getSessionId: () => ownId },
  } as any;
}

function fakePi(sent: any[]) {
  return {
    sendMessage: (msg: any, opts: any) => {
      sent.push({ msg, opts });
    },
  } as any;
}

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "peer-watcher-"));
  process.env.PI_PEER_INBOX_DIR = base;
  clearPeersForTest();
  clearWaitersForTest();
});

afterEach(() => {
  for (const id of [...peerSessions.keys()]) stopPeerSession(id);
  delete process.env.PI_PEER_INBOX_DIR;
  clearPeersForTest();
  clearWaitersForTest();
});

describe("watcher", () => {
  it("delivers allowed peer message as steer, unknown sender dropped silently", () => {
    const sent: any[] = [];
    startPeerSession(fakePi(sent), fakeCtx("sess-AAAA"));
    // Seed allowlist: only BBBB (config seed is empty in test env)
    assert.deepEqual(listPeers("sess-AAAA"), []);
    // Simulate /peer allow by seeding via second start? Use direct inbox flow:
    // write from stranger first
    writePeerMessage(base, buildPeerMessage({ from: "sess-STRANGER", to: "sess-AAAA", text: "spam" }));
    tickForTest("sess-AAAA");
    assert.equal(sent.length, 0, "stranger must never steer");
    const state = peerSessions.get("sess-AAAA")!;
    assert.equal(state.ignoredUnknown, 1);
  });

  it("allowed sender steers with reply hint", async () => {
    const { addPeer } = await import("../pi-extension/peer/peers.ts");
    const sent: any[] = [];
    startPeerSession(fakePi(sent), fakeCtx("sess-AAAA"));
    addPeer("sess-AAAA", "sess-BBBB");
    writePeerMessage(base, buildPeerMessage({ from: "sess-BBBB", to: "sess-AAAA", text: "is auth ready?" }));
    tickForTest("sess-AAAA");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].msg.customType, "peer_message");
    assert.equal(sent[0].opts.triggerTurn, true);
    assert.match(sent[0].msg.content, /sess-BBBB/);
    // peerReplyHint is disabled: no reply-hint appendix; routing ids stay in details
    assert.doesNotMatch(sent[0].msg.content, /Reply with session_communicate/);
    assert.equal(sent[0].msg.details.from, "sess-BBBB");
    assert.ok(sent[0].msg.details.messageId);
    // Second tick: no double delivery
    tickForTest("sess-AAAA");
    assert.equal(sent.length, 1);
  });

  it("shutdown of one session leaves the other running", () => {
    startPeerSession(fakePi([]), fakeCtx("sess-AAAA"));
    startPeerSession(fakePi([]), fakeCtx("sess-BBBB"));
    stopPeerSession("sess-AAAA");
    assert.equal(peerSessions.has("sess-AAAA"), false);
    assert.equal(peerSessions.has("sess-BBBB"), true);
  });
});

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  atomicWriteJson,
  buildPeerMessage,
  claimFile,
  claimPeerMessageFile,
  listInboxFiles,
  parkPeerPayload,
  peerDropCountsForTest,
  promotePendingPeerFile,
  writePeerMessage,
} from "../pi-extension/peer/transport.ts";

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "peer-transport-"));
});

describe("atomic write + claim-once", () => {
  it("two consumers, exactly one wins", () => {
    const msg = buildPeerMessage({ from: "sess-AAAA", to: "sess-BBBB", text: "hi" });
    const file = writePeerMessage(base, msg);
    assert.equal(existsSync(file), true);
    const c1 = claimFile(file);
    const c2 = claimFile(file);
    assert.ok(c1);
    assert.equal(c2, null); // lost race
  });
  it("claim parses and consumes", () => {
    const msg = buildPeerMessage({ from: "sess-AAAA", to: "sess-BBBB", text: "hello" });
    const file = writePeerMessage(base, msg);
    const out = claimPeerMessageFile(file);
    assert.equal(out.status, "ok");
    assert.equal((out as any).msg.text, "hello");
    assert.equal(existsSync(file), false);
  });
  it("torn json is consumed and counted, never retried", () => {
    mkdirSync(join(base, "inbox", "sess-BBBB"), { recursive: true });
    const bad = join(base, "inbox", "sess-BBBB", "msg-m-deadbeef.json");
    writeFileSync(bad, "{not json", "utf8");
    const before = peerDropCountsForTest()["peer-message"] ?? 0;
    assert.equal(claimPeerMessageFile(bad).status, "corrupt");
    assert.equal(existsSync(bad), false);
    assert.equal((peerDropCountsForTest()["peer-message"] ?? 0), before + 1);
  });
  it("missing fields are dropped as corrupt", () => {
    mkdirSync(join(base, "inbox", "sess-BBBB"), { recursive: true });
    const bad = join(base, "inbox", "sess-BBBB", "msg-m-aaaaaaaa.json");
    atomicWriteJson(bad, { noFrom: true });
    assert.equal(claimPeerMessageFile(bad).status, "corrupt");
  });
});

describe("inbox listing + park/promote", () => {
  it("lists oldest first and promotes parked payloads", () => {
    const m1 = buildPeerMessage({ from: "A", to: "sess-BBBB", text: "one" });
    const m2 = buildPeerMessage({ from: "A", to: "sess-BBBB", text: "two" });
    writePeerMessage(base, m1);
    writePeerMessage(base, m2);
    const files = listInboxFiles(base, "sess-BBBB");
    assert.equal(files.length, 2);
    // Consume m1's live file (steer threw), then park its payload for retry
    const consumed = claimPeerMessageFile(files.find((f) => f.endsWith(`msg-${m1.id}.json`))!);
    assert.equal(consumed.status, "ok");
    const inboxDir = join(base, "inbox", "sess-BBBB");
    parkPeerPayload(inboxDir, "msg-m-parked.json", m1);
    const restored = promotePendingPeerFile(inboxDir);
    assert.ok(restored);
    assert.ok(listInboxFiles(base, "sess-BBBB").some((f) => f === restored));
  });
});

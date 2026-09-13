import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkOnline,
  ensurePeerDirs,
  removeHeartbeat,
  sweepStalePresence,
  writeHeartbeat,
} from "../pi-extension/peer/presence.ts";
import { presenceFileFor } from "../pi-extension/peer/paths.ts";
import { existsSync, writeFileSync } from "node:fs";

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "peer-presence-"));
  ensurePeerDirs(base, "sess-AAAA");
});

describe("presence", () => {
  it("missing heartbeat = offline", () => {
    assert.deepEqual(checkOnline(base, "sess-NOPE", 10_000), { online: false, reason: "missing" });
  });
  it("fresh heartbeat = online", () => {
    writeHeartbeat(base, "sess-AAAA");
    assert.deepEqual(checkOnline(base, "sess-AAAA", 10_000), { online: true });
  });
  it("stale heartbeat = offline + file unlinked", () => {
    writeHeartbeat(base, "sess-AAAA");
    assert.deepEqual(checkOnline(base, "sess-AAAA", -1), { online: false, reason: "stale" });
    assert.equal(existsSync(presenceFileFor(base, "sess-AAAA")), false);
  });
  it("shutdown removes heartbeat", () => {
    writeHeartbeat(base, "sess-AAAA");
    removeHeartbeat(base, "sess-AAAA");
    assert.deepEqual(checkOnline(base, "sess-AAAA", 10_000), { online: false, reason: "missing" });
  });
  it("sweep clears crash residue only", () => {
    writeHeartbeat(base, "sess-AAAA");
    // Fake an ancient heartbeat
    writeFileSync(presenceFileFor(base, "sess-OLD1"), JSON.stringify({ hb: 1 }), "utf8");
    const removed = sweepStalePresence(base, 10_000);
    assert.equal(removed, 1);
    assert.equal(checkOnline(base, "sess-AAAA", 60_000).online, true);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PEER_CONFIG, parsePeerConfig } from "../pi-extension/peer/peer-config.ts";

describe("peer config", () => {
  it("absent peer section means defaults", () => {
    assert.deepEqual(parsePeerConfig({}, "t"), { ...DEFAULT_PEER_CONFIG, peers: [] });
  });
  it("parses a full section", () => {
    const cfg = parsePeerConfig(
      { peer: { enabled: true, peers: ["sess-AAAA"], mode: "wait", poll_ms: 1000, wait_timeout_ms: 5000, presence_ttl_ms: 5000 } },
      "t",
    );
    assert.equal(cfg.mode, "wait");
    assert.deepEqual(cfg.peers, ["sess-AAAA"]);
  });
  it("dedupes peers", () => {
    const cfg = parsePeerConfig({ peer: { enabled: true, peers: ["a-1111", "a-1111"], mode: "notify", poll_ms: 100, wait_timeout_ms: 100, presence_ttl_ms: 1000 } }, "t");
    assert.deepEqual(cfg.peers, ["a-1111"]);
  });
  it("unknown keys warn-and-ignore", () => {
    const cfg = parsePeerConfig({ peer: { enabled: true, future: 1, peers: [], mode: "notify", poll_ms: 100, wait_timeout_ms: 100, presence_ttl_ms: 1000 } }, "t");
    assert.equal(cfg.enabled, true);
  });
  it("wrong types throw", () => {
    assert.throws(() => parsePeerConfig({ peer: { enabled: "yes" } }, "t"));
    assert.throws(() => parsePeerConfig({ peer: { enabled: true, mode: "block" } }, "t"));
    assert.throws(() => parsePeerConfig({ peer: { enabled: true, poll_ms: -1, mode: "notify", peers: [], wait_timeout_ms: 1, presence_ttl_ms: 10 } }, "t"));
    assert.throws(() => parsePeerConfig({ peer: { enabled: true, peers: ["../x"], mode: "notify", poll_ms: 1, wait_timeout_ms: 1, presence_ttl_ms: 10 } }, "t"));
  });
  it("ttl must exceed poll interval", () => {
    assert.throws(() =>
      parsePeerConfig({ peer: { enabled: true, peers: [], mode: "notify", poll_ms: 5000, wait_timeout_ms: 100, presence_ttl_ms: 1000 } }, "t"),
    );
  });
});

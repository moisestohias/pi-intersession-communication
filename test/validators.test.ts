import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidSessionId } from "../pi-extension/peer/paths.ts";
import { shouldAcceptFrom, validatePeerIdInput, validateSendParams } from "../pi-extension/peer/validators.ts";

const CTX = { ownId: "sess-AAAA", peers: ["sess-BBBB", "sess-CCCC"], enabled: true };

describe("session-id format", () => {
  it("accepts normal ids", () => {
    assert.equal(isValidSessionId("abc123"), true);
    assert.equal(isValidSessionId("sess-AAAA"), true);
    assert.equal(isValidSessionId("a_b-c"), true);
  });
  it("rejects traversal and junk", () => {
    assert.equal(isValidSessionId("../etc"), false);
    assert.equal(isValidSessionId("a/b"), false);
    assert.equal(isValidSessionId(""), false);
    assert.equal(isValidSessionId("ab"), false); // too short
    assert.equal(isValidSessionId("has space"), false);
    assert.equal(isValidSessionId(123), false);
    assert.equal(isValidSessionId(null), false);
  });
});

describe("validateSendParams", () => {
  it("passes a good send", () => {
    assert.deepEqual(
      validateSendParams({ to_session_id: "sess-BBBB", text: "hello" }, CTX),
      { ok: true },
    );
  });
  it("refuses when disabled", () => {
    const r = validateSendParams({ to_session_id: "sess-BBBB", text: "hi" }, { ...CTX, enabled: false });
    assert.equal(r.ok, false);
  });
  it("refuses invalid target id", () => {
    const r = validateSendParams({ to_session_id: "../../x", text: "hi" }, CTX);
    assert.equal(r.ok, false);
  });
  it("refuses self-send", () => {
    const r = validateSendParams({ to_session_id: "sess-AAAA", text: "hi" }, CTX);
    assert.equal(r.ok, false);
    assert.match((r as any).text, /own session/);
  });
  it("refuses non-allowlisted target with helpful hint", () => {
    const r = validateSendParams({ to_session_id: "sess-ZZZZ", text: "hi" }, CTX);
    assert.equal(r.ok, false);
    assert.match((r as any).text, /allowlist/);
  });
  it("refuses empty and overlong text", () => {
    assert.equal(validateSendParams({ to_session_id: "sess-BBBB", text: "  " }, CTX).ok, false);
    assert.equal(validateSendParams({ to_session_id: "sess-BBBB", text: "x".repeat(4001) }, CTX).ok, false);
    assert.equal(validateSendParams({ to_session_id: "sess-BBBB", text: "x".repeat(4000) }, CTX).ok, true);
  });
});

describe("receive gate", () => {
  it("accepts listed, drops strangers", () => {
    assert.equal(shouldAcceptFrom("sess-BBBB", CTX.peers), true);
    assert.equal(shouldAcceptFrom("sess-ZZZZ", CTX.peers), false);
    assert.equal(shouldAcceptFrom(undefined, CTX.peers), false);
  });
  it("input validator trims", () => {
    assert.deepEqual(validatePeerIdInput("  sess-BBBB "), { ok: true, id: "sess-BBBB" });
    assert.equal(validatePeerIdInput("../x").ok, false);
  });
});

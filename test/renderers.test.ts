import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderPeerMessage } from "../pi-extension/peer/renderers.ts";

// Minimal theme stub: identity functions (layout, not colors, under test).
const theme: any = {
  fg: (_c: string, t: string) => t,
  bold: (t: string) => t,
  bg: (_c: string, t: string) => t,
};

function render(msg: any, expanded: boolean): string {
  const out = (renderPeerMessage(msg, { expanded }, theme) as any).render(80);
  assert.ok(Array.isArray(out));
  return out.join("\n");
}

describe("renderPeerMessage", () => {
  it("boxes the message with icon and full sender id", () => {
    const text = render(
      { details: { from: "sess-BBBB", kind: "question", text: "is auth ready?", messageId: "m-1" } },
      false,
    );
    assert.match(text, /✉/);
    assert.match(text, /Peer sess-BBBB asks/);
    assert.match(text, /is auth ready\?/);
    // Boxed: more than just header + body lines
    assert.ok(text.split("\n").length > 3);
  });
  it("expanded shows full text plus reply hint with full id", () => {
    const text = render(
      { details: { from: "sess-BBBB", kind: "reply", text: "line1\nline2", messageId: "m-2" } },
      true,
    );
    assert.match(text, /line1/);
    assert.match(text, /line2/);
    assert.match(text, /session_communicate\(\{ to_session_id: "sess-BBBB"/);
  });
  it("collapses to a one-line preview", () => {
    const text = render(
      { details: { from: "sess-BBBB", kind: "question", text: "first line here\nsecond line", messageId: "m-3" } },
      false,
    );
    assert.match(text, /first line here/);
    assert.doesNotMatch(text, /second line/);
  });
});

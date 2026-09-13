import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handlePeerCommand } from "../pi-extension/peer/commands.ts";
import {
  clearPeersForTest,
  listPeers,
  loadPeerList,
  savePeerList,
  sweepStalePeerLists,
  peerListFileFor,
} from "../pi-extension/peer/peers.ts";
import { peerSessions, stopPeerSession } from "../pi-extension/peer/watcher.ts";

function cmdCtx(ownId: string, notes: any[], inputAnswer?: string) {
  return {
    sessionManager: { getSessionId: () => ownId },
    ui: {
      notify: (msg: string, level: string) => notes.push({ msg, level }),
      input: async () => inputAnswer ?? null,
      setWidget: () => {},
    },
    hasUI: false,
  } as any;
}

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "peer-cmd-"));
  process.env.PI_PEER_INBOX_DIR = base;
  clearPeersForTest();
});

afterEach(() => {
  for (const id of [...peerSessions.keys()]) {
    try {
      stopPeerSession(id);
    } catch {}
  }
  clearPeersForTest();
  delete process.env.PI_PEER_INBOX_DIR;
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {}
});

describe("/peer command", () => {
  it("whoami prints the session id", async () => {
    const notes: any[] = [];
    await handlePeerCommand("whoami", cmdCtx("sess-AAAA", notes));
    assert.match(notes[0].msg, /sess-AAAA/);
  });

  it("allow adds + persists per-session, list shows, drop removes", async () => {
    const notes: any[] = [];
    const ctx = cmdCtx("sess-AAAA", notes);
    await handlePeerCommand("allow sess-BBBB", ctx);
    assert.deepEqual(listPeers("sess-AAAA"), ["sess-BBBB"]);
    // Persisted under the session's own file — never config.json
    assert.equal(existsSync(peerListFileFor(base, "sess-AAAA")), true);
    assert.deepEqual(loadPeerList(base, "sess-AAAA"), ["sess-BBBB"]);

    await handlePeerCommand("list", ctx);
    assert.match(notes[notes.length - 1].msg, /sess-BBBB/);

    await handlePeerCommand("allow sess-BBBB", ctx);
    assert.match(notes[notes.length - 1].msg, /already allowed/);

    await handlePeerCommand("drop sess-BBBB", ctx);
    assert.deepEqual(listPeers("sess-AAAA"), []);
    assert.deepEqual(loadPeerList(base, "sess-AAAA"), []);
  });

  it("lists are isolated per session", async () => {
    const notes: any[] = [];
    await handlePeerCommand("allow sess-BBBB", cmdCtx("sess-AAAA", notes));
    await handlePeerCommand("allow sess-CCCC", cmdCtx("sess-DDDD", notes));
    assert.deepEqual(listPeers("sess-AAAA"), ["sess-BBBB"]);
    assert.deepEqual(listPeers("sess-DDDD"), ["sess-CCCC"]);
  });

  it("allow with no id uses the input dialog", async () => {
    const notes: any[] = [];
    await handlePeerCommand("allow", cmdCtx("sess-AAAA", notes, "sess-DDDD"));
    assert.deepEqual(listPeers("sess-AAAA"), ["sess-DDDD"]);
  });

  it("rejects bad ids and self-peer", async () => {
    const notes: any[] = [];
    const ctx = cmdCtx("sess-AAAA", notes);
    await handlePeerCommand("allow ../evil", ctx);
    assert.equal(notes[notes.length - 1].level, "error");
    await handlePeerCommand("allow sess-AAAA", ctx);
    assert.match(notes[notes.length - 1].msg, /own session/);
  });

  it("unknown subcommand prints usage", async () => {
    const notes: any[] = [];
    await handlePeerCommand("frobnicate", cmdCtx("sess-AAAA", notes));
    assert.match(notes[0].msg, /Usage/);
  });
});

describe("peer list persistence", () => {
  it("missing file returns null (caller seeds from config)", () => {
    assert.equal(loadPeerList(base, "sess-NONE", ), null);
  });
  it("round-trips and validates", () => {
    assert.equal(savePeerList(base, "sess-AAAA", ["sess-BBBB"]), null);
    assert.deepEqual(loadPeerList(base, "sess-AAAA"), ["sess-BBBB"]);
  });
  it("corrupt file is backed up, loads as empty", () => {
    assert.equal(savePeerList(base, "sess-AAAA", ["sess-BBBB"]), null);
    writeFileSync(peerListFileFor(base, "sess-AAAA"), "{broken", "utf8");
    assert.deepEqual(loadPeerList(base, "sess-AAAA"), []);
  });
  it("sweep removes only old lists without live presence", () => {
    assert.equal(savePeerList(base, "sess-AAAA", []), null);
    assert.equal(savePeerList(base, "sess-BBBB", []), null);
    // sess-AAAA "alive", sess-BBBB not, but both are fresh → nothing swept
    assert.equal(sweepStalePeerLists(base, (id) => id === "sess-AAAA", 60_000), 0);
    // maxAge 0 with dead presence → swept
    assert.equal(sweepStalePeerLists(base, () => false, -1), 2);
    assert.equal(existsSync(peerListFileFor(base, "sess-AAAA")), false);
  });
});

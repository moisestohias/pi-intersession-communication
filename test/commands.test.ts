import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handlePeerCommand } from "../pi-extension/peer/commands.ts";
import { clearPeersForTest, listPeers } from "../pi-extension/peer/peers.ts";
import { peerSessions, stopPeerSession } from "../pi-extension/peer/watcher.ts";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(PKG_ROOT, "config.json");

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

beforeEach(() => {
  clearPeersForTest();
});

afterEach(() => {
  for (const id of [...peerSessions.keys()]) {
    try {
      stopPeerSession(id);
    } catch {}
  }
  clearPeersForTest();
  try {
    if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH, { force: true });
  } catch {}
});

describe("/peer command", () => {
  it("whoami prints the session id", async () => {
    const notes: any[] = [];
    await handlePeerCommand("whoami", cmdCtx("sess-AAAA", notes));
    assert.match(notes[0].msg, /sess-AAAA/);
  });

  it("allow adds + persists, list shows, block removes", async () => {
    const notes: any[] = [];
    const ctx = cmdCtx("sess-AAAA", notes);
    await handlePeerCommand("allow sess-BBBB", ctx);
    assert.deepEqual(listPeers("sess-AAAA"), ["sess-BBBB"]);
    assert.equal(existsSync(CONFIG_PATH), true);

    await handlePeerCommand("list", ctx);
    assert.match(notes[notes.length - 1].msg, /sess-BBBB/);

    await handlePeerCommand("allow sess-BBBB", ctx);
    assert.match(notes[notes.length - 1].msg, /already allowed/);

    await handlePeerCommand("block sess-BBBB", ctx);
    assert.deepEqual(listPeers("sess-AAAA"), []);
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
